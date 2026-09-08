-- Scriptorium — migration 002: note revisions
--
-- Run against a database already carrying schema.sql. The same statements are
-- folded into db/schema.sql so a fresh database gets them too; the two must be
-- kept in step by hand.
--
-- WHY THIS EXISTS, WHEN book_revisions DELIBERATELY DOES NOT
--
--   A book record is bibliographic fact with one editor. If a publisher is
--   corrected, the previous wrong value is of no interest.
--
--   A note is her writing. It will be edited by two parties — her, and the
--   draft_note tool — and sentences from it will end up in a dissertation. At
--   that point "did I write this, or did I edit something the assistant wrote"
--   is a question with a real answer, and origin/reviewed only answers it
--   coarsely. This table answers it exactly.
--
-- Append-only. Nothing updates or deletes a revision except the cascade when
-- its note is deleted.

create table if not exists note_revisions (
  id           bigserial primary key,
  note_id      bigint not null references notes(id) on delete cascade,

  -- The state of the note BEFORE the edit that created this row. The current
  -- state always lives in notes; this table is what it used to be.
  body         text not null,
  quote        text,
  printed_page int,
  tags         text[] not null default '{}',
  origin       text not null,
  reviewed     boolean not null,

  -- When the superseded state was last written, carried over from
  -- notes.updated_at, so a revision list reads as a timeline rather than as a
  -- list of when things were overwritten.
  written_at   timestamptz not null,
  superseded_at timestamptz not null default now()
);

create index if not exists note_revisions_note_idx
  on note_revisions (note_id, superseded_at desc);
