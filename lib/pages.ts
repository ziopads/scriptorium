// Reads for the page text loaded by pipeline/load_pages.py.
//
// Everything here goes through the printed_pages view rather than the pages
// table, so the number in front of her is always page_index + works.page_offset
// and a corrected offset moves every page at once (migration 006).
//
// pages.folio — the number actually read off the page — is carried through for
// one reason: where it disagrees with printed_page the offset is wrong, and the
// Preview header says so. Ten works have an uncertain offset and this is the
// cheapest way to find them.

import { db } from '@/lib/db';

export interface PageBounds {
  first: number; // lowest printed page held
  last: number;
  count: number;
}

export interface PageText {
  page_index: number;
  printed_page: number;
  folio: number | null;
  text: string;
}

// Null when no pages have been loaded for this work, which is most of them:
// source_format on the work says a file is held, not that it has been through
// the pipeline.
export async function pageBounds(workId: string): Promise<PageBounds | null> {
  const sql = db();
  const rows = (await sql`
    select min(printed_page)::int as first,
           max(printed_page)::int as last,
           count(*)::int as count
    from printed_pages
    where work_id = ${workId}
  `) as { first: number | null; last: number | null; count: number }[];

  const row = rows[0];
  if (!row || row.count === 0 || row.first === null || row.last === null) return null;
  return { first: row.first, last: row.last, count: row.count };
}

export async function getPage(workId: string, printedPage: number): Promise<PageText | null> {
  const sql = db();
  const rows = (await sql`
    select page_index, printed_page, folio, text
    from printed_pages
    where work_id = ${workId} and printed_page = ${printedPage}
  `) as PageText[];
  return rows[0] ?? null;
}
