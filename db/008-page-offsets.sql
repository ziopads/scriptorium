-- Scriptorium — migration 008: per-range page offsets
--
-- Run against a database carrying 001–007. Additive: one table and a replaced
-- view. No existing row changes and nothing needs reloading, because the
-- printed page has never been stored (006).
--
-- WHY ONE OFFSET PER WORK WAS NOT ENOUGH
--
--   Gonzales, Red Medicine, 14 September. The folios read off the pages imply
--   two different offsets, each over a long contiguous run:
--
--     file pages  30–97    imply -29   (printed 1–68)
--     file pages 110–314   imply -41   (printed 69–273)
--
--   Twelve file pages sit between them carrying no folio: an unnumbered plate
--   section. The printed numbering runs straight through it; the file's does
--   not. One offset cannot describe the book, and whichever value were stored,
--   a third of it would cite pages that are off by twelve.
--
--   That is the failure this apparatus exists to prevent. A quotation citing
--   page 45 for a passage printed on page 33 is worse than no citation: it
--   survives review, it reads as precise, and it is wrong.
--
--   The causes are ordinary — plates, inserted maps, a second volume bound in,
--   roman front matter running into arabic — so this will recur. One book in
--   the first five had it.
--
-- HOW IT WORKS
--
--   A work with no rows here behaves exactly as before: works.page_offset
--   applies to every page. A work with rows uses the row whose range contains
--   the page, and falls back to works.page_offset outside every range.
--
--   Ranges are filled from evidence, not guessed. The query that finds them:
--
--     select folio - page_index as implied,
--            min(page_index) as from_page, max(page_index) as to_page, count(*)
--     from pages
--     where work_id = '…' and folio is not null
--     group by implied having count(*) > 5 order by from_page;
--
--   Each row with a substantial count is a range. Gaps between them are
--   unnumbered leaves; extend the preceding range through them so the spans
--   tile, which is what the seed below does for Gonzales.
--
--   Overlaps are refused. Two ranges claiming one page would make printed_page
--   non-deterministic, and a view that returns a different citation depending
--   on the plan is not something to debug in October.

begin;

-- The exclusion constraint below compares work_id with = inside a gist index,
-- which needs btree operator classes in gist.
create extension if not exists btree_gist;

create table if not exists page_offsets (
  work_id     text not null references works(id) on delete cascade,
  from_page   int  not null,   -- page_index, inclusive
  to_page     int  not null,   -- page_index, inclusive
  page_offset int  not null,
  note        text,            -- why the offset changes here
  primary key (work_id, from_page),
  constraint page_offsets_range_ck check (to_page >= from_page),
  constraint page_offsets_from_ck  check (from_page >= 1),
  -- No two ranges of one work may claim the same page.
  constraint page_offsets_no_overlap
    exclude using gist (
      work_id with =,
      int4range(from_page, to_page, '[]') with &&
    )
);

comment on table page_offsets is
  'Page ranges whose printed numbering differs from works.page_offset. Empty '
  'for most works. Filled from pages.folio, never guessed.';

-- The range wins where one contains the page; works.page_offset covers the
-- rest, so every work without rows here is unaffected.
create or replace view printed_pages as
select p.work_id, p.page_index, p.folio, p.text, p.chars,
       p.page_index + coalesce(o.page_offset, w.page_offset) as printed_page
from pages p
join works w on w.id = p.work_id
left join page_offsets o
  on o.work_id = p.work_id
 and p.page_index between o.from_page and o.to_page;

-- Gonzales, from the query above. The first range is extended through the
-- twelve unnumbered plates (98–109) so the spans tile: those pages belong with
-- what precedes them, and a plate carries no folio to contradict it.
insert into page_offsets (work_id, from_page, to_page, page_offset, note)
values
  ('gonzales-red-medicine-traditional-indigenous-rite-2012',   1, 109, -29,
   'printed 1-68; file pages 98-109 are unnumbered plates, carried with this range'),
  ('gonzales-red-medicine-traditional-indigenous-rite-2012', 110, 999, -41,
   'printed 69-273, after the plate section')
on conflict (work_id, from_page) do nothing;

commit;

-- After running, confirm every page resolves to a sane printed number:
--
--   select work_id, min(printed_page), max(printed_page), count(*)
--   from printed_pages group by work_id order by work_id;
--
-- And that the folios now agree with the computed page everywhere they exist:
--
--   select work_id, count(*) as disagreeing
--   from printed_pages
--   where folio is not null and folio <> printed_page
--   group by work_id order by disagreeing desc;
