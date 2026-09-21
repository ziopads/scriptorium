-- Scriptorium — migration 012: what is known about a work's PDF
--
-- Run against a database carrying 001–011. Additive: two nullable columns.
--
-- WHY
--
--   Whether a work has a usable PDF was knowable only from books.csv and a
--   terminal. She needs to see it in the application: which books she can read
--   now, which are waiting on OCR, and which nobody has found a copy of — the
--   last being a list she is the only person who can act on.
--
--   works.source_path has existed since the first schema and nothing filled it
--   until 17 Sept. These two columns sit beside it and carry the rest of what
--   books.csv knows.
--
--   pdf_state    none · queued · ready · loaded
--                What a person concluded, not what a scorer guessed. 'queued'
--                means a file exists and is waiting for OCR; 'none' means no
--                copy has been found, which is the shopping list.
--
--   pdf_verdict  check_pdf.py's reading of the file: citable, re-OCR,
--                needs OCR, check by hand. Evidence, not a ruling.
--
--   Both are written by pipeline/sync_books.py from books.csv, which is the
--   register a person edits. Nothing in the application writes them, and
--   nothing depends on them being correct: they describe the corpus, not the
--   catalogue.

begin;

alter table works add column if not exists pdf_state text;
alter table works add column if not exists pdf_verdict text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'works_pdf_state_ck') then
    alter table works add constraint works_pdf_state_ck
      check (pdf_state is null or pdf_state in ('none', 'queued', 'ready', 'loaded'));
  end if;
end $$;

create index if not exists works_pdf_state_idx on works (pdf_state);

comment on column works.pdf_state is
  'What is known about this work''s PDF: none, queued (awaiting OCR), ready, '
  'or loaded. Written by pipeline/sync_books.py from books.csv.';

commit;

-- After running, pipeline/sync_books.py fills it, and the catalogue gains a
-- filter for works with no copy.
