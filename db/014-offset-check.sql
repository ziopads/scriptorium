-- Scriptorium — migration 014: whether a work's page numbering has been checked
--
-- Run against a database carrying 001–013. Additive: two nullable columns.
--
-- WHY
--
--   works.page_offset decides every printed page a citation carries, and until
--   21 Sept nothing set it from the book. Of six works loaded that day, two
--   held 0 where their folios said -1 and -3. pipeline/offsets.py now reads the
--   folios after load_pages, writes the offset when one numbering runs through
--   the book, and records a problem when it cannot.
--
--   offset_checked_at   when offsets.py last judged this work. Null means never
--                       checked, which is every work loaded before 21 Sept.
--
--   offset_problem      what offsets.py could not settle, in words: too few
--                       folios, more than one numbering sequence, or ranges in
--                       page_offsets that disagree with the folios. Null means
--                       none. A work with a problem gets no sections, chunks
--                       or embeddings from a --pending run until it is fixed
--                       and offsets.py is run on it again, which clears it.
--
--   The Gaps page lists every work with a problem, so they can be settled
--   together after the rest of the corpus is loaded.
--
--   Written only by pipeline/offsets.py, and reset by load_pages.py when new
--   pages replace old ones. The application reads them and never writes them.

begin;

alter table works add column if not exists offset_checked_at timestamptz;
alter table works add column if not exists offset_problem text;

create index if not exists works_offset_problem_idx
  on works (id) where offset_problem is not null;

comment on column works.offset_checked_at is
  'When pipeline/offsets.py last compared this work''s printed folios with its '
  'page offset. Null: never checked.';
comment on column works.offset_problem is
  'What pipeline/offsets.py could not settle about the page numbering. Null: '
  'none. Blocks sections, chunks and embeddings from a --pending run.';

commit;
