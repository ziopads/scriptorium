// RFC 9728 protected resource metadata, path-suffixed for the resource
// /api/mcp. The 401 from app/api/mcp points here (RESOURCE_METADATA_PATH);
// the root form one level up returns the same document.

import { METADATA_HEADERS, originFrom, protectedResourceMetadata } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(originFrom(req.headers)), { headers: METADATA_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_HEADERS });
}
