// RFC 8414 authorization server metadata. Advertises CIMD and public clients
// together, which is what makes Claude identify itself by its published
// metadata document instead of looking for a registration endpoint.

import { METADATA_HEADERS, authorizationServerMetadata, originFrom } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return Response.json(authorizationServerMetadata(originFrom(req.headers)), { headers: METADATA_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_HEADERS });
}
