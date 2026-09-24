// RFC 9728 protected resource metadata for the remote MCP endpoint. Claude
// tries the path-suffixed form first (./api/mcp/route.ts); this is the
// fallback at the root. Both return the same document (lib/oauth.ts).

import { METADATA_HEADERS, originFrom, protectedResourceMetadata } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(originFrom(req.headers)), { headers: METADATA_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_HEADERS });
}
