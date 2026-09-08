// Row shapes, matching db/schema.sql column-for-column.
//
// These are the database's names, not prettier ones. A camelCase layer here
// would mean every query result needs mapping and every mismatch is a silent
// undefined, which is a poor trade for one reader's application.

export type BookStatus = 'unread' | 'reading' | 'read';
export type SourceFormat = 'pdf_text' | 'pdf_ocr' | 'epub' | 'none';
export type NoteOrigin = 'human' | 'assistant';

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
  source_format: SourceFormat;
  source_path: string | null;
  r2_pages_key: string | null;
  page_offset: number;

  vivarium_item_id: number | null;
  notes_internal: string | null;

  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
}

export type NoteInput = {
  book_id: string;
  body: string;
  printed_page?: number | null;
  quote?: string | null;
  tags?: string[];
  origin?: NoteOrigin;
};

// A note with enough of its book to render a citation without a second query.
export interface NoteWithBook extends Note {
  book_title: string;
  book_author: string | null;
}
