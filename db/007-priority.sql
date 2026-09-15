-- Scriptorium — migration 007: priority
--
-- Run against a database carrying migrations 001–006. Additive: one nullable
-- column and an index. Nothing reads it until the code that does is deployed.
--
-- WHY A THIRD COLUMN AND NOT A REUSE OF THE OTHER TWO
--
--   works.purpose says what a work is for — comps, dissertation, both.
--   works.standing says how it got onto the list — assigned, added, excluded.
--
--   Neither says how much it matters. Zazil expects to lean hard on about a
--   dozen of the 125 examinable works and to know the rest at a distance, and
--   that is a fact about her preparation rather than about the work's role.
--   Folding it into purpose would make 'comps' mean two things at once.
--
-- WHY NULLABLE AND NOT DEFAULTED TO ZERO
--
--   Not yet rated and rated low are different states, and the difference is
--   the whole use of the column: the list she works down is the unrated one.
--   A default would empty that list on the day the migration ran.
--
--   Same reasoning as notes.attribution in 005. A defaulted value is a guess,
--   and the wrong guess is the thing the column exists to prevent.

begin;

alter table works add column if not exists priority smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'works_priority_ck') then
    alter table works add constraint works_priority_ck
      check (priority is null or priority between 1 and 5);
  end if;
end $$;

-- Highest first, unrated last: the order the catalogue offers in September.
create index if not exists works_priority_idx on works (priority desc nulls last);

commit;
