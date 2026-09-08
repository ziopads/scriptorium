// Notes. The half of the September slice that needs no extracted text.
//
// A note anchors to (book_id, printed_page, quote) and never to a chunk id.
// Chunks are a derived cache that gets rebuilt; a chunk-anchored note is
// orphaned by the first re-chunk (N-8). The same property is what lets a note
// be written against a book that has not been extracted yet: the quotation is
// typed by hand now and re-locates itself later by searching for its own text
// (N-9).

import { db } from '@/lib/db';
import type { Note, NoteInput, NoteWithBook } from '@/lib/types';

export async function listNotesForBook(bookId: string): Promise<Note[]> {
  const sql = db();
  const rows = await sql`
    select id, book_id, printed_page, quote, body, tags, origin, reviewed,
           created_at, updated_at
    from notes
    where book_id = ${bookId}
    order by printed_page nulls last, created_at
  `;
  return rows as Note[];
}

// Everything, newest first. The default view of /notes — a notes page that shows
// nothing until you pick a filter is a filing cabinet you cannot open.
export async function listAllNotes(): Promise<NoteWithBook[]> {
  const sql = db();
  const rows = await sql`
    select n.id, n.book_id, n.printed_page, n.quote, n.body, n.tags,
           n.origin, n.reviewed, n.created_at, n.updated_at,
           b.title as book_title, b.author as book_author
    from notes n
    join books b on b.id = n.book_id
    order by n.updated_at desc
  `;
  return rows as NoteWithBook[];
}

export async function getNote(id: number): Promise<Note | null> {
  const sql = db();
  const rows = (await sql`
    select id, book_id, printed_page, quote, body, tags, origin, reviewed,
           created_at, updated_at
    from notes
    where id = ${id}
  `) as Note[];
  return rows[0] ?? null;
}

// One query with a join rather than two convenient ones, because each call is
// its own HTTP round trip.
export async function listNotesByTag(tag: string): Promise<NoteWithBook[]> {
  const sql = db();
  const rows = await sql`
    select n.id, n.book_id, n.printed_page, n.quote, n.body, n.tags,
           n.origin, n.reviewed, n.created_at, n.updated_at,
           b.title as book_title, b.author as book_author
    from notes n
    join books b on b.id = n.book_id
    where ${tag} = any(n.tags)
    order by b.author nulls last, n.printed_page nulls last
  `;
  return rows as NoteWithBook[];
}

// Plain substring search over her own writing and the passages she anchored to.
// This is deliberately not the corpus search from §4.4 — it never touches
// chunks, and it works in September when there are no chunks to touch.
export async function searchNotes(query: string): Promise<NoteWithBook[]> {
  const sql = db();
  const pattern = `%${query}%`;
  const rows = await sql`
    select n.id, n.book_id, n.printed_page, n.quote, n.body, n.tags,
           n.origin, n.reviewed, n.created_at, n.updated_at,
           b.title as book_title, b.author as book_author
    from notes n
    join books b on b.id = n.book_id
    where n.body ilike ${pattern} or n.quote ilike ${pattern}
    order by n.updated_at desc
  `;
  return rows as NoteWithBook[];
}

// Notes the assistant drafted that she has not yet read (N-6). The partial
// index on reviewed exists for this.
export async function listUnreviewedNotes(): Promise<NoteWithBook[]> {
  const sql = db();
  const rows = await sql`
    select n.id, n.book_id, n.printed_page, n.quote, n.body, n.tags,
           n.origin, n.reviewed, n.created_at, n.updated_at,
           b.title as book_title, b.author as book_author
    from notes n
    join books b on b.id = n.book_id
    where n.reviewed = false
    order by n.created_at desc
  `;
  return rows as NoteWithBook[];
}

export async function allTags(): Promise<{ tag: string; count: number }[]> {
  const sql = db();
  const rows = await sql`
    select tag, count(*)::int as count
    from notes, unnest(tags) as tag
    group by tag
    order by count desc, tag
  `;
  return rows as { tag: string; count: number }[];
}

// origin defaults to 'human', and a human note is reviewed on arrival because
// writing one is reviewing it. The draft_note tool passes origin: 'assistant',
// which flips reviewed to false.
export async function createNote(input: NoteInput): Promise<Note> {
  const sql = db();
  const origin = input.origin ?? 'human';

  const rows = (await sql`
    insert into notes (book_id, printed_page, quote, body, tags, origin, reviewed)
    values (
      ${input.book_id},
      ${input.printed_page ?? null},
      ${input.quote ?? null},
      ${input.body},
      ${input.tags ?? []},
      ${origin},
      ${origin === 'human'}
    )
    returning *
  `) as Note[];
  return rows[0];
}

// A full replacement of the editable fields rather than a patch. Building an
// update from whichever keys were passed turns a typo into a field that
// silently keeps its old value.
//
// Editing always sets reviewed and leaves origin alone, so the record of where
// a sentence came from survives the edit while its status changes.
export async function updateNote(
  id: number,
  fields: {
    body: string;
    quote: string | null;
    printed_page: number | null;
    tags: string[];
  },
): Promise<Note> {
  const sql = db();
  const rows = (await sql`
    update notes set
      body         = ${fields.body},
      quote        = ${fields.quote},
      printed_page = ${fields.printed_page},
      tags         = ${fields.tags},
      reviewed     = true,
      updated_at   = now()
    where id = ${id}
    returning *
  `) as Note[];
  return rows[0];
}

// Deletion lives here and has no counterpart on the MCP route. Correction and
// removal of her own writing stay in the application, where an accidental tool
// call cannot reach them.
export async function deleteNote(id: number): Promise<void> {
  const sql = db();
  await sql`delete from notes where id = ${id}`;
}
