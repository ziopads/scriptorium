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

// Two rows can share a printed page where the offset ranges overlap or step
// backwards: an unnumbered plate insert that the range before it runs through,
// or a page scanned twice (14 of 103 works, October 2026). Until those pages
// can be marked as unnumbered, the choice between them is made here rather
// than left to row order: first the row whose folio reads the number it is
// given, then the later scan, which is the text page in every plate case.
export async function getPage(workId: string, printedPage: number): Promise<PageText | null> {
  const sql = db();
  const rows = (await sql`
    select page_index, printed_page, folio, text
    from printed_pages
    where work_id = ${workId} and printed_page = ${printedPage}
    order by (folio = printed_page) desc nulls last, page_index desc
    limit 1
  `) as PageText[];
  return rows[0] ?? null;
}

// The nearest printed pages held on either side of one that is not, for the
// links offered where a page is missing from the file.
async function neighbours(
  workId: string,
  printedPage: number,
): Promise<{ before: number | null; after: number | null }> {
  const sql = db();
  const rows = (await sql`
    select max(printed_page) filter (where printed_page < ${printedPage})::int as before,
           min(printed_page) filter (where printed_page > ${printedPage})::int as after
    from printed_pages
    where work_id = ${workId}
  `) as { before: number | null; after: number | null }[];
  return rows[0] ?? { before: null, after: null };
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

// The page a Preview shows: the one asked for, clamped to the range held, or
// the first. Null only when nothing has been loaded for the work.
//
// A number inside the range can still have no page behind it: a blank verso
// the scan left out, a plate, a leaf missing from the copy. Then page is null
// and missing carries the nearest pages held, so the viewer keeps its controls
// and says the page is not in the file. Returning null here instead is what
// told her a loaded book had never been loaded (Derrida, Mal de archivo, p. 23).
export interface Preview {
  bounds: PageBounds;
  printedPage: number;
  page: PageText | null;
  missing: { before: number | null; after: number | null } | null;
  offsetWrong: boolean;
}

export async function loadPreview(workId: string, p: string | undefined): Promise<Preview | null> {
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
  const missing = page ? null : await neighbours(workId, wanted);
  return { bounds, printedPage: wanted, page, missing, offsetWrong };
}
