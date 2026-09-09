-- Scriptorium — migration 003: how a book got here, and what it is for
--
-- Run before deploying the code that reads these columns.
--
-- TWO FACTS, NOT ONE
--
--   purpose  — what the book is for: comps, both, the dissertation, or nothing
--              yet decided.
--   standing — how it got onto the list: assigned by her advisors, added by
--              her, or excluded by them as non-canonical.
--
-- Collapsing these into a single field would make a book unable to say the one
-- thing that matters most about some of them: that it was excluded by an
-- advisor AND is central to the dissertation anyway. The difference between the
-- assigned list and hers is an argument about canon formation, and it is only
-- available as a query if both facts are recorded separately.
--
-- exam_lists and list_items are left alone on purpose. They are the record of
-- the document her advisors approved. This characterization sits beside that
-- record rather than overwriting it.

alter table books add column if not exists purpose       text;
alter table books add column if not exists standing      text;
alter table books add column if not exists standing_note text;

-- Everything seeded from the reading list so far is on the assigned list and
-- serves both purposes. Books added later from the PDF folder will arrive with
-- purpose 'dissertation' and standing 'added' or 'excluded'.
update books set purpose  = 'both'     where purpose  is null;
update books set standing = 'assigned' where standing is null;

alter table books alter column purpose  set default 'unassigned';
alter table books alter column standing set default 'assigned';
alter table books alter column purpose  set not null;
alter table books alter column standing set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'books_purpose_ck'
  ) then
    alter table books add constraint books_purpose_ck
      check (purpose in ('comps', 'both', 'dissertation', 'unassigned'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'books_standing_ck'
  ) then
    alter table books add constraint books_standing_ck
      check (standing in ('assigned', 'added', 'excluded'));
  end if;
end $$;

create index if not exists books_purpose_idx  on books (purpose);
create index if not exists books_standing_idx on books (standing);
