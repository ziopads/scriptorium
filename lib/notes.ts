// Notes: the graph.
//
// Two node tables, works and notes; three edge tables. A note reaches a work
// in two ways. note_works is an argument-level relation to the whole work with
// a role ('about', 'ficha', 'yield', 'supports', 'disputes'); note_anchors is a
// passage, with printed page, verbatim quote and her translation. The fichas in
// her mapa cite no pages, which is why the two are separate tables rather than
// anchor rows with null page and null quote. A note reaches another note
// through note_links.
//
// An anchor is (work_id, printed_page, quote) and never a chunk id. Chunks are a
// derived cache that gets rebuilt; a chunk-anchored note is orphaned by the
// first re-chunk. Anchoring to a quotation also means a note can be written
// against a work that has not been extracted yet and still attach later.
//
// An axis is a note of kind 'axis' whose body is the thesis; its fichas,
// synthesis and exam move are child notes via parent_id. Membership of a work
// in an axis is derived from the children (the axis_works view) and never
// stored on the axis row.
//
// Column lists are written out in full because the Neon tagged template
// interpolates values, never identifiers.

import { db } from '@/lib/db';
import type {
  AnchorWithWork,
  Attribution,
  AxisTree,
  LinkKind,
  Note,
  NoteInput,
  NoteLink,
  NoteRevision,
  NoteRole,
  NoteWithRelations,
  NoteWorkWithWork,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Relations, in one query per kind rather than one per note
// ---------------------------------------------------------------------------

async function anchorsFor(noteIds: number[]): Promise<Map<number, AnchorWithWork[]>> {
  const map = new Map<number, AnchorWithWork[]>();
  if (noteIds.length === 0) return map;

  const sql = db();
  const rows = (await sql`
    select na.note_id, na.ordinal, na.work_id, na.printed_page, na.quote,
           na.translation,
           w.title as work_title, w.author as work_author
    from note_anchors na
    join works w on w.id = na.work_id
    where na.note_id = any(${noteIds})
    order by na.note_id, na.ordinal
  `) as AnchorWithWork[];

  for (const row of rows) {
    const existing = map.get(row.note_id);
    if (existing) existing.push(row);
    else map.set(row.note_id, [row]);
  }
  return map;
}

async function worksFor(noteIds: number[]): Promise<Map<number, NoteWorkWithWork[]>> {
  const map = new Map<number, NoteWorkWithWork[]>();
  if (noteIds.length === 0) return map;

  const sql = db();
  const rows = (await sql`
    select nw.note_id, nw.work_id, nw.role, nw.ordinal,
           w.title as work_title, w.author as work_author
    from note_works nw
    join works w on w.id = nw.work_id
    where nw.note_id = any(${noteIds})
    order by nw.note_id, nw.ordinal, w.title
  `) as NoteWorkWithWork[];

  for (const row of rows) {
    const existing = map.get(row.note_id);
    if (existing) existing.push(row);
    else map.set(row.note_id, [row]);
  }
  return map;
}

async function withRelations(notes: Note[]): Promise<NoteWithRelations[]> {
  const ids = notes.map((n) => n.id);
  const [anchors, works] = await Promise.all([anchorsFor(ids), worksFor(ids)]);
  return notes.map((note) => ({
    ...note,
    anchors: anchors.get(note.id) ?? [],
    works: works.get(note.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Reads. Every list excludes rejected proposals unless it is the rejected list.
// ---------------------------------------------------------------------------

export async function listNotesForWork(workId: string): Promise<NoteWithRelations[]> {
  const sql = db();
  const notes = (await sql`
    select n.id, n.kind, n.parent_id, n.ordinal, n.title, n.body,
           n.attribution, n.attributed_to, n.tags, n.origin, n.reviewed,
           n.rejected_at, n.created_at, n.updated_at
    from notes n
    where n.rejected_at is null
      and (exists (select 1 from note_anchors a where a.note_id = n.id and a.work_id = ${workId})
        or exists (select 1 from note_works  m where m.note_id = n.id and m.work_id = ${workId}))
    order by n.created_at
  `) as Note[];
  return withRelations(notes);
}

// Top-level notes: not parts of an axis. Fichas live on their axis page.
export async function listAllNotes(): Promise<NoteWithRelations[]> {
  const sql = db();
  const notes = (await sql`
    select id, kind, parent_id, ordinal, title, body, attribution, attributed_to,
           tags, origin, reviewed, rejected_at, created_at, updated_at
    from notes
    where rejected_at is null and parent_id is null
    order by updated_at desc
  `) as Note[];
  return withRelations(notes);
}

export async function getNote(id: number): Promise<NoteWithRelations | null> {
  const sql = db();
  const notes = (await sql`
    select id, kind, parent_id, ordinal, title, body, attribution, attributed_to,
           tags, origin, reviewed, rejected_at, created_at, updated_at
    from notes where id = ${id}
  `) as Note[];
  if (!notes[0]) return null;
  return (await withRelations(notes))[0];
}

export async function listNotesByTag(tag: string): Promise<NoteWithRelations[]> {
  const sql = db();
  const notes = (await sql`
    select id, kind, parent_id, ordinal, title, body, attribution, attributed_to,
           tags, origin, reviewed, rejected_at, created_at, updated_at
    from notes
    where ${tag} = any(tags) and rejected_at is null
    order by updated_at desc
  `) as Note[];
  return withRelations(notes);
}

// Substring search over her own writing, her translations, and the passages
// she anchored to. Deliberately not the corpus search: it never touches chunks
// and it works with nothing extracted.
export async function searchNotes(query: string): Promise<NoteWithRelations[]> {
  const sql = db();
  const pattern = `%${query}%`;
  const notes = (await sql`
    select distinct n.id, n.kind, n.parent_id, n.ordinal, n.title, n.body,
           n.attribution, n.attributed_to, n.tags, n.origin, n.reviewed,
           n.rejected_at, n.created_at, n.updated_at
    from notes n
    left join note_anchors na on na.note_id = n.id
    where n.rejected_at is null
      and (n.body ilike ${pattern} or n.title ilike ${pattern}
           or na.quote ilike ${pattern} or na.translation ilike ${pattern})
    order by n.updated_at desc
  `) as Note[];
  return withRelations(notes);
}

// The proposals queue: assistant notes she has not yet accepted.
export async function listUnreviewedNotes(): Promise<NoteWithRelations[]> {
  const sql = db();
  const notes = (await sql`
    select id, kind, parent_id, ordinal, title, body, attribution, attributed_to,
           tags, origin, reviewed, rejected_at, created_at, updated_at
    from notes
    where reviewed = false and rejected_at is null
    order by created_at desc
  `) as Note[];
  return withRelations(notes);
}

export async function listRejectedNotes(): Promise<NoteWithRelations[]> {
  const sql = db();
  const notes = (await sql`
    select id, kind, parent_id, ordinal, title, body, attribution, attributed_to,
           tags, origin, reviewed, rejected_at, created_at, updated_at
    from notes
    where rejected_at is not null
    order by rejected_at desc
  `) as Note[];
  return withRelations(notes);
}

// Claims she has not yet said whose they are.
export async function listUnattributedNotes(): Promise<NoteWithRelations[]> {
  const sql = db();
  const notes = (await sql`
    select id, kind, parent_id, ordinal, title, body, attribution, attributed_to,
           tags, origin, reviewed, rejected_at, created_at, updated_at
    from notes
    where attribution is null and rejected_at is null
      and kind in ('note', 'ficha', 'synthesis', 'exam_move')
    order by updated_at desc
  `) as Note[];
  return withRelations(notes);
}

// A reported claim with no passage behind it: the first thing an examiner
// presses on. Reads the unsupported_claims view from migration 005.
export async function listUnsupportedClaims(): Promise<NoteWithRelations[]> {
  const sql = db();
  const notes = (await sql`
    select n.id, n.kind, n.parent_id, n.ordinal, n.title, n.body,
           n.attribution, n.attributed_to, n.tags, n.origin, n.reviewed,
           n.rejected_at, n.created_at, n.updated_at
    from notes n
    join unsupported_claims u on u.id = n.id
    order by n.updated_at desc
  `) as Note[];
  return withRelations(notes);
}

// Questions nothing has answered yet.
export async function listOpenQuestions(): Promise<NoteWithRelations[]> {
  const sql = db();
  const notes = (await sql`
    select n.id, n.kind, n.parent_id, n.ordinal, n.title, n.body,
           n.attribution, n.attributed_to, n.tags, n.origin, n.reviewed,
           n.rejected_at, n.created_at, n.updated_at
    from notes n
    where n.kind = 'question' and n.rejected_at is null
      and not exists (select 1 from note_links l where l.to_note = n.id and l.kind = 'answers')
    order by n.created_at desc
  `) as Note[];
  return withRelations(notes);
}

// Notes that touch more than one work, through anchors or memberships.
export async function listConnections(): Promise<NoteWithRelations[]> {
  const sql = db();
  const notes = (await sql`
    select n.id, n.kind, n.parent_id, n.ordinal, n.title, n.body,
           n.attribution, n.attributed_to, n.tags, n.origin, n.reviewed,
           n.rejected_at, n.created_at, n.updated_at
    from notes n
    where n.rejected_at is null and n.kind <> 'axis'
      and (select count(distinct work_id) from (
             select work_id from note_anchors where note_id = n.id
             union
             select work_id from note_works   where note_id = n.id
           ) t) > 1
    order by n.updated_at desc
  `) as Note[];
  return withRelations(notes);
}

export async function allTags(): Promise<{ tag: string; count: number }[]> {
  const sql = db();
  const rows = await sql`
    select tag, count(*)::int as count
    from notes, unnest(tags) as tag
    where rejected_at is null
    group by tag order by count desc, tag
  `;
  return rows as { tag: string; count: number }[];
}

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

export async function listAxes(): Promise<
  (NoteWithRelations & { ficha_count: number; work_count: number })[]
> {
  const sql = db();
  const notes = (await sql`
    select n.id, n.kind, n.parent_id, n.ordinal, n.title, n.body,
           n.attribution, n.attributed_to, n.tags, n.origin, n.reviewed,
           n.rejected_at, n.created_at, n.updated_at,
           (select count(*)::int from notes c
             where c.parent_id = n.id and c.kind = 'ficha' and c.rejected_at is null)
             as ficha_count,
           (select count(distinct work_id)::int from axis_works aw where aw.axis_id = n.id)
             as work_count
    from notes n
    where n.kind = 'axis' and n.rejected_at is null
    order by n.ordinal nulls last, n.created_at
  `) as (Note & { ficha_count: number; work_count: number })[];
  const related = await withRelations(notes);
  return related.map((note, i) => ({
    ...note,
    ficha_count: notes[i].ficha_count,
    work_count: notes[i].work_count,
  }));
}

export async function getAxisTree(id: number): Promise<AxisTree | null> {
  const axis = await getNote(id);
  if (!axis || axis.kind !== 'axis') return null;

  const sql = db();
  const children = (await sql`
    select id, kind, parent_id, ordinal, title, body, attribution, attributed_to,
           tags, origin, reviewed, rejected_at, created_at, updated_at
    from notes
    where parent_id = ${id} and rejected_at is null
    order by ordinal nulls last, created_at
  `) as Note[];
  const parts = await withRelations(children);

  return {
    axis,
    fichas: parts.filter((p) => p.kind === 'ficha'),
    synthesis: parts.find((p) => p.kind === 'synthesis') ?? null,
    exam_move: parts.find((p) => p.kind === 'exam_move') ?? null,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function nextSiblingOrdinal(parentId: number | null, kind: string): Promise<number> {
  const sql = db();
  const rows = (parentId === null
    ? await sql`
        select coalesce(max(ordinal), 0) + 1 as next from notes
        where parent_id is null and kind = ${kind}
      `
    : await sql`
        select coalesce(max(ordinal), 0) + 1 as next from notes
        where parent_id = ${parentId} and kind = ${kind}
      `) as { next: number }[];
  return rows[0].next;
}

// A human note is reviewed on arrival, because writing one is reviewing it.
// draft_note passes origin 'assistant', which leaves reviewed false.
//
// Only a ficha must name a work: it is a paragraph about what a work
// contributes and means nothing without one. Every other kind may stand alone;
// her notes on Leal's periodisation are about nothing on the list.
//
// Each call is its own round trip on the HTTP driver, so the row and its
// relations are not one transaction. A failure between them leaves a note
// with fewer relations than asked for, which the page will show.
export async function createNote(input: NoteInput): Promise<Note> {
  const kind = input.kind ?? 'note';
  const anchors = input.anchors ?? [];
  const works = input.works ?? [];

  if (kind === 'ficha' && works.length === 0) {
    throw new Error('A ficha names at least one work.');
  }
  if (input.attributed_to && input.attribution !== 'other') {
    throw new Error('attributed_to only means something when someone else says it.');
  }

  const sql = db();
  const origin = input.origin ?? 'human';
  const ordinal = kind === 'axis' || input.parent_id != null
    ? await nextSiblingOrdinal(input.parent_id ?? null, kind)
    : null;

  const rows = (await sql`
    insert into notes (kind, parent_id, ordinal, title, body, attribution,
                       attributed_to, tags, origin, reviewed)
    values (${kind}, ${input.parent_id ?? null}, ${ordinal}, ${input.title ?? null},
            ${input.body}, ${input.attribution ?? null}, ${input.attributed_to ?? null},
            ${input.tags ?? []}, ${origin}, ${origin === 'human'})
    returning *
  `) as Note[];
  const note = rows[0];

  for (const [index, anchor] of anchors.entries()) {
    await sql`
      insert into note_anchors (note_id, ordinal, work_id, printed_page, quote, translation)
      values (${note.id}, ${index + 1}, ${anchor.work_id},
              ${anchor.printed_page ?? null}, ${anchor.quote ?? null},
              ${anchor.translation ?? null})
    `;
  }

  for (const [index, work] of works.entries()) {
    await sql`
      insert into note_works (note_id, work_id, role, ordinal)
      values (${note.id}, ${work.work_id}, ${work.role ?? 'about'}, ${index + 1})
      on conflict (note_id, work_id) do nothing
    `;
  }

  return note;
}

// A full replacement of the editable fields. The previous state is copied into
// note_revisions by a data-modifying CTE in the same statement: the HTTP driver
// gives no transaction across two calls, so a read-then-write would leave a
// window where an edit lands with no history. The `is distinct from` guard
// means opening the form and pressing Save writes no revision.
//
// Editing sets reviewed and leaves origin alone, so the record of where a
// sentence came from survives the edit.
export async function updateNote(
  id: number,
  fields: {
    title?: string | null;
    body: string;
    attribution?: Attribution | null;
    attributed_to?: string | null;
    tags: string[];
  },
): Promise<Note> {
  const attribution = fields.attribution ?? null;
  const attributedTo = attribution === 'other' ? (fields.attributed_to ?? null) : null;

  const sql = db();
  const rows = (await sql`
    with previous as (
      insert into note_revisions
        (note_id, title, body, attribution, tags, origin, reviewed, written_at)
      select n.id, n.title, n.body, n.attribution, n.tags, n.origin, n.reviewed,
             n.updated_at
      from notes n
      where n.id = ${id}
        and (n.body is distinct from ${fields.body}
             or n.title is distinct from ${fields.title ?? null}
             or n.attribution is distinct from ${attribution}
             or n.attributed_to is distinct from ${attributedTo}
             or n.tags is distinct from ${fields.tags})
      returning note_id
    )
    update notes set
      title = ${fields.title ?? null}, body = ${fields.body},
      attribution = ${attribution}, attributed_to = ${attributedTo},
      tags = ${fields.tags}, reviewed = true, updated_at = now()
    where id = ${id}
    returning *
  `) as Note[];
  return rows[0];
}

export async function setAnchor(
  noteId: number,
  ordinal: number,
  fields: {
    work_id: string;
    printed_page: number | null;
    quote: string | null;
    translation: string | null;
  },
): Promise<void> {
  const sql = db();
  await sql`
    insert into note_anchors (note_id, ordinal, work_id, printed_page, quote, translation)
    values (${noteId}, ${ordinal}, ${fields.work_id}, ${fields.printed_page},
            ${fields.quote}, ${fields.translation})
    on conflict (note_id, ordinal) do update set
      work_id = excluded.work_id,
      printed_page = excluded.printed_page,
      quote = excluded.quote,
      translation = excluded.translation
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

export async function setWork(noteId: number, workId: string, role: NoteRole): Promise<void> {
  const sql = db();
  await sql`
    insert into note_works (note_id, work_id, role, ordinal)
    values (${noteId}, ${workId}, ${role},
            (select coalesce(max(ordinal), 0) + 1 from note_works where note_id = ${noteId}))
    on conflict (note_id, work_id) do update set role = excluded.role
  `;
}

export async function removeWork(noteId: number, workId: string): Promise<void> {
  const sql = db();
  await sql`delete from note_works where note_id = ${noteId} and work_id = ${workId}`;
}

export async function addLink(from: number, to: number, kind: LinkKind): Promise<void> {
  const sql = db();
  await sql`
    insert into note_links (from_note, to_note, kind)
    values (${from}, ${to}, ${kind})
    on conflict do nothing
  `;
}

export async function linksFor(noteId: number): Promise<
  (NoteLink & { other_id: number; other_kind: string; other_title: string | null; other_body: string; direction: 'out' | 'in' })[]
> {
  const sql = db();
  const rows = await sql`
    select l.from_note, l.to_note, l.kind,
           case when l.from_note = ${noteId} then l.to_note else l.from_note end as other_id,
           case when l.from_note = ${noteId} then 'out' else 'in' end as direction,
           o.kind as other_kind, o.title as other_title, o.body as other_body
    from note_links l
    join notes o on o.id = case when l.from_note = ${noteId} then l.to_note else l.from_note end
    where (l.from_note = ${noteId} or l.to_note = ${noteId})
      and o.rejected_at is null
    order by l.kind
  `;
  return rows as (NoteLink & { other_id: number; other_kind: string; other_title: string | null; other_body: string; direction: 'out' | 'in' })[];
}

// Accepting a proposal. origin stays 'assistant' so that a year from now she
// can still tell which connections she found and which she confirmed.
export async function approveNote(id: number): Promise<void> {
  const sql = db();
  await sql`update notes set reviewed = true, updated_at = now() where id = ${id}`;
}

// Rejecting hides rather than deletes, so a proposal can be reconsidered.
export async function rejectNote(id: number): Promise<void> {
  const sql = db();
  await sql`update notes set rejected_at = now() where id = ${id}`;
}

export async function restoreNote(id: number): Promise<void> {
  const sql = db();
  await sql`update notes set rejected_at = null where id = ${id}`;
}

// Deletion lives here and has no counterpart on the MCP server. Removing her
// own writing stays in the application, where an accidental tool call cannot
// reach it. Deleting an axis cascades to its parts.
export async function deleteNote(id: number): Promise<void> {
  const sql = db();
  await sql`delete from notes where id = ${id}`;
}

export async function listRevisions(noteId: number): Promise<NoteRevision[]> {
  const sql = db();
  const rows = await sql`
    select id, note_id, title, body, attribution, tags, origin, reviewed,
           written_at, superseded_at
    from note_revisions where note_id = ${noteId}
    order by superseded_at desc
  `;
  return rows as NoteRevision[];
}
