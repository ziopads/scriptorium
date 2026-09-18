-- Scriptorium — migration 009: sections
--
-- Run against a database carrying 001–008. Additive.
--
-- WHAT A SECTION IS, AND WHAT IT IS NOT
--
--   A chapter, part or story: an internal division of one work, with a page
--   range. Navigation and search scope, nothing more.
--
--   It is NOT a catalogue entry. The test is whether the unit gets its own line
--   in a bibliography. An essay in an edited volume does, and a tale in Rael
--   does — she would cite "Doña Sebastiana," in Cuentos españoles — so those are
--   child works, with container_id and their own bibliographic identity. Nobody
--   cites Adorno chapter 7 as a work, so that is a section. One rule, and it
--   keeps four hundred chapter rows out of a 160-work catalogue while letting
--   the tales in.
--
-- WHERE THE ROWS COME FROM
--
--   extract.py produces a chapters array per book from, in order of trust:
--   the PDF's own bookmarks (doc.get_toc), which for Adorno is the publisher's
--   contents with exact pages; or runs of chapter running heads, a head sitting
--   on its chapter's pages and nowhere else. A third source was tried and
--   withdrawn for being wrong on five books of five.
--
--   load_sections.py loads them, resolving file pages to printed pages through
--   printed_pages so a section's first_page is the number on the page — which
--   is what the Preview tab navigates by and what a citation would print.
--
--   source records which of the two found it, because trusting an outline and
--   trusting a heuristic are different things and the interface should be able
--   to say which it is showing.
--
-- WHY NOT ON works
--
--   A work has many sections and they are ordered. Nothing here is citable on
--   its own, so no foreign key anywhere points at a section; it can be dropped
--   and rebuilt from the extract at any time, like pages and chunks.

begin;

create table if not exists sections (
  work_id    text not null references works(id) on delete cascade,
  ordinal    int  not null,            -- position in the book, from 1
  level      int  not null default 1,  -- 1 part or chapter, 2 subsection
  title      text not null,
  first_page int  not null,            -- PRINTED, resolved at load time
  last_page  int,                      -- null for the last one
  source     text not null,            -- 'outline' | 'running heads' | 'manual'
  primary key (work_id, ordinal),
  constraint sections_level_ck  check (level between 1 and 4),
  constraint sections_source_ck check (source in ('outline', 'running heads', 'manual')),
  constraint sections_range_ck  check (last_page is null or last_page >= first_page)
);

create index if not exists sections_page_idx on sections (work_id, first_page);

comment on table sections is
  'Chapters and parts of a work, for navigation and search scope. Derived from '
  'the extract; rebuildable. Not citable — a separately citable unit is a child '
  'work with container_id.';

commit;

-- After running:
--   pipeline/load_sections.py fills it from pipeline/pages/*.json.
--   The workbench centre pane shows a Contents tab between Meta and Preview.
