import type { Timestamp } from '@/lib/dates';

export type WorkStatus = 'unread' | 'reading' | 'read';

// How far she has got with the book. Every work was seeded 'unread'; the
// stored values stay as they are and only the display changes.
export const STATUS_LABEL: Record<WorkStatus, string> = {
  unread: 'Not started',
  reading: 'Reading',
  read: 'Read',
};
export type SourceFormat = 'pdf_text' | 'pdf_ocr' | 'epub' | 'none';
export type NoteOrigin = 'human' | 'assistant';

// Why a file with unsettled numbering was accepted as it stands (migration 017).
export type PaginationBasis = 'hand_set' | 'none_printed';

export const PAGINATION_BASIS_LABEL: Record<PaginationBasis, string> = {
  hand_set: 'offset set by hand',
  none_printed: 'no printed page numbers',
};

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

  // How much it matters to her preparation, 1–5, null until she says. Distinct
  // from purpose (what it is for) and standing (how it got on the list);
  // null and 1 are different states, and the unrated list is the one she works
  // down (migration 007).
  priority: number | null;

  source_format: SourceFormat;
  source_path: string | null;
  r2_pages_key: string | null;
  page_offset: number;

  vivarium_item_id: number | null;
  notes_internal: string | null;

  // When a person accepted this file's pagination although offsets.py could
  // not settle it (migration 016). Null for almost everything. Set, the
  // pipeline stops holding the text back and every page number shown for the
  // work is marked unverified: the ebooks have no printed pagination to
  // recover, and a page cited from one has to be checked against the PDF.
  pagination_accepted_at: Timestamp | null;

  // Why it was accepted (migration 017). 'hand_set': an offset read from the
  // PDF and typed in; its page numbers are the edition's as far as anyone
  // looked, and are shown unmarked. 'none_printed': the file prints no page
  // numbers at all, so every page shown for the work is marked. Null when the
  // work has not been accepted.
  pagination_basis: PaginationBasis | null;

  created_at: Timestamp;
  updated_at: Timestamp;

  // Whether the pipeline has loaded any pages, computed in the query from the
  // pages table and never stored. Optional because upsertWork's `returning *`
  // does not carry it. Says the text can be opened in the workbench; says
  // nothing about whether its page numbers are the printed edition's, which is
  // what source_format records.
  has_pages?: boolean;
}

export type WorkInput = { id: string; title: string } & Partial<
  Omit<Work, 'id' | 'title' | 'created_at' | 'updated_at' | 'has_pages'>
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

// ---------------------------------------------------------------------------
// Notes: the graph (migration 005)
// ---------------------------------------------------------------------------
// Two node tables, works and notes; three edge tables. A note reaches a work
// two ways: note_works, an argument-level relation to the whole work with a
// role, and note_anchors, a passage with page and quote. A note reaches another
// note through note_links. An axis is a note whose parts are child notes.

// What she can write. synthesis and exam_move are parts of an axis, set by the
// axis form and never named to her.
export type NoteKind = 'note' | 'question' | 'ficha' | 'axis' | 'synthesis' | 'exam_move';

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  note: 'Note',
  question: 'Question',
  ficha: 'Ficha',
  axis: 'Axis',
  synthesis: 'How they connect',
  exam_move: 'Exam move',
};

// Whose claim the note asserts. Independent of origin, which records who typed
// the words. Null means not yet classified and is never defaulted: a wrong
// default is the misattribution the column exists to prevent.
export type Attribution = 'author' | 'own' | 'other';

export const ATTRIBUTION_LABEL: Record<Attribution, string> = {
  author: 'The author says it',
  own: 'I say it',
  other: 'Someone else says it',
};

// The relation between a note and a whole work. about, ficha and yield are set
// by the form; supports and disputes by accepting a proposal. Nothing picks
// from this list in a menu.
export type NoteRole =
  | 'about'
  | 'ficha'
  | 'yield'
  | 'supports'
  | 'disputes'
  | 'applies'
  | 'introduces';

export const NOTE_ROLE_LABEL: Record<NoteRole, string> = {
  about: 'about',
  ficha: 'ficha',
  yield: 'named in the synthesis',
  supports: 'supports',
  disputes: 'disputes',
  applies: 'applies',
  introduces: 'introduces',
};

export type LinkKind = 'bridge' | 'contrast' | 'answers';

export interface Note {
  id: number;
  kind: NoteKind;
  parent_id: number | null;      // the axis this part belongs to
  ordinal: number | null;        // position among its siblings
  title: string | null;          // 'Eje 1 — El tecolote y lo ominoso'; axes only
  body: string;                  // for an axis, the thesis
  attribution: Attribution | null;
  attributed_to: string | null;  // the third party, when attribution = 'other'
  tags: string[];
  origin: NoteOrigin;
  reviewed: boolean;
  rejected_at: Timestamp | null; // a hidden proposal; null for everything live
  created_at: Timestamp;
  updated_at: Timestamp;
}

// A passage: page and quote, with her translation beside the quote.
export interface NoteAnchor {
  note_id: number;
  ordinal: number;
  work_id: string;
  printed_page: number | null;
  quote: string | null;
  translation: string | null;
}

export interface AnchorWithWork extends NoteAnchor {
  work_title: string;
  work_author: string | null;
}

// An argument-level relation to a whole work.
export interface NoteWork {
  note_id: number;
  work_id: string;
  role: NoteRole;
  ordinal: number;
}

export interface NoteWorkWithWork extends NoteWork {
  work_title: string;
  work_author: string | null;
}

export interface NoteLink {
  from_note: number;
  to_note: number;
  kind: LinkKind;
}

// A note with both kinds of work relation resolved. Everything that renders a
// note reads this shape.
export interface NoteWithRelations extends Note {
  anchors: AnchorWithWork[];
  works: NoteWorkWithWork[];
}

// An axis with its parts. Membership in the map is the union of the parts'
// works; nothing is stored on the axis row itself.
export interface AxisTree {
  axis: NoteWithRelations;
  fichas: NoteWithRelations[];
  synthesis: NoteWithRelations | null;
  exam_move: NoteWithRelations | null;
}

export type NoteInput = {
  kind?: NoteKind;
  parent_id?: number | null;
  title?: string | null;
  body: string;
  attribution?: Attribution | null;
  attributed_to?: string | null;
  tags?: string[];
  origin?: NoteOrigin;
  anchors?: {
    work_id: string;
    printed_page?: number | null;
    quote?: string | null;
    translation?: string | null;
  }[];
  works?: { work_id: string; role?: NoteRole }[];
};

// A superseded state of a note. Versions the writing; anchors and memberships
// are not versioned (the known limit recorded in migration 004).
export interface NoteRevision {
  id: number;
  note_id: number;
  title: string | null;
  body: string;
  attribution: Attribution | null;
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
  | 'context'
  | 'themes';

export const DOSSIER_LABEL: Record<DossierKind, string> = {
  summary: 'What it is',
  author: 'The author',
  argument: 'The argument',
  key_terms: 'Key terms',
  reception: 'Reception',
  context: 'Context',
  themes: 'Bearing on the dissertation themes',
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
