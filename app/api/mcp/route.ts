// The remote MCP endpoint, behind OAuth: https://<host>/api/mcp
//
// Every request needs a bearer token issued by this app's authorization server
// (lib/oauth.ts, app/oauth/*). Without one the answer is 401 with a
// WWW-Authenticate header pointing at the protected resource metadata, which
// is how Claude learns where to send her to sign in. The token is checked
// against oauth_tokens and the email against ALLOWED_EMAILS on every request.
//
// Replaced the deploy-1 endpoint, app/api/mcp/[key], which was guarded by its
// URL and Anthropic's address range; removed 24 Sept once this one was
// confirmed from claude.ai.

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
