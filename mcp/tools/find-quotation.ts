// find_quotation, ported from pipeline/mcp_server.py.
//
// Looks a passage up in a work's page text with the matcher draft_note uses
// (lib/matcher.ts, the port of dossier.Book.find, proven against the Python by
// the fixtures in tests/matcher/). Returns the book's own text at the match,
// the printed page where it was found, and whether the match was exact or
// close. A read tool: it writes nothing, and it reports front matter and
// non-citable works rather than refusing them, so the model can see why
// draft_note would.
//
// The Python's fields, in the same order of checks, plus page_label,
// pages_label and page_verified, the forms in which page numbers leave the app
// (lib/page-verified.ts). A match across a page break reads 40–41, or 40*–41*
// when the work's numbering is unverified.

import { FIRST_CITABLE_PAGE, MIN_QUOTE_CHARS, normalize } from '@/lib/matcher';
import { pageLabel } from '@/lib/page-verified';
import { loadBook } from '@/mcp/book';
import { ToolError, citable, workRecord } from '@/mcp/work';

// hit.pages is "40" or "40–41" (an en dash; a negative page carries an
// ASCII minus), so each number can be labelled on its own.
function labelPages(pages: string, unverified: boolean): string {
  return pages
    .split('\u2013')
    .map((p) => pageLabel(Number(p), unverified))
    .join('\u2013');
}

export async function findQuotation(workId: string, text: string, nearPage?: number | null) {
  const work = await workRecord(workId);
  const book = await loadBook(workId);
  if (Array.from(normalize(text)).length < MIN_QUOTE_CHARS) {
    throw new ToolError(`a quotation needs at least ${MIN_QUOTE_CHARS} characters to prove anything`);
  }
  const hit = book.find(text, nearPage ?? null, []);
  const reason = citable(work);
  if (!hit) return { found: false, work_id: workId };
  return {
    found: true,
    work_id: workId,
    text: hit.text,
    page: hit.page,
    pages: hit.pages,
    page_label: pageLabel(hit.page, work.unverified),
    pages_label: labelPages(hit.pages, work.unverified),
    page_verified: work.page_verified,
    match: hit.match,
    front_matter: hit.page < FIRST_CITABLE_PAGE,
    citable: reason === null,
    not_citable_because: reason,
    page_numbers: work.page_numbers,
  };
}
