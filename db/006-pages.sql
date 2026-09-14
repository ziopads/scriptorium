-- Scriptorium — migration 006: pages
--
-- Run against a database carrying 001–005. Additive; nothing existing changes.
--
-- WHY A PAGES TABLE, AGAINST THE 2026-09-08 DECISION
--
--   schema.sql kept page text out of Postgres, in R2 under works.r2_pages_key,
--   to stay under a 70 MB estimate against the free-tier cap. Two things
--   changed. The preview pane and verify_quotation both need a page by folio,
--   and a signed object fetch per page turn is the wrong shape for either. And
--   the cap is 0.5 GB with text compressed in storage, so the whole corpus fits
--   several times over. The rule the decision protected still holds: the page
--   JSON on disk (pipeline/pages/) is the durable artifact, and this table is a
--   derived copy that pipeline/load_pages.py can rebuild per work.
--
-- WHAT IS STORED
--
--   page_index   1-based position in the file, as extracted
--   folio        the printed number read off the page before running heads
--                were stripped; null where none was found
--   text         cleaned page text, verbatim otherwise
--
--   The printed page is NOT stored. It is page_index + works.page_offset, in
--   the printed_pages view, so a corrected offset (Gonzales is one of the
--   uncertain ten) fixes every page and every anchor at once. A stored copy
--   would be wrong from the moment the offset moved.
--
--   page_loads records, per work, which extractor run the rows came from.
--   Six weeks in, some works will have been re-extracted and others not, and
--   without the stamp there is no way to tell.

begin;

create table if not exists pages (
  work_id    text not null references works(id) on delete cascade,
  page_index int  not null,
  folio      int,
  text       text not null,
  chars      int  generated always as (length(text)) stored,
  primary key (work_id, page_index),
  constraint pages_index_ck check (page_index >= 1)
);

create table if not exists page_loads (
  work_id              text primary key references works(id) on delete cascade,
  source_book_id       text,            -- the pipeline's id for the page file
  extracted_at         timestamptz,
  extractor            text,
  page_count           int  not null,
  running_heads_removed text[] not null default '{}',
  loaded_at            timestamptz not null default now()
);

create or replace view printed_pages as
select p.work_id, p.page_index, p.folio, p.text, p.chars,
       p.page_index + w.page_offset as printed_page
from pages p
join works w on w.id = p.work_id;

-- A quotation checked against the page it claims. Trigram similarity is the
-- fallback for a quote typed slightly wrong; the exact form is a plain
-- position() on the page.
create index if not exists pages_text_trgm_idx on pages using gin (text gin_trgm_ops);

commit;

-- After running:
--   pipeline/load_pages.py fills it from pipeline/pages/*.json.
--   The workbench Preview tab reads printed_pages.
