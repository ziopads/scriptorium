-- Scriptorium — migration 017: why a file's pagination was accepted
--
-- Run against a database carrying 001–016. Additive: one column, and a
-- backfill of the works already accepted under 016.
--
-- WHY
--
--   016 recorded that someone accepted a file whose numbering offsets.py
--   could not settle. It did not record why, and two different decisions were
--   being written into one column:
--
--     Keetley, Folk Gothic       a page was read in the PDF, the offset set
--                                to -6 by hand, and the file accepted. The
--                                printed numbers are the edition's; what
--                                nobody checked is whether the offset holds
--                                through the whole book.
--
--     Campobello, Cartucho       a calibre conversion that prints no page
--                                numbers anywhere. No offset would make its
--                                pages the edition's. The page shown is the
--                                file's own.
--
--   Marking both the same way makes the warning wrong in one direction or the
--   other: it overstates Keetley, where a page cited from the checked part is
--   right, and it would understate Cartucho if softened. An asterisk that
--   means two things is an asterisk she learns to skip.
--
-- WHAT EACH VALUE DOES
--
--   hand_set       no marker on each page number. The work page says once
--                  that the offset was set by hand from a single page and not
--                  verified through the book.
--
--   none_printed   the marker stays on every page number the app derives for
--                  the work, because the number is the file's and not the
--                  edition's.
--
--   null           not accepted, or accepted before this column existed and
--                  not yet classified. Treated as none_printed, the more
--                  cautious of the two.
--
-- THE BACKFILL
--
--   The eleven works accepted under 016 are split by their stored offset: a
--   non-zero offset is one somebody typed, which is hand_set; zero is the
--   default nobody changed, which is none_printed. That is an inference about
--   intent, not a record of it, so the Gaps page shows the basis on every
--   accepted row and switching one is a click.

begin;

alter table works
  add column if not exists pagination_basis text;

alter table works
  drop constraint if exists works_pagination_basis_ck;

alter table works
  add constraint works_pagination_basis_ck
  check (pagination_basis is null or pagination_basis in ('hand_set', 'none_printed'));

comment on column works.pagination_basis is
  'Why works.pagination_accepted_at was set. hand_set: an offset read from the '
  'PDF and typed in, so page numbers are shown unmarked. none_printed: the file '
  'prints no page numbers, so every page shown for the work is marked. Null '
  'where the work is not accepted.';

update works
set pagination_basis = case when page_offset <> 0 then 'hand_set' else 'none_printed' end
where pagination_accepted_at is not null
  and pagination_basis is null;

commit;

-- After running:
--
--   select id, page_offset, pagination_basis, pagination_accepted_at
--   from works where pagination_accepted_at is not null order by id;
