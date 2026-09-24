// The remote MCP endpoint, behind OAuth: https://<host>/api/mcp
//
// Every request needs a bearer token issued by this app's authorization server
// (lib/oauth.ts, app/oauth/*). Without one the answer is 401 with a
// WWW-Authenticate header pointing at the protected resource metadata, which
// is how Claude learns where to send her to sign in. The token is checked
// against oauth_tokens and the email against ALLOWED_EMAILS on every request.
//
// app/api/mcp/[key]/route.ts, the deploy-1 endpoint guarded by its URL, is
// deleted once this one is confirmed from a client.

import { withMcpAuth } from 'mcp-handler';

import { RESOURCE_METADATA_PATH, SCOPE, verifyAccess } from '@/lib/oauth';
import { handler } from '@/mcp/server';

export const dynamic = 'force-dynamic';

const authed = withMcpAuth(
  handler,
  async (_req, token) => {
    if (!token) return undefined;
    const found = await verifyAccess(token);
    if (!found) return undefined;
    return {
      token,
      clientId: found.clientId,
      scopes: [SCOPE],
      expiresAt: found.expiresAt,
      extra: { email: found.email },
    };
  },
  { required: true, resourceMetadataPath: RESOURCE_METADATA_PATH },
);

export { authed as GET, authed as POST, authed as DELETE };
