import { requireAllowedUser } from '@/lib/auth/guard';
import { documentBytes } from '@/lib/documents';

export const dynamic = 'force-dynamic';

// The exam list as her department issued it, for download and printing. The
// PDF lives in the documents table (migration 015), never in the repository,
// and is sent only to a signed-in user on the allowlist: requireAllowedUser
// redirects anyone else before a byte is read.

export async function GET(): Promise<Response> {
  await requireAllowedUser();

  const doc = await documentBytes('exam-list');
  if (!doc) {
    return new Response('The exam list has not been uploaded yet.', { status: 404 });
  }

  return new Response(new Uint8Array(doc.bytes), {
    headers: {
      'Content-Type': doc.content_type,
      'Content-Length': String(doc.bytes.length),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      // Private to her browser; never kept by a shared cache.
      'Cache-Control': 'private, no-store',
    },
  });
}
