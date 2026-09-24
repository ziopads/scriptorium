// draft_note, ported from pipeline/mcp_server.py: the one write.
//
// Proposes a note for her review, anchored to one or more quotations, every
// one looked up with lib/matcher.ts (the port of dossier.Book.find, proven
// against the Python by tests/matcher/). What is stored is the book's own
// text at the match and the printed page where it was found; the model's
// wording and page number are discarded.
//
// WHAT IT GUARANTEES, as the Python does:
//
//   One quotation that is not found, is on front matter, is shorter than 25
//   characters, or comes from a work whose page numbering is unchecked, or
//   unsettled and not accepted, refuses the whole note. Nothing is written.
//
//   The note goes in with origin 'assistant' and reviewed false, set here
//   explicitly because the table's defaults are 'human' and true, so it lands
//   in her proposals queue. Attribution is 'author', 'other' (with
//   attributed_to) or left empty; 'own' is refused, since whether a claim is
//   hers is hers to say. The 'dossier' tag is refused: it would move the note
//   out of the proposals queue and onto the book's claims page.
//
//   Note and anchors are written together. The Neon HTTP driver has no
//   interactive transaction, and sql.transaction() cannot pass the new note's
//   id from one statement to the next, so both inserts are one statement: a
//   data-modifying WITH query, which Postgres runs atomically.
//
// Validation follows the Python line for line, including its one oddity: an
// attribution of '' is refused with "attribution is 'author', 'other' or
// empty", because empty there means omitted.

import { db } from '@/lib/db';
import { FIRST_CITABLE_PAGE, MIN_QUOTE_CHARS, normalize, type Book, type Hit } from '@/lib/matcher';
import { pageLabel } from '@/lib/page-verified';
import { loadBook } from '@/mcp/book';
import { ToolError, citable, workRecord, type WorkRecord } from '@/mcp/work';

export type QuotationInput = { work_id: string; text: string; near_page?: number | null };

type Verified = { work: WorkRecord; hit: Hit };

function labelPages(pages: string, unverified: boolean): string {
  return pages
    .split('\u2013')
    .map((p) => pageLabel(Number(p), unverified))
    .join('\u2013');
}

export async function draftNote(args: {
  body?: string | null;
  quotations?: QuotationInput[] | null;
  attribution?: string | null;
  attributed_to?: string | null;
  title?: string | null;
  tags?: string[] | null;
}) {
  const body = (args.body ?? '').trim();
  if (!body) throw new ToolError('the note needs a body');
  const quotations = args.quotations ?? [];
  if (quotations.length === 0) throw new ToolError('a note needs at least one quotation');
  const attribution = args.attribution ?? null;
  if (attribution === 'own') {
    throw new ToolError("'own' is hers to assign; leave attribution empty for your own analysis");
  }
  if (attribution !== null && attribution !== 'author' && attribution !== 'other') {
    throw new ToolError("attribution is 'author', 'other' or empty");
  }
  if (args.attributed_to && attribution !== 'other') {
    throw new ToolError("attributed_to goes only with attribution 'other'");
  }
  if (attribution === 'other' && !(args.attributed_to ?? '').trim()) {
    throw new ToolError("attribution 'other' needs attributed_to");
  }
  const tags = (args.tags ?? []).filter((t) => t && t.trim()).map((t) => t.trim());
  if (tags.includes('dossier')) {
    throw new ToolError("the 'dossier' tag is reserved for dossier.py's claims");
  }

  const verified: Verified[] = [];
  const failures: string[] = [];
  const books = new Map<string, Book>();
  for (const [i, q] of quotations.entries()) {
    const n = i + 1;
    const work = await workRecord(q.work_id);
    const reason = citable(work);
    if (reason) {
      failures.push(`quotation ${n} (${q.work_id}): ${reason}`);
      continue;
    }
    if (Array.from(normalize(q.text)).length < MIN_QUOTE_CHARS) {
      failures.push(`quotation ${n}: shorter than ${MIN_QUOTE_CHARS} characters`);
      continue;
    }
    let book = books.get(q.work_id);
    if (!book) {
      book = await loadBook(q.work_id);
      books.set(q.work_id, book);
    }
    const hit = book.find(q.text, q.near_page ?? null, []);
    if (!hit) {
      failures.push(`quotation ${n} (${q.work_id}): not found in the page text`);
      continue;
    }
    if (hit.page < FIRST_CITABLE_PAGE) {
      failures.push(`quotation ${n} (${q.work_id}): on front matter, printed page ${hit.page}`);
      continue;
    }
    verified.push({ work, hit });
  }
  if (failures.length) throw new ToolError('nothing written:\n' + failures.join('\n'));

  const title = (args.title ?? '').trim() || null;
  const attributedTo = (args.attributed_to ?? '').trim() || null;
  const workIds = verified.map((v) => v.work.id);
  const pages = verified.map((v) => v.hit.page);
  const quotes = verified.map((v) => v.hit.text);

  // A data-modifying WITH query runs whether or not the outer query reads it.
  const rows = (await db()`
    with note as (
      insert into notes (kind, title, body, attribution, attributed_to, tags, origin, reviewed)
      values ('note', ${title}, ${body}, ${attribution}, ${attributedTo}, ${tags}::text[], 'assistant', false)
      returning id
    ), anchors as (
      insert into note_anchors (note_id, ordinal, work_id, printed_page, quote)
      select note.id, a.ordinal, a.work_id, a.printed_page, a.quote
      from note, unnest(${workIds}::text[], ${pages}::int[], ${quotes}::text[])
        with ordinality as a(work_id, printed_page, quote, ordinal)
    )
    select id from note
  `) as { id: number | string }[];

  return {
    note_id: Number(rows[0].id),
    status: 'proposal awaiting her review',
    attribution,
    quotations: verified.map(({ work, hit }) => ({
      work_id: work.id,
      pages: hit.pages,
      pages_label: labelPages(hit.pages, work.unverified),
      page_verified: work.page_verified,
      match: hit.match,
      stored: hit.text,
    })),
  };
}
