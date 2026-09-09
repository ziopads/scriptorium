// Row shapes, matching db/schema.sql column-for-column.
//
// These are the database's names, not prettier ones. A camelCase layer here
// would mean every query result needs mapping and every mismatch is a silent
// undefined, which is a poor trade for one reader's application.

import type { Timestamp } from '@/lib/dates';

export type BookStatus = 'unread' | 'reading' | 'read';
export type SourceFormat = 'pdf_text' | 'pdf_ocr' | 'epub' | 'none';
export type NoteOrigin = 'human' | 'assistant';

// What the book is for.
export type Purpose = 'comps' | 'both' | 'dissertation' | 'unassigned';

// How it got onto the list. Kept separate from purpose so that a book her
// advisors excluded can still be central to the dissertation, and so that the
// difference between the assigned list and hers stays queryable.
export type Standing = 'assigned' | 'added' | 'excluded';

// Short forms for the catalogue, where 85 rows of "dissertation" would crowd
// out the titles.
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

export interface Book {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  translator: string | null;
  editor: string | null;
  publisher: string | null;
  place: string | null;
  year: number | null;
  edition: string | null;
  language: string | null;

  status: BookStatus;
  purpose: Purpose;
  standing: Standing;
  standing_note: string | null;
  source_format: SourceFormat;
  source_path: string | null;
  r2_pages_key: string | null;
  page_offset: number;

  vivarium_item_id: number | null;
  notes_internal: string | null;

  // The Neon driver parses timestamptz into a Date. Declaring these as string
  // was a lie the compiler accepted and the runtime did not.
  created_at: Timestamp;
  updated_at: Timestamp;
}

// Everything except the generated and defaulted columns. Every bibliographic
// field is optional because blank beats a guess (C-2).
export type BookInput = {
  id: string;
  title: string;
} & Partial<Omit<Book, 'id' | 'title' | 'created_at' | 'updated_at'>>;

export interface ExamList {
  id: string;
  name: string;
  description: string | null;
  sort: number;
}

export interface ListMembership {
  list_id: string;
  book_id: string;
  rationale: string | null;
  sort: number | null;
}

// A list joined to its membership row, for showing which lists a book sits on
// and why (C-5).
export interface BookListEntry extends ExamList {
  rationale: string | null;
}

export interface Note {
  id: number;
  book_id: string;
  printed_page: number | null;
  quote: string | null;
  body: string;
  tags: string[];
  origin: NoteOrigin;
  reviewed: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type NoteInput = {
  book_id: string;
  body: string;
  printed_page?: number | null;
  quote?: string | null;
  tags?: string[];
  origin?: NoteOrigin;
};

// A superseded state of a note. Append-only: the current state lives in notes,
// and this is what it used to be.
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

// A note with enough of its book to render a citation without a second query.
export interface NoteWithBook extends Note {
  book_title: string;
  book_author: string | null;
}
