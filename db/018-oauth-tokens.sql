-- Scriptorium — migration 018: OAuth codes and tokens for the remote MCP server
--
-- Run against a database carrying 001–017. Additive: one new table. No existing
-- row changes.
--
-- WHY
--
--   The remote MCP server (app/api/mcp) will serve book text, and a URL alone
--   is not enough to guard that. Neon Auth cannot act as an OAuth provider, so
--   the application issues tokens itself, on top of her existing sign-in and
--   the ALLOWED_EMAILS list (lib/oauth.ts, docs/HANDOFF.md 23 Sept).
--
--   One table holds all three kinds of secret the flow hands out:
--
--     code      the one-time authorization code, 10 minutes, with the
--               redirect_uri and PKCE challenge it was issued against
--     access    the bearer token Claude sends with every MCP request, 1 hour
--     refresh   exchanged for a new access and refresh token, 30 days, and
--               deleted when used (rotation, as OAuth 2.1 asks of public
--               clients)
--
--   Only a SHA-256 hash of each value is stored. The values are 32 random
--   bytes, so a fast hash is enough; a leaked table yields nothing usable.
--
--   Revoking access is deleting rows: by email for a person, by client_id for
--   a client, or everything. Expired rows are deleted opportunistically by the
--   token endpoint.
--
--   Written and read only by lib/oauth.ts. The pipeline never touches it, and
--   backup.py need not: every row is disposable.

begin;

create table if not exists oauth_tokens (
  hash            text primary key,
  kind            text not null,
  client_id       text not null,
  email           text not null,
  redirect_uri    text,
  code_challenge  text,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  constraint oauth_tokens_kind_ck check (kind in ('code', 'access', 'refresh')),
  constraint oauth_tokens_code_ck check (
    kind <> 'code' or (redirect_uri is not null and code_challenge is not null)
  )
);

create index if not exists oauth_tokens_expires_idx on oauth_tokens (expires_at);
create index if not exists oauth_tokens_email_idx on oauth_tokens (email);

comment on table oauth_tokens is
  'OAuth authorization codes, access tokens and refresh tokens for the remote '
  'MCP server, stored as SHA-256 hashes. Disposable: deleting a row revokes it.';

commit;

-- After running:
--
--   select kind, email, client_id, expires_at from oauth_tokens order by created_at desc;
