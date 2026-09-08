// Reads and writes for the catalogue. Shared by the web pages and, later, by
// the get_book tool on the MCP route, so that retrieval logic exists once.
//
// Column lists are written out in full rather than `select *`, so that adding a
// column to the schema does not silently change what every caller receives.
// They are repeated rather than held in a constant because the Neon driver's
// tagged template interpolates values, not identifiers, and smuggling a column
// list through that would mean reaching for an escape hatch on every query.
// Writes use `returning *`, where the shape is the whole row by definition.

import { db } from '@/lib/db';
import type { Book, BookInput, BookListEntry, ExamList } from '@/lib/types';

export async function listBooks(): Promise<Book[]> {
  const sql = db();
  const rows = await sql`
    select id, title, subtitle, author, translator, editor, publisher, place,
           year, edition, language, status, source_format, source_path,
           r2_pages_key, page_offset, vivarium_item_id, notes_internal,
           created_at, updated_at
    from books
    order by coalesce(author, title), year nulls last
  `;
  return rows as Book[];
}

export async function listBooksInList(listId: string): Promise<Book[]> {
  const sql = db();
  const rows = await sql`
    select b.id, b.title, b.subtitle, b.author, b.translator, b.editor,
           b.publisher, b.place, b.year, b.edition, b.language, b.status,
           b.source_format, b.source_path, b.r2_pages_key, b.page_offset,
           b.vivarium_item_id, b.notes_internal, b.created_at, b.updated_at
    from books b
    join list_items li on li.book_id = b.id
    where li.list_id = ${listId}
    order by li.sort nulls last, coalesce(b.author, b.title)
  `;
  return rows as Book[];
}

export async function getBook(id: string): Promise<Book | null> {
  const sql = db();
  const rows = (await sql`
    select id, title, subtitle, author, translator, editor, publisher, place,
           year, edition, language, status, source_format, source_path,
           r2_pages_key, page_offset, vivarium_item_id, notes_internal,
           created_at, updated_at
    from books
    where id = ${id}
  `) as Book[];
  return rows[0] ?? null;
}

export async function booksWithoutSource(): Promise<Book[]> {
  const sql = db();
  const rows = await sql`
    select id, title, subtitle, author, translator, editor, publisher, place,
           year, edition, language, status, source_format, source_path,
           r2_pages_key, page_offset, vivarium_item_id, notes_internal,
           created_at, updated_at
    from books
    where source_format = 'none'
    order by coalesce(author, title)
  `;
  return rows as Book[];
}

export async function listExamLists(): Promise<ExamList[]> {
  const sql = db();
  const rows = await sql`
    select id, name, description, sort from exam_lists order by sort
  `;
  return rows as ExamList[];
}

// The landing page wants counts beside the list names, and a second query per
// list would be four more round trips.
export async function listExamListsWithCounts(): Promise<
  (ExamList & { count: number })[]
> {
  const sql = db();
  const rows = await sql`
    select el.id, el.name, el.description, el.sort,
           count(li.book_id)::int as count
    from exam_lists el
    left join list_items li on li.list_id = el.id
    group by el.id, el.name, el.description, el.sort
    order by el.sort
  `;
  return rows as (ExamList & { count: number })[];
}

// The four fields incompleteBooks() reports on, updated on their own. The gaps
// table fills these repetitively across twenty-odd records, and routing that
// through upsertBook would make every save rewrite eighteen columns it was
// never shown.
export async function updateImprint(
  id: string,
  fields: {
    author: string | null;
    publisher: string | null;
    place: string | null;
    year: number | null;
  },
): Promise<void> {
  const sql = db();
  await sql`
    update books set
      author     = ${fields.author},
      publisher  = ${fields.publisher},
      place      = ${fields.place},
      year       = ${fields.year},
      updated_at = now()
    where id = ${id}
  `;
}

// Every list membership in one query. The export needs list names for all 85
// books, and calling listsForBook() per book would be 85 separate HTTP round
// trips through the Neon driver.
export async function allListMemberships(): Promise<
  { book_id: string; name: string; rationale: string | null }[]
> {
  const sql = db();
  const rows = await sql`
    select li.book_id, el.name, li.rationale
    from list_items li
    join exam_lists el on el.id = li.list_id
    order by el.sort
  `;
  return rows as { book_id: string; name: string; rationale: string | null }[];
}

// Which lists a book sits on, with the rationale for each membership (C-5).
export async function listsForBook(bookId: string): Promise<BookListEntry[]> {
  const sql = db();
  const rows = await sql`
    select el.id, el.name, el.description, el.sort, li.rationale
    from list_items li
    join exam_lists el on el.id = li.list_id
    where li.book_id = ${bookId}
    order by el.sort
  `;
  return rows as BookListEntry[];
}

// Insert or replace a whole book record. Every column is named explicitly:
// building the column list from whichever keys the caller happened to pass
// makes a typo into a silently ignored field, and this table is the citation
// spine for everything above it.
export async function upsertBook(input: BookInput): Promise<Book> {
  const sql = db();
  const b = input;

  const rows = (await sql`
    insert into books (
      id, title, subtitle, author, translator, editor, publisher, place, year,
      edition, language, status, source_format, source_path, r2_pages_key,
      page_offset, vivarium_item_id, notes_internal, updated_at
    ) values (
      ${b.id},
      ${b.title},
      ${b.subtitle ?? null},
      ${b.author ?? null},
      ${b.translator ?? null},
      ${b.editor ?? null},
      ${b.publisher ?? null},
      ${b.place ?? null},
      ${b.year ?? null},
      ${b.edition ?? null},
      ${b.language ?? null},
      ${b.status ?? 'unread'},
      ${b.source_format ?? 'none'},
      ${b.source_path ?? null},
      ${b.r2_pages_key ?? null},
      ${b.page_offset ?? 0},
      ${b.vivarium_item_id ?? null},
      ${b.notes_internal ?? null},
      now()
    )
    on conflict (id) do update set
      title            = excluded.title,
      subtitle         = excluded.subtitle,
      author           = excluded.author,
      translator       = excluded.translator,
      editor           = excluded.editor,
      publisher        = excluded.publisher,
      place            = excluded.place,
      year             = excluded.year,
      edition          = excluded.edition,
      language         = excluded.language,
      status           = excluded.status,
      source_format    = excluded.source_format,
      source_path      = excluded.source_path,
      r2_pages_key     = excluded.r2_pages_key,
      page_offset      = excluded.page_offset,
      vivarium_item_id = excluded.vivarium_item_id,
      notes_internal   = excluded.notes_internal,
      updated_at       = now()
    returning *
  `) as Book[];

  return rows[0];
}

// Status changes are frequent and touch nothing else, so they get their own
// call rather than a full upsert that could clobber a field entered elsewhere.
export async function setStatus(
  id: string,
  status: Book['status'],
): Promise<void> {
  const sql = db();
  await sql`
    update books set status = ${status}, updated_at = now() where id = ${id}
  `;
}

export async function setPageOffset(id: string, offset: number): Promise<void> {
  const sql = db();
  await sql`
    update books set page_offset = ${offset}, updated_at = now() where id = ${id}
  `;
}

export async function addToList(
  listId: string,
  bookId: string,
  rationale?: string | null,
  sort?: number | null,
): Promise<void> {
  const sql = db();
  await sql`
    insert into list_items (list_id, book_id, rationale, sort)
    values (${listId}, ${bookId}, ${rationale ?? null}, ${sort ?? null})
    on conflict (list_id, book_id) do update set
      rationale = excluded.rationale,
      sort      = excluded.sort
  `;
}

export async function removeFromList(
  listId: string,
  bookId: string,
): Promise<void> {
  const sql = db();
  await sql`
    delete from list_items where list_id = ${listId} and book_id = ${bookId}
  `;
}

// C-2: which records are incomplete, at a glance. The fields listed here are
// the ones a Chicago entry needs; language and source_format are deliberately
// not among them, since they describe the file rather than the citation.
export async function incompleteBooks(): Promise<
  { book: Book; missing: string[] }[]
> {
  const books = await listBooks();

  return books
    .map((book) => {
      const missing: string[] = [];
      if (!book.author && !book.editor) missing.push('author');
      if (!book.publisher) missing.push('publisher');
      if (!book.place) missing.push('place');
      if (book.year === null) missing.push('year');
      return { book, missing };
    })
    .filter((entry) => entry.missing.length > 0);
}
