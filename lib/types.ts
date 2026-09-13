import type { Timestamp } from '@/lib/dates';

export type WorkStatus = 'unread' | 'reading' | 'read';
export type SourceFormat = 'pdf_text' | 'pdf_ocr' | 'epub' | 'none';
export type NoteOrigin = 'human' | 'assistant';

// What the work is for.
export type Purpose = 'comps' | 'both' | 'dissertation' | 'unassigned';

// How it got onto the list. Separate from purpose so that a work her advisors
// excluded can still be central to the dissertation.
export type Standing = 'assigned' | 'added' | 'excluded';

// One table holds monographs, the essays inside them, and films, because the
// reading list cites all three as items.
export type WorkKind =
  | 'monograph'
  | 'edited_volume'
  | 'essay'
  | 'chapter'
  | 'poem'
  | 'film'
  | 'dictionary'
  | 'anthology';

export const PURPOSE_CODE: Record<Purpose, string> = {
  comps: 'c',
  both: 'c/d',
  dissertation: 'd',
  unassigned: 'x',
};

export const PURPOSE_LABEL: Record<Purpose, string> = {
  comps: 'Comps only',
  both: 'Comps and dissertation',
  dissertation: 'Dissertation only',
  unassigned: 'Not yet decided',
};

export const STANDING_LABEL: Record<Standing, string> = {
  assigned: 'On the assigned list',
  added: 'Added by her',
  excluded: 'Excluded by advisors as non-canonical',
};

export const KIND_LABEL: Record<WorkKind, string> = {
  monograph: 'Monograph',
  edited_volume: 'Edited volume',
  essay: 'Essay',
  chapter: 'Chapter',
  poem: 'Poem',
  film: 'Film',
  dictionary: 'Dictionary',
  anthology: 'Anthology',
};

export interface Work {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;          // for a film, the director
  translator: string | null;
  editor: string | null;
  publisher: string | null;
  place: string | null;
  year: number | null;
  edition: string | null;
  language: string | null;

  kind: WorkKind;
  container_id: string | null;    // the volume an essay sits in
  first_page: number | null;      // its span within that volume
  last_page: number | null;

  // The superset any citation style needs. Which style the department wants is
  // a formatting decision; a field nobody recorded is unrecoverable.
  isbn: string | null;
  volume: string | null;          // 'vol. 17', '2 vols.'
  series: string | null;
  original_year: number | null;   // 1919 for "Lo ominoso"
  url: string | null;
  doi: string | null;
  accessed: string | null;

  status: WorkStatus;
  purpose: Purpose;
  standing: Standing;
  standing_note: string | null;
  source_format: SourceFormat;
  source_path: string | null;
  r2_pages_key: string | null;
  page_offset: number;

  vivarium_item_id: number | null;
  notes_internal: string | null;

  created_at: Timestamp;
  updated_at: Timestamp;
}

export type WorkInput = { id: string; title: string } & Partial<
  Omit<Work, 'id' | 'title' | 'created_at' | 'updated_at'>
>;

// A work with its container resolved, for citation. An essay cites through its
// volume: title and page range from the child, imprint from the parent.
export interface WorkWithContainer extends Work {
  container: Work | null;
}

export interface ExamList {
  id: string;
  name: string;
  description: string | null;
  examinable: boolean;
  sort: number;
}

export interface ListSection {
  id: string;
  list_id: string;
  letter: string | null;
  title: string;
  kind: 'core' | 'supplementary';
  sort: number;
}

export interface ListMembership extends ExamList {
  section_id: string | null;
  section_title: string | null;
  section_letter: string | null;
  section_kind: 'core' | 'supplementary' | null;
  rationale: string | null;
  ordinal: number | null;
}

// A note points at one or more places. One anchor is an ordinary note; two or
// more is a connection between passages, and both works show it.
export interface NoteAnchor {
  note_id: number;
  ordinal: number;
  work_id: string;
  printed_page: number | null;
  quote: string | null;
}

export interface AnchorWithWork extends NoteAnchor {
  work_title: string;
  work_author: string | null;
}

export interface Note {
  id: number;
  body: string;
  tags: string[];
  origin: NoteOrigin;
  reviewed: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface NoteWithAnchors extends Note {
  anchors: AnchorWithWork[];
}

export type NoteInput = {
  body: string;
  tags?: string[];
  origin?: NoteOrigin;
  anchors: { work_id: string; printed_page?: number | null; quote?: string | null }[];
};

// A superseded state of a note. Versions the writing, not the anchors.
export interface NoteRevision {
  id: number;
  note_id: number;
  body: string;
  quote: string | null;
  printed_page: number | null;
  tags: string[];
  origin: NoteOrigin;
  reviewed: boolean;
  written_at: Timestamp;
  superseded_at: Timestamp;
}

export type DossierKind =
  | 'summary'
  | 'author'
  | 'argument'
  | 'key_terms'
  | 'reception'
  | 'context';

export const DOSSIER_LABEL: Record<DossierKind, string> = {
  summary: 'What it is',
  author: 'The author',
  argument: 'The argument',
  key_terms: 'Key terms',
  reception: 'Reception',
  context: 'Context',
};

export interface DossierSection {
  work_id: string;
  kind: DossierKind;
  body: string;
  sources: string[];
  origin: NoteOrigin;
  reviewed: boolean;
  model: string | null;
  generated_at: Timestamp | null;
  updated_at: Timestamp;
}
