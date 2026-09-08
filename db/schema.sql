-- Scriptorium — schema
--
-- Authoritative. docs/ARCHITECTURE.md explains the departures from the original
-- handoff design; this file is what actually runs.
--
-- Target: Neon serverless Postgres. Run once per database, in the Neon SQL
-- editor or over psql. Idempotent enough to re-run during development.
--
-- Version 1  ·  2026-09-08

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- vector   : embedding storage and nearest-neighbour indexes.
-- pg_trgm  : trigram similarity, the fallback for a quotation typed slightly
--            wrong (requirement S-1).
--
-- Accent folding is NOT done here. The loader writes a folded copy of each
-- chunk into text_search, so no unaccent extension and no immutable-wrapper
-- workaround is needed. See the note above chunks.text_search.

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- books
-- ---------------------------------------------------------------------------
-- One row per book. Entered once, cited hundreds of times.
--
-- Every bibliographic field is nullable on purpose: blank beats a guess, and a
-- record with an unknown publisher must be storable as unknown rather than
-- filled with something plausible (C-2).

create table if not exists books (
  id            text primary key,          -- stable slug, e.g. 'anzaldua-borderlands-1987'
  title         text not null,
  subtitle      text,
  author        text,
  translator    text,
  editor        text,
  publisher     text,
  place         text,
  year          int,
  edition       text,
  language      text,                      -- 'es' | 'en' | 'es,en' for facing-page volumes

  status        text default 'unread',     -- unread | reading | read
  source_format text default 'none',       -- pdf_text | pdf_ocr | epub | none
  source_path   text,                      -- where the file lives on the ingest machine
  r2_pages_key  text,                      -- object holding this book's page text

  -- printed page = file page + page_offset. Established once, at ingest, by
  -- checking one printed folio against its file page (C-3). Getting this wrong
  -- produces citations that are wrong in a way that surfaces during a defence.
  page_offset   int not null default 0,

  vivarium_item_id int,                    -- optional link to the Vivarium catalogue

  notes_internal text,                     -- ingest notes: bad scan, missing pages, etc.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint books_status_ck
    check (status in ('unread', 'reading', 'read')),
  constraint books_source_format_ck
    check (source_format in ('pdf_text', 'pdf_ocr', 'epub', 'none'))
);

create index if not exists books_author_idx on books (author);
create index if not exists books_status_idx on books (status);

-- ---------------------------------------------------------------------------
-- exam_lists, list_items
-- ---------------------------------------------------------------------------
-- The reading list is three lists plus a filmography, and a book can sit on
-- more than one.

create table if not exists exam_lists (
  id          text primary key,
  name        text not null,
  description text,
  sort        int not null default 0
);

create table if not exists list_items (
  list_id   text not null references exam_lists(id) on delete cascade,
  book_id   text not null references books(id) on delete cascade,
  rationale text,                          -- why this book is on this list (C-5)
  sort      int,
  primary key (list_id, book_id)
);

create index if not exists list_items_book_idx on list_items (book_id);

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
-- Anchored to (book_id, printed_page, quote) and never to a chunk id. Chunks
-- are a derived cache that gets rebuilt; a chunk-anchored note is orphaned by
-- the first re-chunk. A quotation re-locates itself by searching for its own
-- text, which is also what lets a note be written against a book that has not
-- been extracted yet (N-8, N-9).
--
-- origin and reviewed carry provenance. A note written by the draft_note tool
-- is 'assistant' and unreviewed; editing it in the application sets reviewed
-- and leaves origin alone, so the record of where a sentence came from survives
-- the edit (N-6). Human notes default to reviewed, because writing one is
-- reviewing it.

create table if not exists notes (
  id           bigserial primary key,
  book_id      text not null references books(id) on delete cascade,

  printed_page int,                        -- the printed folio, never the file page
  quote        text,                       -- verbatim, as the anchor
  body         text not null,
  tags         text[] not null default '{}',

  origin       text not null default 'human',
  reviewed     boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint notes_origin_ck check (origin in ('human', 'assistant'))
);

create index if not exists notes_book_page_idx on notes (book_id, printed_page);
create index if not exists notes_tags_idx      on notes using gin (tags);
create index if not exists notes_unreviewed_idx on notes (reviewed) where reviewed = false;

-- ---------------------------------------------------------------------------
-- note_revisions
-- ---------------------------------------------------------------------------
-- Added in migration 002. A book record is bibliographic fact with one editor,
-- and deliberately has no revision history. A note is her writing, edited by
-- two parties — her, and the draft_note tool — with sentences from it ending up
-- in a dissertation. At that point "did I write this, or did I edit something
-- the assistant wrote" has a real answer, and origin/reviewed answers it only
-- coarsely.
--
-- Each row is the state of the note BEFORE an edit. Append-only; the current
-- state always lives in notes.

create table if not exists note_revisions (
  id            bigserial primary key,
  note_id       bigint not null references notes(id) on delete cascade,

  body          text not null,
  quote         text,
  printed_page  int,
  tags          text[] not null default '{}',
  origin        text not null,
  reviewed      boolean not null,

  -- Carried over from notes.updated_at, so a revision list reads as a timeline
  -- rather than as a list of when things were overwritten.
  written_at    timestamptz not null,
  superseded_at timestamptz not null default now()
);

create index if not exists note_revisions_note_idx
  on note_revisions (note_id, superseded_at desc);

-- ---------------------------------------------------------------------------
-- position_cards
-- ---------------------------------------------------------------------------
-- One per book. Generated by hand through her own Claude subscription and
-- entered here, so generated_at records when the card was made rather than an
-- API call. reviewed is the field that matters: an unreviewed card is not exam
-- preparation (F-2).
--
-- The field list is provisional. It is settled with her before any card is
-- written (REQUIREMENTS.md §8.4).

create table if not exists position_cards (
  book_id        text primary key references books(id) on delete cascade,
  claim          text,                     -- central argument, two sentences
  method         text,
  key_terms      text[] not null default '{}',
  argues_against text[] not null default '{}',
  chapter_link   text,                     -- which dissertation chapter it feeds
  generated_at   timestamptz,
  reviewed       boolean not null default false,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- chunks
-- ---------------------------------------------------------------------------
-- Derived from the page JSON on disk, rebuilt per book in a transaction
-- whenever the boundary rules change (O-2). There is deliberately no pages
-- table: page text lives in Cloudflare R2 under books.r2_pages_key, which keeps
-- roughly 70 MB out of the free-tier storage cap and follows the existing rule
-- that pages are the durable artifact and the database is derived.
--
-- text          verbatim, for display and citation.
-- text_search   the same text lowercased with accents folded, written by the
--               loader in Python. Search is done against this on both sides, so
--               an unaccented query matches accented text (S-3). The cost is
--               that papa and papá collide; that is accepted, because optical
--               character recognition on Spanish scans mangles accents anyway
--               and trigram similarity backs up the near-miss case.
--
-- chunker_version, embedding_model, embedding_dim are stamps. Six weeks in,
-- some books will have been rebuilt and others not, and without them there is
-- no way to tell which rows came from which rules (O-3).
--
-- The embedding column's dimension is fixed by REQUIREMENTS.md §8.5, which is
-- not yet settled. 512 is provisional. Nothing in the September work touches
-- this table.

create table if not exists chunks (
  id              bigserial primary key,
  book_id         text not null references books(id) on delete cascade,

  start_page      int,                     -- printed pages, offset already applied
  end_page        int,
  chapter         text,
  section_type    text,                    -- front | body | notes | bibliography | index
  lang            text not null default 'spanish',

  text            text not null,
  text_search     text not null,

  chunker_version int  not null default 1,
  embedding_model text,
  embedding_dim   int,

  tsv tsvector generated always as (
    case
      when lang = 'english' then to_tsvector('english', text_search)
      else to_tsvector('spanish', text_search)
    end
  ) stored,

  embedding       vector(512),

  constraint chunks_lang_ck
    check (lang in ('spanish', 'english')),
  constraint chunks_section_ck
    check (section_type is null or section_type in
      ('front', 'body', 'notes', 'bibliography', 'index'))
);

-- If the generated tsv column is rejected, drop it and have the loader write a
-- plain tsvector column instead. The index behaves identically; the generated
-- form is preferred only because it cannot drift from the text.

create index if not exists chunks_tsv_idx       on chunks using gin (tsv);
create index if not exists chunks_trgm_idx      on chunks using gin (text_search gin_trgm_ops);
create index if not exists chunks_book_page_idx on chunks (book_id, start_page);
create index if not exists chunks_section_idx   on chunks (section_type);

-- The vector index is created after the first load, not here. Building HNSW on
-- an empty table is pointless, and at ~27,000 rows a sequential scan is fast
-- enough that this can wait until the dimension is settled:
--
--   create index chunks_embedding_idx
--     on chunks using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Seed: the four lists from the source reading list
-- ---------------------------------------------------------------------------

insert into exam_lists (id, name, description, sort) values
  ('theory',       'Theory',                'Lista I — teoría',            1),
  ('dissertation', 'Dissertation',          'Lista II — tesis',            2),
  ('teaching',     'Teaching, Siglo XX',    'Lista III — docencia',        3),
  ('filmografia',  'Filmografía',           'Lista IV — filmografía',      4)
on conflict (id) do nothing;
