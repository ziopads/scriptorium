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

// Whether this work's offset looks wrong, judged across the book rather than
// on the page in front of her.
//
// The per-page test cried wolf: a chapter opening carries no folio, a stray
// number in the text gets read as one, and the header announced a broken
// offset on a page that was fine. One page disagreeing is noise. A fifth of
// the folio-bearing pages disagreeing is an offset, and that is the same
// evidence the page_offsets ranges were built from (migration 008).
export async function offsetLooksWrong(workId: string): Promise<boolean> {
  const sql = db();
  const rows = (await sql`
    select count(*) filter (where folio <> printed_page)::int as disagreeing,
           count(*)::int as with_folio
    from printed_pages
    where work_id = ${workId} and folio is not null
  `) as { disagreeing: number; with_folio: number }[];

  const row = rows[0];
  if (!row || row.with_folio < 20) return false;
  return row.disagreeing > row.with_folio * 0.2;
}

// The page a Preview shows: the one asked for, clamped to the pages held, or
// the first. Null when nothing has been loaded. Used by the workbench's
// Preview tab and the book page's.
export async function loadPreview(workId: string, p: string | undefined) {
  const bounds = await pageBounds(workId);
  if (!bounds) return null;
  const asked = Number.parseInt(p ?? '', 10);
  const wanted = Number.isNaN(asked)
    ? bounds.first
    : Math.min(Math.max(asked, bounds.first), bounds.last);
  const [page, offsetWrong] = await Promise.all([
    getPage(workId, wanted),
    offsetLooksWrong(workId),
  ]);
  return page ? { bounds, page, offsetWrong } : null;
}
