// Reads for the Gaps tabs: what each book still lacks, computed from the
// database rather than from a register someone has to keep in step.
//
// The Files tab replaces the lists built on works.pdf_state, a column
// sync_books.py copied from books.csv. The pipeline stopped reading books.csv
// on 21 September, so pdf_state stopped changing when a book was loaded; the
// states below are worked out from source_path, pages and chunks instead.
//
// A file is "held" when works.source_path names one. The pipeline's rule is
// stricter (the PDF must sit in corpus/ACCOUNTED), and the app cannot see that
// folder; a source_path pointing elsewhere shows up when extract.py refuses
// the work.

import { db } from '@/lib/db';

export type FileState = 'no_pdf' | 'held' | 'loaded' | 'blocked' | 'searchable';

export const FILE_STATES: { id: FileState; label: string; blurb: string }[] = [
  {
    id: 'no_pdf',
    label: 'No PDF',
    blurb:
      'No file is recorded. The list to go shopping from: a library, an interlibrary loan, a bookshop.',
  },
  {
    id: 'held',
    label: 'PDF held, not extracted',
    blurb: 'A file is recorded but its pages have not been extracted and loaded. Next in the pipeline.',
  },
  {
    id: 'blocked',
    label: 'Page numbering to settle',
    blurb:
      'Pages loaded but held back from search because the printed page numbers could not be matched. See the Page numbers tab.',
  },
  {
    id: 'loaded',
    label: 'Loaded, not searchable',
    blurb: 'Pages are in and the numbering is settled, but the passages have not been embedded yet.',
  },
  {
    id: 'searchable',
    label: 'Searchable',
    blurb: 'Pages loaded, numbering checked, passages embedded. Nothing left to do for the file.',
  },
];

export interface FileRow {
  id: string;
  author: string | null;
  title: string;
  year: number | null;
  pdf_verdict: string | null;
  source_path: string | null;
  state: FileState;
}

// Every examinable book, essays excepted: an essay's file is its volume's.
export async function fileStates(): Promise<FileRow[]> {
  const sql = db();
  const rows = (await sql`
    select w.id, w.author, w.title, w.year, w.pdf_verdict, w.source_path,
           case
             when w.source_path is null then 'no_pdf'
             when not exists (select 1 from pages p where p.work_id = w.id) then 'held'
             when w.offset_problem is not null then 'blocked'
             when exists (select 1 from chunks c where c.work_id = w.id and c.embedding is not null)
               then 'searchable'
             else 'loaded'
           end as state
    from works w
    where w.container_id is null
      and exists (select 1 from examinable_works e where e.id = w.id)
    order by coalesce(w.author, w.title), w.year nulls last
  `) as FileRow[];
  return rows;
}

export interface AnalysisRow {
  id: string;
  author: string | null;
  title: string;
  year: number | null;
  has_aid: boolean;
  aid_at: string | null;
  claims: number;
  unreviewed: number;
  accepted: number;
}

// Every book with pages loaded: the ones a study aid could be made from.
export async function analysisStates(): Promise<AnalysisRow[]> {
  const sql = db();
  const rows = (await sql`
    select w.id, w.author, w.title, w.year,
           d.generated_at is not null as has_aid,
           d.generated_at as aid_at,
           coalesce(c.total, 0)::int as claims,
           coalesce(c.unreviewed, 0)::int as unreviewed,
           coalesce(c.accepted, 0)::int as accepted
    from works w
    left join dossier_sections d on d.work_id = w.id and d.kind = 'argument'
    left join lateral (
      select count(*) as total,
             count(*) filter (where n.reviewed = false and n.rejected_at is null) as unreviewed,
             count(*) filter (where n.reviewed = true and n.rejected_at is null) as accepted
      from notes n
      where 'dossier' = any(n.tags)
        and exists (select 1 from note_anchors a where a.note_id = n.id and a.work_id = w.id)
    ) c on true
    where exists (select 1 from pages p where p.work_id = w.id)
    order by (d.generated_at is not null), coalesce(w.author, w.title), w.year nulls last
  `) as AnalysisRow[];
  return rows;
}

export interface InternalNoteRow {
  id: string;
  author: string | null;
  title: string;
  year: number | null;
  notes_internal: string;
  offset_problem: string | null;
}

// Every work whose Internal note (works.notes_internal, on the edit page) is
// set: bad scans, partial copies, ebook pagination, anything known about a
// work's file that no computed state shows. Every work, not only examinable
// ones, since her dissertation additions have files too. An offset problem is
// carried alongside because the two are often about the same book.
export async function worksWithInternalNotes(): Promise<InternalNoteRow[]> {
  const sql = db();
  const rows = (await sql`
    select w.id, w.author, w.title, w.year, w.notes_internal, w.offset_problem
    from works w
    where nullif(btrim(w.notes_internal), '') is not null
    order by coalesce(w.author, w.title), w.year nulls last
  `) as InternalNoteRow[];
  return rows;
}

export interface UncheckedRow {
  id: string;
  author: string | null;
  title: string;
  year: number | null;
  page_offset: number;
}

// Pages loaded, page numbering never checked by offsets.py. Nothing downstream
// that cites a page (sections, a dossier) should run on these until it is.
export async function uncheckedOffsets(): Promise<UncheckedRow[]> {
  const sql = db();
  const rows = (await sql`
    select w.id, w.author, w.title, w.year, w.page_offset
    from works w
    where w.offset_checked_at is null and w.offset_problem is null
      and exists (select 1 from pages p where p.work_id = w.id)
    order by coalesce(w.author, w.title), w.year nulls last
  `) as UncheckedRow[];
  return rows;
}
