// The authorization server for the remote MCP endpoint (app/api/mcp).
//
// Neon Auth cannot act as an OAuth provider, so the application issues tokens
// itself on top of her existing sign-in: Neon Auth proves who she is,
// ALLOWED_EMAILS decides whether she may use this, and the tokens here only
// carry that decision to Claude. Design approved 23 Sept (docs/HANDOFF.md).
//
// WHAT CLAUDE NEEDS (claude.com/docs/connectors/building/authentication and
// …/lazy-authentication):
//
//   - protected resource metadata naming this app as the authorization server
//   - authorization server metadata advertising client_id_metadata_document_
//     supported AND token_endpoint_auth_methods_supported ["none"], or Claude
//     falls back to dynamic registration, which this server does not offer
//   - S256 PKCE on every authorization request
//   - a token endpoint that reads form-encoded bodies and rotates refresh tokens
//
// WHICH CLIENTS
//
//   Only Claude. A client_id must be an https URL on claude.ai, and it must
//   dereference to a Client ID Metadata Document whose own client_id is that
//   URL (self-referential) and which lists the redirect_uri being used. The
//   hosted surfaces redirect to https://claude.ai/api/mcp/auth_callback; Claude
//   Code lists http://localhost/callback and http://127.0.0.1/callback and binds
//   an ephemeral port, so loopback redirects are compared with the port ignored
//   (RFC 8252 §7.3). Any other client is refused before anything is shown.

import { createHash, randomBytes } from 'node:crypto';

import { db } from '@/lib/db';

export const SCOPE = 'scriptorium';
export const CLIENT_HOST = 'claude.ai';

const CODE_SECONDS = 10 * 60;
export const ACCESS_SECONDS = 60 * 60;
const REFRESH_SECONDS = 30 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Addresses

// The public origin, from the proxy headers Vercel sets; the same rule as
// mcp-handler's getPublicOrigin, for places that have Headers but no Request.
export function originFrom(headers: Headers): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000';
  const proto =
    headers.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`;
}

export function resourceUrl(origin: string): string {
  return `${origin}/api/mcp`;
}

export const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/api/mcp';

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
  };
}

export const METADATA_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'max-age=300',
};

// ---------------------------------------------------------------------------
// Secrets

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ---------------------------------------------------------------------------
// The allowlist, read the same way lib/auth/guard.ts reads it. Checked again at
// every token issue and every MCP request, so removing an address stops access
// within the hour.

export function emailAllowed(email: string): boolean {
  const list = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 && list.includes(email.toLowerCase());
}

// ---------------------------------------------------------------------------
// Clients (Client ID Metadata Documents)

export type Client = { clientId: string; host: string; redirectUris: string[] };

export async function loadClient(clientId: string): Promise<Client> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new Error('client_id is not a URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== CLIENT_HOST || url.hash) {
    throw new Error(`only Claude (https://${CLIENT_HOST}) may connect`);
  }

  let doc: unknown;
  try {
    const res = await fetch(url, {
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    doc = await res.json();
  } catch (err) {
    throw new Error(`the client's metadata document could not be read (${(err as Error).message})`);
  }

  const d = doc as { client_id?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown };
  if (d.client_id !== clientId) {
    throw new Error("the client's metadata document does not name itself");
  }
  if (!Array.isArray(d.redirect_uris) || !d.redirect_uris.every((u) => typeof u === 'string')) {
    throw new Error("the client's metadata document lists no redirect URIs");
  }
  if (d.token_endpoint_auth_method !== undefined && d.token_endpoint_auth_method !== 'none') {
    throw new Error('only public clients are supported');
  }
  return { clientId, host: url.hostname, redirectUris: d.redirect_uris as string[] };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function redirectAllowed(client: Client, redirectUri: string): boolean {
  let asked: URL;
  try {
    asked = new URL(redirectUri);
  } catch {
    return false;
  }
  if (asked.hash) return false;

  for (const listed of client.redirectUris) {
    let reg: URL;
    try {
      reg = new URL(listed);
    } catch {
      continue;
    }
    if (LOOPBACK.has(reg.hostname)) {
      // Native client: same scheme, host and path, any port.
      if (
        asked.protocol === 'http:' &&
        reg.protocol === 'http:' &&
        asked.hostname === reg.hostname &&
        asked.pathname === reg.pathname &&
        asked.search === reg.search
      ) {
        return true;
      }
    } else if (listed === redirectUri) {
      // Web client: exact match, and on the client's own origin.
      if (asked.origin === new URL(client.clientId).origin) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The authorization request

export type AuthorizeParams = {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  resource: string;
};

export const AUTHORIZE_FIELDS: (keyof AuthorizeParams)[] = [
  'response_type', 'client_id', 'redirect_uri', 'state',
  'code_challenge', 'code_challenge_method', 'scope', 'resource',
];

export function readAuthorizeParams(get: (name: string) => string | null | undefined): AuthorizeParams {
  const out = {} as AuthorizeParams;
  for (const f of AUTHORIZE_FIELDS) out[f] = (get(f) ?? '').toString();
  return out;
}

// Everything that must hold before a consent screen is shown or a code issued.
// Run on the page and again in the Server Action, because hidden form fields
// can be changed by anyone who can post the form.
export async function checkAuthorize(p: AuthorizeParams, origin: string): Promise<Client> {
  if (p.response_type !== 'code') throw new Error('response_type must be code');
  if (!p.code_challenge || p.code_challenge_method !== 'S256') {
    throw new Error('a PKCE S256 code_challenge is required');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) throw new Error('code_challenge is malformed');
  if (p.resource && p.resource.replace(/\/$/, '') !== resourceUrl(origin)) {
    throw new Error(`this server only issues tokens for ${resourceUrl(origin)}`);
  }
  const client = await loadClient(p.client_id);
  if (!redirectAllowed(client, p.redirect_uri)) {
    throw new Error("redirect_uri is not one the client's metadata document lists");
  }
  return client;
}

export function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Storage

type TokenRow = {
  kind: string;
  client_id: string;
  email: string;
  redirect_uri: string | null;
  code_challenge: string | null;
  expired: boolean;
};

export async function issueCode(p: AuthorizeParams, email: string): Promise<string> {
  const code = newSecret();
  await db()`
    insert into oauth_tokens (hash, kind, client_id, email, redirect_uri, code_challenge, expires_at)
    values (${hashSecret(code)}, 'code', ${p.client_id}, ${email}, ${p.redirect_uri},
            ${p.code_challenge}, now() + make_interval(secs => ${CODE_SECONDS}))
  `;
  return code;
}

async function issuePair(clientId: string, email: string) {
  const access = newSecret();
  const refresh = newSecret();
  await db()`
    insert into oauth_tokens (hash, kind, client_id, email, expires_at)
    values (${hashSecret(access)}, 'access', ${clientId}, ${email},
            now() + make_interval(secs => ${ACCESS_SECONDS})),
           (${hashSecret(refresh)}, 'refresh', ${clientId}, ${email},
            now() + make_interval(secs => ${REFRESH_SECONDS}))
  `;
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_SECONDS,
    refresh_token: refresh,
    scope: SCOPE,
  };
}

// Delete-and-return makes a code or refresh token single-use even when two
// requests race: only one of them gets the row back.
async function take(value: string, kind: 'code' | 'refresh'): Promise<TokenRow | null> {
  const rows = (await db()`
    delete from oauth_tokens where hash = ${hashSecret(value)} and kind = ${kind}
    returning kind, client_id, email, redirect_uri, code_challenge, expires_at < now() as expired
  `) as TokenRow[];
  return rows[0] ?? null;
}

export class TokenError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function exchangeCode(form: {
  code: string; client_id: string; redirect_uri: string; code_verifier: string;
}) {
  if (!form.code || !form.code_verifier) throw new TokenError('invalid_request', 'code and code_verifier are required');
  const row = await take(form.code, 'code');
  if (!row || row.expired) throw new TokenError('invalid_grant', 'the code is unknown, used or expired');
  if (row.client_id !== form.client_id) throw new TokenError('invalid_grant', 'the code was issued to another client');
  if (row.redirect_uri !== form.redirect_uri) throw new TokenError('invalid_grant', 'redirect_uri does not match');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(form.code_verifier) || s256(form.code_verifier) !== row.code_challenge) {
    throw new TokenError('invalid_grant', 'PKCE verification failed');
  }
  if (!emailAllowed(row.email)) throw new TokenError('invalid_grant', 'this account no longer has access');
  return issuePair(row.client_id, row.email);
}

export async function exchangeRefresh(form: { refresh_token: string; client_id: string }) {
  if (!form.refresh_token) throw new TokenError('invalid_request', 'refresh_token is required');
  const row = await take(form.refresh_token, 'refresh');
  if (!row || row.expired) throw new TokenError('invalid_grant', 'the refresh token is unknown, used or expired');
  if (form.client_id && row.client_id !== form.client_id) {
    throw new TokenError('invalid_grant', 'the refresh token was issued to another client');
  }
  if (!emailAllowed(row.email)) throw new TokenError('invalid_grant', 'this account no longer has access');
  return issuePair(row.client_id, row.email);
}

export async function pruneExpired(): Promise<void> {
  await db()`delete from oauth_tokens where expires_at < now()`;
}

export async function verifyAccess(token: string) {
  const rows = (await db()`
    select client_id, email, extract(epoch from expires_at)::bigint as exp
    from oauth_tokens
    where hash = ${hashSecret(token)} and kind = 'access' and expires_at > now()
  `) as { client_id: string; email: string; exp: string | number }[];
  const row = rows[0];
  if (!row || !emailAllowed(row.email)) return undefined;
  return { clientId: row.client_id, email: row.email, expiresAt: Number(row.exp) };
}
