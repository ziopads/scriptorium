// read_pages, ported from pipeline/mcp_server.py.
//
// Pages are selected by printed page through the printed_pages view, so a
// leaf scanned twice comes back twice and a printed page missing from the
// file comes back not at all (docs/PAGE-NUMBERS.md §1). Each page says how
// sure its own number is, from its folio; the work says how far its numbering
// as a whole can be trusted (page_numbers, page_verified), and each page
// carries page_label, the number as the app shows it.

import { db } from '@/lib/db';
import { pageLabel } from '@/lib/page-verified';
import { ToolError, citable, workRecord } from '@/mcp/work';

export const MAX_PAGES_PER_READ = 10;
const FIRST_CITABLE_PAGE = 1; // below this is front matter (dossier.py)

type Row = { page_index: number; printed_page: number; folio: number | null; text: string };

export async function readPages(workId: string, firstPage: number, lastPage?: number | null) {
  const last = lastPage ?? firstPage;
  if (last < firstPage) throw new ToolError('last_page comes before first_page');
  if (last - firstPage + 1 > MAX_PAGES_PER_READ) {
    throw new ToolError(`at most ${MAX_PAGES_PER_READ} pages per call`);
  }

  const work = await workRecord(workId);
  const rows = (await db()`
    select page_index, printed_page, folio, text from printed_pages
    where work_id = ${workId} and printed_page between ${firstPage} and ${last}
    order by page_index
  `) as Row[];
  if (rows.length === 0) {
    throw new ToolError(`${workId}: no loaded pages printed ${firstPage}–${last}`);
  }

  const pages = rows.map((r) => {
    let number: string;
    if (r.printed_page < FIRST_CITABLE_PAGE) number = 'front matter';
    else if (r.folio === null) number = 'computed';
    else if (r.folio === r.printed_page) number = 'printed';
    else number = `warning: the page reads ${r.folio}`;
    return {
      page: r.printed_page,
      page_label: pageLabel(r.printed_page, work.unverified),
      file_page: r.page_index,
      number,
      text: r.text,
    };
  });

  const reason = citable(work);
  return {
    work_id: workId,
    title: work.title,
    citable: reason === null,
    not_citable_because: reason,
    page_numbers: work.page_numbers,
    page_verified: work.page_verified,
    internal_note: work.internal_note,
    pages,
  };
}
