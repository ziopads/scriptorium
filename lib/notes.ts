// Notes and the anchors that place them.
//
// A note points at one or more passages. One anchor is an ordinary note; two or
// more is a connection between works, and both works show it — anchors are
// unordered peers rather than source and target, so no reciprocal bookkeeping
// exists and none is needed.
//
// An anchor is (work_id, printed_page, quote) and never a chunk id. Chunks are a
// derived cache that gets rebuilt; a chunk-anchored note is orphaned by the
// first re-chunk. Anchoring to a quotation also means a note can be written
// against a work that has not been extracted yet and still attach later.

import { db } from '@/lib/db';
import type {
  AnchorWithWork,
  Note,
  NoteInput,
  NoteRevision,
  NoteWithAnchors,
} from '@/lib/types';

type AnchorRow = AnchorWithWork;

// Anchors for a set of notes, in one query. Fetching per note would be one HTTP
// round trip each.
async function anchorsFor(noteIds: number[]): Promise<Map<number, AnchorWithWork[]>> {
  if (noteIds.length === 0) return new Map();

  const sql = db();
  const rows = (await sql`
    select na.note_id, na.ordinal, na.work_id, na.printed_page, na.quote,
           w.title as work_title, w.author as work_author
    from note_anchors na
    join works w on w.id = na.work_id
    where na.note_id = any(${noteIds})
    order by na.note_id, na.ordinal
  `) as AnchorRow[];

  const map = new Map<number, AnchorWithWork[]>();
  for (const row of rows) {
    const existing = map.get(row.note_id);
    if (existing) existing.push(row);
    else map.set(row.note_id, [row]);
  }
  return map;
}

async function withAnchors(notes: Note[]): Promise<NoteWithAnchors[]> {
  const map = await anchorsFor(notes.map((n) => n.id));
  return notes.map((note) => ({ ...note, anchors: map.get(note.id) ?? [] }));
}

export async function listNotesForWork(workId: string): Promise<NoteWithAnchors[]> {
  const sql = db();
  const notes = (await sql`
    select distinct n.id, n.body, n.tags, n.origin, n.reviewed,
           n.created_at, n.updated_at
    from notes n
    join note_anchors na on na.note_id = n.id
    where na.work_id = ${workId}
    order by n.created_at
  `) as Note[];
  return withAnchors(notes);
}

export async function listAllNotes(): Promise<NoteWithAnchors[]> {
  const sql = db();
  const notes = (await sql`
    select id, body, tags, origin, reviewed, created_at, updated_at
    from notes order by updated_at desc
  `) as Note[];
  return withAnchors(notes);
}

export async function getNote(id: number): Promise<NoteWithAnchors | null> {
  const sql = db();
  const notes = (await sql`
    select id, body, tags, origin, reviewed, created_at, updated_at
    from notes where id = ${id}
  `) as Note[];
  if (!notes[0]) return null;
  return (await withAnchors(notes))[0];
}

export async function listNotesByTag(tag: string): Promise<NoteWithAnchors[]> {
  const sql = db();
  const notes = (await sql`
    select id, body, tags, origin, reviewed, created_at, updated_at
    from notes where ${tag} = any(tags) order by updated_at desc
  `) as Note[];
  return withAnchors(notes);
}

// Substring search over her own writing and the passages she anchored to.
// Deliberately not the corpus search: it never touches chunks, and it works
// with nothing extracted.
export async function searchNotes(query: string): Promise<NoteWithAnchors[]> {
  const sql = db();
  const pattern = `%${query}%`;
  const notes = (await sql`
    select distinct n.id, n.body, n.tags, n.origin, n.reviewed,
           n.created_at, n.updated_at
    from notes n
    left join note_anchors na on na.note_id = n.id
    where n.body ilike ${pattern} or na.quote ilike ${pattern}
    order by n.updated_at desc
  `) as Note[];
  return withAnchors(notes);
}

export async function listUnreviewedNotes(): Promise<NoteWithAnchors[]> {
  const sql = db();
  const notes = (await sql`
    select id, body, tags, origin, reviewed, created_at, updated_at
    from notes where reviewed = false order by created_at desc
  `) as Note[];
  return withAnchors(notes);
}

// Notes with more than one anchor: the connections.
export async function listConnections(): Promise<NoteWithAnchors[]> {
  const sql = db();
  const notes = (await sql`
    select n.id, n.body, n.tags, n.origin, n.reviewed, n.created_at, n.updated_at
    from notes n
    join note_anchors na on na.note_id = n.id
    group by n.id
    having count(na.ordinal) > 1
    order by n.updated_at desc
  `) as Note[];
  return withAnchors(notes);
}

export async function allTags(): Promise<{ tag: string; count: number }[]> {
  const sql = db();
  const rows = await sql`
    select tag, count(*)::int as count
    from notes, unnest(tags) as tag
    group by tag order by count desc, tag
  `;
  return rows as { tag: string; count: number }[];
}

// A human note is reviewed on arrival, because writing one is reviewing it.
// draft_note will pass origin 'assistant', which flips reviewed to false.
export async function createNote(input: NoteInput): Promise<Note> {
  if (input.anchors.length === 0) {
    throw new Error('A note needs at least one anchor.');
  }

  const sql = db();
  const origin = input.origin ?? 'human';

  const rows = (await sql`
    insert into notes (body, tags, origin, reviewed)
    values (${input.body}, ${input.tags ?? []}, ${origin}, ${origin === 'human'})
    returning *
  `) as Note[];

  const note = rows[0];

  for (const [index, anchor] of input.anchors.entries()) {
    await sql`
      insert into note_anchors (note_id, ordinal, work_id, printed_page, quote)
      values (${note.id}, ${index + 1}, ${anchor.work_id},
              ${anchor.printed_page ?? null}, ${anchor.quote ?? null})
    `;
  }

  return note;
}

// A full replacement of the editable fields. The previous state is copied into
// note_revisions by a data-modifying CTE in the same statement — the HTTP driver
// gives no transaction across two calls, so a read-then-write would leave a
// window where an edit lands with no history. The `is distinct from` guard means
// opening the form and pressing Save writes no revision.
//
// The revision carries the first anchor's page and quote. Anchors themselves are
// not versioned; see the note in migration 004.
export async function updateNote(
  id: number,
  fields: { body: string; tags: string[] },
): Promise<Note> {
  const sql = db();
  const rows = (await sql`
    with previous as (
      insert into note_revisions
        (note_id, body, quote, printed_page, tags, origin, reviewed, written_at)
      select n.id, n.body, a.quote, a.printed_page, n.tags, n.origin, n.reviewed,
             n.updated_at
      from notes n
      left join note_anchors a on a.note_id = n.id and a.ordinal = 1
      where n.id = ${id}
        and (n.body is distinct from ${fields.body}
             or n.tags is distinct from ${fields.tags})
      returning note_id
    )
    update notes set
      body = ${fields.body}, tags = ${fields.tags},
      reviewed = true, updated_at = now()
    where id = ${id}
    returning *
  `) as Note[];
  return rows[0];
}

export async function setAnchor(
  noteId: number,
  ordinal: number,
  fields: { work_id: string; printed_page: number | null; quote: string | null },
): Promise<void> {
  const sql = db();
  await sql`
    insert into note_anchors (note_id, ordinal, work_id, printed_page, quote)
    values (${noteId}, ${ordinal}, ${fields.work_id}, ${fields.printed_page}, ${fields.quote})
    on conflict (note_id, ordinal) do update set
      work_id = excluded.work_id,
      printed_page = excluded.printed_page,
      quote = excluded.quote
  `;
}

export async function removeAnchor(noteId: number, ordinal: number): Promise<void> {
  const sql = db();
  await sql`delete from note_anchors where note_id = ${noteId} and ordinal = ${ordinal}`;
}

export async function nextAnchorOrdinal(noteId: number): Promise<number> {
  const sql = db();
  const rows = (await sql`
    select coalesce(max(ordinal), 0) + 1 as next from note_anchors where note_id = ${noteId}
  `) as { next: number }[];
  return rows[0].next;
}

// Deletion lives here and has no counterpart on the MCP server. Removing her own
// writing stays in the application, where an accidental tool call cannot reach it.
export async function deleteNote(id: number): Promise<void> {
  const sql = db();
  await sql`delete from notes where id = ${id}`;
}

export async function listRevisions(noteId: number): Promise<NoteRevision[]> {
  const sql = db();
  const rows = await sql`
    select id, note_id, body, quote, printed_page, tags, origin, reviewed,
           written_at, superseded_at
    from note_revisions where note_id = ${noteId}
    order by superseded_at desc
  `;
  return rows as NoteRevision[];
}
