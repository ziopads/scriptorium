-- Scriptorium — migration 016: accepted pagination
--
-- Run against a database carrying 001–015. Additive: one column. No existing
-- row changes.
--
-- WHY
--
--   offsets.py flags a work whose printed page numbers it cannot settle, and
--   load_sections, load_chunks and embed skip anything flagged. That is right
--   for a book whose numbering breaks partway (migration 008) and wrong for a
--   book that has no printed page numbers at all.
--
--   Cartucho and Postcolonial Love Poem are calibre conversions of ebooks.
--   There is no printed edition's pagination in the file to recover, so the
--   flag can never clear: judge() in offsets.py returns a problem whenever it
--   finds fewer than eight consistent folios, before it considers any offset.
--   Left as they are, those books stay out of search and out of every study
--   aid for good.
--
--   This column is the decision that they are usable as they stand. The
--   numbering is still unsettled and still reported; what changes is that the
--   pipeline stops treating it as a reason to hold the text back, and every
--   surface that shows a page number says the number is unverified.
--
-- WHAT IT DOES NOT DO
--
--   It does not clear offset_problem. The flag is the evidence, and a later
--   run of offsets.py rewrites it from the file as before. Acceptance is a
--   person's judgement recorded beside it, not a correction of it.
--
--   New pages clear it: load_pages.py sets it back to null when it replaces a
--   work's rows, because a new extraction is new evidence and the decision was
--   made about the old one.

begin;

alter table works
  add column if not exists pagination_accepted_at timestamptz;

comment on column works.pagination_accepted_at is
  'When a person accepted this file''s pagination despite an unsettled '
  'offset_problem. The pipeline stops holding the work back; every citation '
  'and quotation surface marks its page numbers unverified. Cleared by '
  'load_pages.py when the pages are replaced.';

commit;

-- After running, the works this applies to are found with:
--
--   select id, page_offset, pagination_accepted_at, offset_problem
--   from works where offset_problem is not null order by id;
