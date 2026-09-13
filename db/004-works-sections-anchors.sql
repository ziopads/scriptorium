-- Scriptorium — migration 004: sections, works, citation fields, anchors
--
-- Run against a database carrying migrations 001–003. The same statements are
-- folded into db/schema.sql for a fresh database; the two are kept in step by
-- hand.
--
-- THERE IS A BREAKING WINDOW. This renames books to works and renames the
-- columns pointing at it. Code deployed before the migration will 500 until the
-- matching deploy finishes. Two users, two minutes: run this, then push.
--
-- FOUR CHANGES, ONE FILE, because the reseed needs all of them present at once:
--
--   1. list_sections   the department's ordering, which is structure and not a tag
--   2. works           one table for monographs, essays, and films
--   3. citation fields the superset any style needs, so formatting stays a function
--   4. note_anchors    a note with two anchors is a connection
--
-- Plus dossier_sections, which the three-book pilot needs.

begin;

-- ---------------------------------------------------------------------------
-- 1. Sections
-- ---------------------------------------------------------------------------
-- The reading list is List → lettered Section → items, with a Supplementary
-- group per list. A section is a real object: it has a letter, a title, a
-- position, and it can be EMPTY — dissertation section I, "Textual
-- Interpretation and Narrative Transculturation", has a heading and no items.
-- A section_title column on list_items could not represent that, and the fact
-- that her department carved out a category and left it unfilled is
-- information.
--
-- kind separates official entries from supplementary ones. In the source that
-- distinction is carried by a "Supplementary" heading, not by the numbering:
-- a dozen official entries lost their Word auto-numbering and carry hand-typed
-- numbers instead, and those numbers are stale — the dissertation list is four
-- out of step after deletions. The numbers are deliberately not stored.

alter table exam_lists
  add column if not exists examinable boolean not null default true;

create table if not exists list_sections (
  id      text primary key,            -- 'dissertation-b'
  list_id text not null references exam_lists(id) on delete cascade,
  letter  text,                        -- 'B', null for Supplementary
  title   text not null,
  kind    text not null default 'core',
  sort    int  not null default 0,
  constraint list_sections_kind_ck check (kind in ('core', 'supplementary'))
);

create index if not exists list_sections_list_idx on list_sections (list_id, sort);

-- ---------------------------------------------------------------------------
-- 2. books becomes works
-- ---------------------------------------------------------------------------
-- The table already held things that are not books. The reading list cites
-- essays as items — Freud's "Lo ominoso" inside Obras completas, two Lacan
-- essays in two different volumes, La Chrisx's poem — and the filmography lists
-- films. A separate essays table would mean list_items carrying two nullable
-- foreign keys and every query becoming a union.
--
-- container_id is one level deep by intent: a volume holds essays and that is
-- the end of it. first_page/last_page locate the essay within its container.

alter table books rename to works;

alter table works add column if not exists kind text not null default 'monograph';
alter table works add column if not exists container_id text;
alter table works add column if not exists first_page int;
alter table works add column if not exists last_page  int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'works_container_fk') then
    alter table works add constraint works_container_fk
      foreign key (container_id) references works(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'works_kind_ck') then
    alter table works add constraint works_kind_ck check (kind in (
      'monograph', 'edited_volume', 'essay', 'chapter', 'poem',
      'film', 'dictionary', 'anthology'
    ));
  end if;

  -- A work cannot contain itself.
  if not exists (select 1 from pg_constraint where conname = 'works_not_self_ck') then
    alter table works add constraint works_not_self_ck
      check (container_id is null or container_id <> id);
  end if;
end $$;

create index if not exists works_container_idx on works (container_id);
create index if not exists works_kind_idx on works (kind);

-- ---------------------------------------------------------------------------
-- 3. Citation superset
-- ---------------------------------------------------------------------------
-- Which style the department wants is a formatting decision and can change.
-- What cannot be recovered on the morning of an exam is a field nobody
-- recorded. So the record holds a superset of what Chicago and MLA need, and
-- the formatter is a function over it.
--
-- Films use `author` for the director, with kind = 'film' selecting the
-- formatter that renders it as a direction credit. Twelve rows did not warrant
-- their own column.

alter table works add column if not exists isbn          text;
alter table works add column if not exists volume        text;   -- 'vol. 17', '2 vols.'
alter table works add column if not exists series        text;   -- 'Colección Fundamentos, 58'
alter table works add column if not exists original_year int;    -- 1919 for "Lo ominoso"
alter table works add column if not exists url           text;
alter table works add column if not exists doi           text;
alter table works add column if not exists accessed      date;   -- a web citation needs one

create index if not exists works_isbn_idx on works (isbn);

-- ---------------------------------------------------------------------------
-- list_items follows the rename, and gains its section
-- ---------------------------------------------------------------------------

alter table list_items rename column book_id to work_id;
alter table list_items add column if not exists section_id text
  references list_sections(id) on delete set null;
alter table list_items add column if not exists ordinal int;

create index if not exists list_items_section_idx on list_items (section_id, ordinal);

alter table position_cards rename column book_id to work_id;
alter table chunks        rename column book_id to work_id;

-- ---------------------------------------------------------------------------
-- 4. note_anchors
-- ---------------------------------------------------------------------------
-- A note carried one anchor inside itself. Moving it out costs nothing for the
-- ordinary case and buys the thing she actually wants: a note with two or more
-- anchors IS a connection between passages, with no second concept, no second
-- table, and no reciprocal-link bookkeeping. Tags, search, revisions, export
-- and the unreviewed queue all keep working unchanged.
--
-- Anchors are unordered peers rather than source and target, because that is
-- how the thought works: the theory passage recalled the novel, and from the
-- novel's side the theory is equally the connection. Both records show it.
--
-- KNOWN LIMIT: note_revisions versions the writing, not the anchors. Editing a
-- note's body is recoverable; re-pointing an anchor is not. Versioning pointers
-- as well as prose is more machinery than one reader needs, and the quote text
-- itself — which is what re-locates a note after re-chunking — lives in the
-- revision rows already.

create table if not exists note_anchors (
  note_id      bigint not null references notes(id) on delete cascade,
  ordinal      int    not null default 1,
  work_id      text   not null references works(id) on delete cascade,
  printed_page int,
  quote        text,
  primary key (note_id, ordinal)
);

create index if not exists note_anchors_work_idx on note_anchors (work_id, printed_page);
create index if not exists note_anchors_note_idx on note_anchors (note_id);

-- Move every existing note's anchor across before the columns go.
insert into note_anchors (note_id, ordinal, work_id, printed_page, quote)
select id, 1, book_id, printed_page, quote
from notes
on conflict (note_id, ordinal) do nothing;

alter table notes drop column if exists book_id;
alter table notes drop column if exists printed_page;
alter table notes drop column if exists quote;

-- ---------------------------------------------------------------------------
-- 5. dossier_sections
-- ---------------------------------------------------------------------------
-- Orientation, distinct from the position card. The card is her operative claim
-- — terse, exam-facing, hers. A dossier is what the book is, who wrote it, what
-- is contested about it: longer, mostly drafted by Claude, useful before she has
-- read the book.
--
-- Sections rather than one blob, so she can accept the author paragraph and
-- reject the argument paragraph, and so a new kind needs no migration. sources
-- is what makes a dossier citable rather than merely suggestive. model matters
-- because in eighteen months "which Claude said this" is a real question.

create table if not exists dossier_sections (
  work_id      text not null references works(id) on delete cascade,
  kind         text not null,
  body         text not null,
  sources      text[] not null default '{}',
  origin       text not null default 'assistant',
  reviewed     boolean not null default false,
  model        text,
  generated_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (work_id, kind),
  constraint dossier_origin_ck check (origin in ('human', 'assistant'))
);

create index if not exists dossier_unreviewed_idx
  on dossier_sections (reviewed) where reviewed = false;

-- ---------------------------------------------------------------------------
-- Derived examinability
-- ---------------------------------------------------------------------------
-- Not a column. A work is examinable if it appears on an examinable list, OR if
-- its container does — an essay in the Sanjek volume is examinable because the
-- volume is listed, while Obras completas is not examinable even though the
-- Freud essay inside it is. A stored flag would be a second source of truth and
-- would drift the first time an item moved between lists.
--
-- One level of containment, matching works.container_id. Deliberately not
-- recursive: a cycle nobody notices is worse than a limit everyone knows.

create or replace view examinable_works as
select w.id, w.title, w.container_id
from works w
where exists (
        select 1 from list_items li
        join exam_lists el on el.id = li.list_id
        where li.work_id = w.id and el.examinable
      )
   or exists (
        select 1 from list_items li
        join exam_lists el on el.id = li.list_id
        where li.work_id = w.container_id and el.examinable
      );

commit;
