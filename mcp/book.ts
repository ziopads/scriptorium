// A work's pages as the quotation matcher reads them. Ported from load_book()
// in pipeline/mcp_server.py: every page of the work, in file order, with its
// printed page from the printed_pages view (docs/PAGE-NUMBERS.md), in one
// query. The largest work is about 1.8 million characters, well inside the
// Neon HTTP driver's response limit.

import { db } from '@/lib/db';
import { Book, type Page } from '@/lib/matcher';
import { ToolError } from '@/mcp/work';

type Row = { page_index: number; printed_page: number; text: string };

export async function loadBook(workId: string): Promise<Book> {
  const rows = (await db()`
    select page_index, printed_page, text from printed_pages
    where work_id = ${workId}
    order by page_index
  `) as Row[];
  if (rows.length === 0) throw new ToolError(`${workId}: no pages loaded`);
  const pages: Page[] = rows.map((r) => ({ index: r.page_index, printed: r.printed_page, text: r.text }));
  return new Book(pages);
}
