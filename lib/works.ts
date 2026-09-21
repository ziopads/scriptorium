// Reads and writes for the catalogue.
//
// Replaces lib/books.ts. The table is `works` because it holds monographs, the
// essays inside them, and films — the reading list cites all three as items.
//
// Column lists are written out in full rather than `select *`, and repeated
// rather than held in a constant, because the Neon tagged template interpolates
// values and not identifiers. Writes use `returning *`.

import { db } from '@/lib/db';
import type {
  ExamList,
  ListMembership,
  ListSection,
  Purpose,
  Standing,
  Work,
  WorkInput,
  WorkWithContainer,
} from '@/lib/types';

const COLS = `
  id, title, subtitle, author, translator, editor, publisher, place, year,
  edition, language, kind, container_id, first_page, last_page,
  isbn, volume, series, original_year, url, doi, accessed,
  status, purpose, standing, standing_note, priority, source_format, source_path,
  r2_pages_key, page_offset, vivarium_item_id, notes_internal,
  created_at, updated_at
`;

export async function listWorks(): Promise<Work[]> {
  const sql = db();
  const rows = await sql`
    select id, title, subtitle, author, translator, editor, publisher, place, year,
           edition, language, kind, container_id, first_page, last_page,
           isbn, volume, series, original_year, url, doi, accessed,
           status, purpose, standing, standing_note, priority, source_format, source_path,
           r2_pages_key, page_offset, vivarium_item_id, notes_internal,
           created_at, updated_at
    from works
    order by coalesce(author, title), year nulls last
  `;
  return rows as Work[];
}

export async function getWork(id: string): Promise<Work | null> {
  const sql = db();
  const rows = (await sql`
    select id, title, subtitle, author, translator, editor, publisher, place, year,
           edition, language, kind, container_id, first_page, last_page,
           isbn, volume, series, original_year, url, doi, accessed,
           status, purpose, standing, standing_note, priority, source_format, source_path,
           r2_pages_key, page_offset, vivarium_item_id, notes_internal,
           created_at, updated_at
    from works
    where id = ${id}
  `) as Work[];
  return rows[0] ?? null;
}

// A work with its container resolved. An essay's citation draws its title and
// page range from the child and the imprint from the parent, so both records
// have to arrive together — one query rather than two round trips.
export async function getWorkWithContainer(
  id: string,
): Promise<WorkWithContainer | null> {
  const work = await getWork(id);
  if (!work) return null;
  const container = work.container_id ? await getWork(work.container_id) : null;
  return { ...work, container };
}

// The essays and chapters inside a volume, in page order.
export async function listContents(containerId: string): Promise<Work[]> {
  const sql = db();
  const rows = await sql`
    select id, title, subtitle, author, translator, editor, publisher, place, year,
           edition, language, kind, container_id, first_page, last_page,
           isbn, volume, series, original_year, url, doi, accessed,
           status, purpose, standing, standing_note, priority, source_format, source_path,
           r2_pages_key, page_offset, vivarium_item_id, notes_internal,
           created_at, updated_at
    from works
    where container_id = ${containerId}
    order by first_page nulls last, title
  `;
  return rows as Work[];
}

export async function listExamLists(): Promise<ExamList[]> {
  const sql = db();
  const rows = await sql`
    select id, name, description, examinable, sort from exam_lists order by sort
  `;
  return rows as ExamList[];
}

export async function listSections(listId?: string): Promise<ListSection[]> {
  const sql = db();
  const rows = listId
    ? await sql`
        select id, list_id, letter, title, kind, sort
        from list_sections where list_id = ${listId} order by sort
      `
    : await sql`
        select id, list_id, letter, title, kind, sort
        from list_sections order by list_id, sort
      `;
  return rows as ListSection[];
}

// Which lists a work sits on, and where in each. Used on the work page.
export async function membershipsFor(workId: string): Promise<ListMembership[]> {
  const sql = db();
  const rows = await sql`
    select el.id, el.name, el.description, el.examinable, el.sort,
           ls.id as section_id, ls.title as section_title,
           ls.letter as section_letter, ls.kind as section_kind,
           li.rationale, li.ordinal
    from list_items li
    join exam_lists el on el.id = li.list_id
    left join list_sections ls on ls.id = li.section_id
    where li.work_id = ${workId}
    order by el.sort, ls.sort
  `;
  return rows as ListMembership[];
}

// Every membership at once, for the catalogue and the CSV export. Calling
// membershipsFor per work would be one HTTP round trip per row.
export async function allMemberships(): Promise<
  { work_id: string; list: string; section: string | null; kind: string | null }[]
> {
  const sql = db();
  const rows = await sql`
    select li.work_id, el.name as list, ls.title as section, ls.kind
    from list_items li
    join exam_lists el on el.id = li.list_id
    left join list_sections ls on ls.id = li.section_id
    order by el.sort, ls.sort, li.ordinal
  `;
  return rows as { work_id: string; list: string; section: string | null; kind: string | null }[];
}

export async function listWorksInList(listId: string): Promise<Work[]> {
  const sql = db();
  const rows = await sql`
    select w.id, w.title, w.subtitle, w.author, w.translator, w.editor,
           w.publisher, w.place, w.year, w.edition, w.language, w.kind,
           w.container_id, w.first_page, w.last_page,
           w.isbn, w.volume, w.series, w.original_year, w.url, w.doi, w.accessed,
           w.status, w.purpose, w.standing, w.standing_note, w.priority, w.source_format,
           w.source_path, w.r2_pages_key, w.page_offset, w.vivarium_item_id,
           w.notes_internal, w.created_at, w.updated_at
    from works w
    join list_items li on li.work_id = w.id
    left join list_sections ls on ls.id = li.section_id
    where li.list_id = ${listId}
    order by ls.sort nulls last, li.ordinal nulls last, coalesce(w.author, w.title)
  `;
  return rows as Work[];
}

// Examinable is derived, never stored: a work counts if it is on an examinable
// list, or if its container is. A stored flag would be a second source of truth
// and would drift the first time an item moved between lists.
export async function examinableIds(): Promise<Set<string>> {
  const sql = db();
  const rows = (await sql`select id from examinable_works`) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

export async function upsertWork(input: WorkInput): Promise<Work> {
  const sql = db();
  const w = input;

  const rows = (await sql`
    insert into works (
      id, title, subtitle, author, translator, editor, publisher, place, year,
      edition, language, kind, container_id, first_page, last_page,
      isbn, volume, series, original_year, url, doi, accessed,
      status, purpose, standing, standing_note, priority, source_format, source_path,
      r2_pages_key, page_offset, vivarium_item_id, notes_internal, updated_at
    ) values (
      ${w.id}, ${w.title}, ${w.subtitle ?? null}, ${w.author ?? null},
      ${w.translator ?? null}, ${w.editor ?? null}, ${w.publisher ?? null},
      ${w.place ?? null}, ${w.year ?? null}, ${w.edition ?? null},
      ${w.language ?? null}, ${w.kind ?? 'monograph'}, ${w.container_id ?? null},
      ${w.first_page ?? null}, ${w.last_page ?? null},
      ${w.isbn ?? null}, ${w.volume ?? null}, ${w.series ?? null},
      ${w.original_year ?? null}, ${w.url ?? null}, ${w.doi ?? null},
      ${w.accessed ?? null},
      ${w.status ?? 'unread'}, ${w.purpose ?? 'unassigned'},
      ${w.standing ?? 'assigned'}, ${w.standing_note ?? null},
      ${w.priority ?? null},
      ${w.source_format ?? 'none'}, ${w.source_path ?? null},
      ${w.r2_pages_key ?? null}, ${w.page_offset ?? 0},
      ${w.vivarium_item_id ?? null}, ${w.notes_internal ?? null}, now()
    )
    on conflict (id) do update set
      title = excluded.title, subtitle = excluded.subtitle,
      author = excluded.author, translator = excluded.translator,
      editor = excluded.editor, publisher = excluded.publisher,
      place = excluded.place, year = excluded.year, edition = excluded.edition,
      language = excluded.language, kind = excluded.kind,
      container_id = excluded.container_id, first_page = excluded.first_page,
      last_page = excluded.last_page, isbn = excluded.isbn,
      volume = excluded.volume, series = excluded.series,
      original_year = excluded.original_year, url = excluded.url,
      doi = excluded.doi, accessed = excluded.accessed,
      status = excluded.status, purpose = excluded.purpose,
      standing = excluded.standing, standing_note = excluded.standing_note,
      priority = excluded.priority,
      source_format = excluded.source_format, source_path = excluded.source_path,
      r2_pages_key = excluded.r2_pages_key, page_offset = excluded.page_offset,
      vivarium_item_id = excluded.vivarium_item_id,
      notes_internal = excluded.notes_internal, updated_at = now()
    returning *
  `) as Work[];

  return rows[0];
}

export async function setStatus(id: string, status: Work['status']): Promise<void> {
  const sql = db();
  await sql`update works set status = ${status}, updated_at = now() where id = ${id}`;
}

export async function setPageOffset(id: string, offset: number): Promise<void> {
  const sql = db();
  await sql`update works set page_offset = ${offset}, updated_at = now() where id = ${id}`;
}

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
    update works set
      author = ${fields.author}, publisher = ${fields.publisher},
      place = ${fields.place}, year = ${fields.year}, updated_at = now()
    where id = ${id}
  `;
}

// One work rated, from the star control on a catalogue row. Zero means clear
// it: she has decided it is unrated again, which is not the same as rating it
// low, and the column allows null for exactly that reason.
export async function setPriority(id: string, priority: number | null): Promise<void> {
  const sql = db();
  await sql`update works set priority = ${priority}, updated_at = now() where id = ${id}`;
}

export async function characterizeWorks(
  ids: string[],
  fields: { purpose?: Purpose; standing?: Standing; priority?: number | null },
): Promise<number> {
  if (ids.length === 0) return 0;
  // priority is the one field whose null is a real value, so it needs its own
  // presence test: 'priority' in fields distinguishes "clear it" from "leave
  // it alone", which coalesce alone cannot.
  const clearing = 'priority' in fields && fields.priority === null;
  if (!fields.purpose && !fields.standing && !fields.priority && !clearing) return 0;

  const sql = db();
  const rows = (await sql`
    update works set
      purpose  = coalesce(${fields.purpose ?? null}, purpose),
      standing = coalesce(${fields.standing ?? null}, standing),
      priority = case when ${clearing} then null
                      else coalesce(${fields.priority ?? null}, priority) end,
      updated_at = now()
    where id = any(${ids})
    returning id
  `) as { id: string }[];
  return rows.length;
}

export async function setStandingNote(id: string, note: string | null): Promise<void> {
  const sql = db();
  await sql`update works set standing_note = ${note}, updated_at = now() where id = ${id}`;
}

export async function addToList(
  listId: string,
  workId: string,
  sectionId?: string | null,
  rationale?: string | null,
  ordinal?: number | null,
): Promise<void> {
  const sql = db();
  await sql`
    insert into list_items (list_id, work_id, section_id, rationale, ordinal)
    values (${listId}, ${workId}, ${sectionId ?? null}, ${rationale ?? null}, ${ordinal ?? null})
    on conflict (list_id, work_id) do update set
      section_id = excluded.section_id,
      rationale  = excluded.rationale,
      ordinal    = excluded.ordinal
  `;
}

export async function removeFromList(listId: string, workId: string): Promise<void> {
  const sql = db();
  await sql`delete from list_items where list_id = ${listId} and work_id = ${workId}`;
}

// The fields a citation needs. language and source_format describe the file
// rather than the entry, so they are deliberately absent. An essay is judged on
// its container's imprint, not its own.
export interface WorkWithoutPdf {
  id: string;
  author: string | null;
  title: string;
  year: number | null;
  code: string;
  list_name: string;
  supplementary: boolean;
  pdf_state: string | null;
  pdf_verdict: string | null;
  source_path: string | null;
}

// Works on an examination list with no usable PDF, and works whose PDF is
// waiting on OCR. The first group is a shopping list — nobody but her can act
// on it, and until now it existed only in a terminal.
//
// pdf_state is written by pipeline/sync_books.py from books.csv, which is the
// register a person edits. A null state means nobody has looked yet, which is
// different from having looked and found nothing, so it is reported apart.
export async function worksWithoutPdf(): Promise<{
  none: WorkWithoutPdf[];
  queued: WorkWithoutPdf[];
  unknown: WorkWithoutPdf[];
}> {
  const sql = db();
  const rows = (await sql`
    select w.id, w.author, w.title, w.year,
           w.pdf_state, w.pdf_verdict, w.source_path,
           coalesce(el.name, '') as list_name,
           coalesce(s.title, '') as section,
           coalesce(s.letter, '') as letter,
           li.ordinal,
           coalesce(el.sort, 99) as list_sort
    from list_items li
    join works w on w.id = li.work_id
    join exam_lists el on el.id = li.list_id and el.examinable
    left join list_sections s on s.id = li.section_id
    where w.pdf_state is distinct from 'loaded'
      and w.pdf_state is distinct from 'ready'
    order by el.sort, li.ordinal
  `) as {
    id: string; author: string | null; title: string; year: number | null;
    pdf_state: string | null; pdf_verdict: string | null; source_path: string | null;
    list_name: string; section: string; letter: string; ordinal: number;
  }[];

  const shaped = rows.map((r) => {
    const numeral = r.list_name.split('.')[0];
    const supplementary = r.section === 'Supplementary';
    return {
      id: r.id,
      author: r.author,
      title: r.title,
      year: r.year,
      list_name: r.list_name,
      supplementary,
      pdf_state: r.pdf_state,
      pdf_verdict: r.pdf_verdict,
      source_path: r.source_path,
      code: supplementary
        ? `${numeral}.Supl.${r.ordinal}`
        : `${numeral}.${r.letter}.${r.ordinal}`,
    };
  });

  return {
    none: shaped.filter((w) => w.pdf_state === 'none'),
    queued: shaped.filter((w) => w.pdf_state === 'queued'),
    unknown: shaped.filter((w) => w.pdf_state === null),
  };
}

// Works whose page numbering pipeline/offsets.py could not settle (migration
// 014). Each stays out of sections, chunks and embeddings until its offset is
// fixed and offsets.py is run on it again, which clears the problem. Listed
// together so they can be settled in one sitting.
export interface WorkWithOffsetProblem {
  id: string;
  author: string | null;
  title: string;
  year: number | null;
  page_offset: number;
  offset_problem: string;
  offset_checked_at: string;
}

export async function worksWithOffsetProblems(): Promise<WorkWithOffsetProblem[]> {
  const sql = db();
  const rows = await sql`
    select id, author, title, year, page_offset, offset_problem, offset_checked_at
    from works
    where offset_problem is not null
    order by coalesce(author, title), year nulls last
  `;
  return rows as WorkWithOffsetProblem[];
}

export async function incompleteWorks(): Promise<{ work: Work; missing: string[] }[]> {
  const works = await listWorks();
  const byId = new Map(works.map((w) => [w.id, w]));

  return works
    .map((work) => {
      const imprint = work.container_id ? byId.get(work.container_id) ?? work : work;
      const missing: string[] = [];
      if (!work.author && !work.editor && !imprint.editor) missing.push('author');
      if (!imprint.publisher) missing.push('publisher');
      if (!imprint.place) missing.push('place');
      if (imprint.year === null) missing.push('year');
      return { work, missing };
    })
    .filter((entry) => entry.missing.length > 0);
}

export async function worksWithoutSource(): Promise<Work[]> {
  const sql = db();
  const rows = await sql`
    select id, title, subtitle, author, translator, editor, publisher, place, year,
           edition, language, kind, container_id, first_page, last_page,
           isbn, volume, series, original_year, url, doi, accessed,
           status, purpose, standing, standing_note, priority, source_format, source_path,
           r2_pages_key, page_offset, vivarium_item_id, notes_internal,
           created_at, updated_at
    from works
    where source_format = 'none' and container_id is null
    order by coalesce(author, title)
  `;
  return rows as Work[];
}

// ---------------------------------------------------------------------------
// The workbench list
// ---------------------------------------------------------------------------

// One row per work, with what the left pane shows: the list code as she uses
// it ([II.C.17], Supl. III), which list it sits on, whether a file is held,
// how many notes touch it, and whether it is examinable. One query; the pane
// filters the 160 rows in memory. The code is derived here and never stored
// (migration 004).
export interface WorkbenchRow {
  id: string;
  title: string;
  author: string | null;
  year: number | null;
  kind: string;
  container_id: string | null;
  list_id: string | null;
  code: string | null;
  has_file: boolean;
  note_count: number;
  examinable: boolean;
  standing: string;
  priority: number | null;
  pdf_state: string | null;
}

export async function listWorkbenchRows(): Promise<WorkbenchRow[]> {
  const sql = db();
  const rows = await sql`
    select w.id, w.title, w.author, w.year, w.kind, w.container_id, w.standing,
           w.priority, w.pdf_state,
           m.list_id,
           m.code,
           (w.source_format <> 'none') as has_file,
           (select count(*)::int from (
              select note_id from note_anchors where work_id = w.id
              union
              select note_id from note_works where work_id = w.id
            ) t
            join notes n on n.id = t.note_id
            where n.rejected_at is null) as note_count,
           exists (select 1 from examinable_works e where e.id = w.id) as examinable
    from works w
    left join lateral (
      select li.list_id,
             case el.id
               when 'theory' then 'I' when 'dissertation' then 'II' when 'teaching' then 'III'
               else null end as roman,
             case
               when el.id not in ('theory', 'dissertation', 'teaching') then null
               when ls.kind = 'supplementary' then
                 'Supl. ' || case el.id when 'theory' then 'I' when 'dissertation' then 'II' else 'III' end
               else
                 case el.id when 'theory' then 'I' when 'dissertation' then 'II' else 'III' end
                 || '.' || coalesce(ls.letter, '?') || '.' || coalesce(li.ordinal::text, '?')
             end as code
      from list_items li
      join exam_lists el on el.id = li.list_id
      left join list_sections ls on ls.id = li.section_id
      where li.work_id = w.id
      order by el.sort
      limit 1
    ) m on true
    order by coalesce(w.author, w.title), w.year nulls last
  `;
  return rows as WorkbenchRow[];
}
