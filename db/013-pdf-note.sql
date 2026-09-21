-- Scriptorium — migration 013: a note about the PDF, as distinct from the book
--
-- Run against a database carrying 001–012. Additive: one nullable column.
--
-- WHY
--
--   A copy of a book has properties the book does not: a scan that stops at
--   chapter four, plates out of order, an edition whose pagination differs
--   from the one on the list, marginalia from a previous reader. Zazil is the
--   person who discovers these, while reading, and she needs somewhere to say
--   so that is about the file and not about the work.
--
--   The note column in books.csv held text of this kind, but it was written by
--   a session whose other output could not be trusted, and none of it is
--   carried over. This column starts empty everywhere.
--
--   Written in the application. Nothing in the pipeline reads or writes it.

begin;

alter table works add column if not exists pdf_note text;

comment on column works.pdf_note is
  'A note about this work''s PDF — the copy, not the book: gaps, scan quality, '
  'edition differences. Written in the application; starts empty.';

commit;
