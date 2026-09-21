// Documents held in the database (migration 015) and served only to a
// signed-in user: the exam list above all. Written by
// pipeline/upload_document.py; the application only reads.

import { db } from '@/lib/db';

export interface DocumentInfo {
  filename: string;
  size: number;
  uploaded_at: string;
}

// What the page needs to offer the download, without the bytes.
export async function documentInfo(id: string): Promise<DocumentInfo | null> {
  const sql = db();
  const rows = (await sql`
    select filename, size, uploaded_at from documents where id = ${id}
  `) as DocumentInfo[];
  return rows[0] ?? null;
}

// The file itself. Read as base64 because the Neon HTTP driver returns bytea
// as text; decoding it here gives the exact bytes uploaded.
export async function documentBytes(
  id: string,
): Promise<{ filename: string; content_type: string; bytes: Buffer } | null> {
  const sql = db();
  const rows = (await sql`
    select filename, content_type, encode(bytes, 'base64') as b64
    from documents where id = ${id}
  `) as { filename: string; content_type: string; b64: string }[];
  const row = rows[0];
  if (!row) return null;
  return {
    filename: row.filename,
    content_type: row.content_type,
    bytes: Buffer.from(row.b64, 'base64'),
  };
}
