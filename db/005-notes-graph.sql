-- Scriptorium — migration 005: the notes graph
--
-- Run against a database carrying migrations 001–004. Additive except for two
-- columns dropped from note_revisions that 004 had already orphaned. Every new
-- column is nullable or defaulted, so code deployed before this migration
-- keeps working; code that reads the new columns waits for it. No breaking
-- window.
--
-- Decided 13 Sept 2026 against her two working documents (the mapa de cruces
-- and the notas de preparación). docs/ERD.md draws the result;
-- docs/COMO-TOMAR-NOTAS.md is what she is told. The reasoning that is not in
-- those two files is here.
--
-- THE SHAPE
--
--   Two node tables, works and notes. Three edge tables:
--
--     note_works    argument-level: this note is about this whole work
--     note_anchors  passage-level: this note quotes this page of this work
--     note_links    note to note: bridge, contrast, answers
--
--   The fichas in the mapa cite no pages at all. They are relations to whole
--   works, which is a different edge from a quotation with a folio, so they
--   get their own table rather than degenerate anchor rows with null page and
--   null quote.
--
-- AN AXIS IS A NOTE WHOSE PARTS ARE NOTES
--
--   An eje has a thesis, per-work fichas, a synthesis, and an exam move. Each
--   part is revised, searched, tagged, and attributed separately, and some
--   fichas were drafted by an assistant, so each part needs origin and
--   reviewed of its own. A single row cannot carry that; a separate axes table
--   would duplicate revisions, provenance, tags, search, and export. So the
--   axis is a notes row of kind 'axis' whose body is the thesis, and its parts
--   are child rows with parent_id pointing at it. One level deep by rule,
--   matching works.container_id.
--
-- ATTRIBUTION IS NOT ORIGIN
--
--   origin says who typed the words (her, or the draft_note tool).
--   attribution says whose claim the note asserts: the author of the anchored
--   work, herself, or a third party. "El puente hauntológico con Derrida lo
--   construyes tú; no se lo atribuyas a Adorno" is attribution = 'own' on a
--   note that may have origin = 'assistant'. In an oral exam the second column
--   is the one that matters. It is nullable and never defaulted, because a
--   defaulted value is a guess and the wrong guess is the failure the column
--   exists to prevent.

begin;

-- ---------------------------------------------------------------------------
-- 1. notes: kind, tree, title, attribution
-- ---------------------------------------------------------------------------

alter table notes add column if not exists kind          text not null default 'note';
alter table notes add column if not exists parent_id     bigint;
alter table notes add column if not exists ordinal       int;
alter table notes add column if not exists title         text;
alter table notes add column if not exists attribution   text;
alter table notes add column if not exists attributed_to text;

-- A rejected proposal is hidden, not deleted, so she can reconsider it. Only
-- assistant notes are ever rejected; her own writing is deleted outright, in
-- the application, as before. Every view and list excludes rejected rows;
-- one filter shows them.
alter table notes add column if not exists rejected_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_kind_ck') then
    alter table notes add constraint notes_kind_ck check (kind in (
      'note', 'question', 'ficha', 'axis', 'synthesis', 'exam_move'
    ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'notes_attribution_ck') then
    alter table notes add constraint notes_attribution_ck
      check (attribution is null or attribution in ('author', 'own', 'other'));
  end if;

  -- attributed_to only means something for 'other'.
  if not exists (select 1 from pg_constraint where conname = 'notes_attributed_to_ck') then
    alter table notes add constraint notes_attributed_to_ck
      check (attributed_to is null or attribution = 'other');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'notes_parent_fk') then
    alter table notes add constraint notes_parent_fk
      foreign key (parent_id) references notes(id) on delete cascade;
  end if;

  -- Parts have a parent; everything else does not. The kind decides.
  if not exists (select 1 from pg_constraint where conname = 'notes_parent_by_kind_ck') then
    alter table notes add constraint notes_parent_by_kind_ck check (
      (kind in ('ficha', 'synthesis', 'exam_move') and parent_id is not null)
      or
      (kind in ('note', 'question', 'axis') and parent_id is null)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'notes_not_self_ck') then
    alter table notes add constraint notes_not_self_ck
      check (parent_id is null or parent_id <> id);
  end if;
end $$;

-- A parent must be an axis. A check constraint cannot look at another row, so
-- this is a trigger; it fires on insert and on any change to parent_id.
create or replace function notes_parent_must_be_axis() returns trigger
language plpgsql as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from notes where id = new.parent_id and kind = 'axis'
  ) then
    raise exception 'notes.parent_id % is not an axis', new.parent_id;
  end if;
  return new;
end $$;

drop trigger if exists notes_parent_axis_trg on notes;
create trigger notes_parent_axis_trg
  before insert or update of parent_id on notes
  for each row execute function notes_parent_must_be_axis();

-- One synthesis and one exam move per axis. Fichas are many.
create unique index if not exists notes_one_synthesis_per_axis
  on notes (parent_id) where kind = 'synthesis';
create unique index if not exists notes_one_exam_move_per_axis
  on notes (parent_id) where kind = 'exam_move';

create index if not exists notes_parent_idx      on notes (parent_id, ordinal);
create index if not exists notes_kind_idx        on notes (kind);
create index if not exists notes_attribution_idx on notes (attribution);

-- The review queue for the second column: claims she has not yet classified.
create index if not exists notes_unattributed_idx
  on notes (id) where attribution is null;

create index if not exists notes_rejected_idx
  on notes (rejected_at) where rejected_at is not null;

-- ---------------------------------------------------------------------------
-- 2. note_works: argument-level membership
-- ---------------------------------------------------------------------------
-- role is the CiTO-style relation between the note and the work. The form
-- sets 'about' (a plain note on a whole work, no page, no quote), 'ficha',
-- and 'yield' (a work named in a synthesis with no ficha of its own, the
-- "rédito literario"); accepting a proposal sets 'supports' or 'disputes';
-- the remaining two are reserved for the concept-note use case and are not
-- exposed anywhere yet. She never picks a role from a menu.

create table if not exists note_works (
  note_id bigint not null references notes(id) on delete cascade,
  work_id text   not null references works(id) on delete cascade,
  role    text   not null default 'about',
  ordinal int    not null default 1,
  primary key (note_id, work_id),
  constraint note_works_role_ck check (role in (
    'about', 'ficha', 'yield', 'supports', 'disputes', 'applies', 'introduces'
  ))
);

create index if not exists note_works_work_idx on note_works (work_id, role);

-- ---------------------------------------------------------------------------
-- 3. note_anchors: her translation beside the quote
-- ---------------------------------------------------------------------------
-- In her notes the translation renders the quoted block as a unit and makes
-- no claim of its own, so it belongs with the quote rather than in a note.

alter table note_anchors add column if not exists translation text;

-- ---------------------------------------------------------------------------
-- 4. note_links: note to note
-- ---------------------------------------------------------------------------
-- The pairwise-links objection in 004 was about works. Axis-to-axis
-- references ("puente al Eje 3", "los Ejes 3 y 4 se entrelazan") and a
-- question answered by a later note really are pairwise and typed.
-- Directed: a bridge is from the axis that names it; 'answers' is from the
-- answer to the question.

create table if not exists note_links (
  from_note bigint not null references notes(id) on delete cascade,
  to_note   bigint not null references notes(id) on delete cascade,
  kind      text   not null,
  primary key (from_note, to_note, kind),
  constraint note_links_kind_ck check (kind in ('bridge', 'contrast', 'answers')),
  constraint note_links_not_self_ck check (from_note <> to_note)
);

create index if not exists note_links_to_idx on note_links (to_note, kind);

-- ---------------------------------------------------------------------------
-- 5. note_revisions follows notes
-- ---------------------------------------------------------------------------
-- 004 moved quote and printed_page out of notes and into note_anchors but left
-- the columns here, so revision rows since then have carried nulls. Dropped.
-- Anchors and memberships are still not versioned (the known limit in 004
-- stands); attribution and title are, because both are her writing.

alter table note_revisions drop column if exists quote;
alter table note_revisions drop column if exists printed_page;
alter table note_revisions add column if not exists title       text;
alter table note_revisions add column if not exists attribution text;

-- ---------------------------------------------------------------------------
-- 6. Views the interface and the map read
-- ---------------------------------------------------------------------------

-- A reported claim with no passage behind it. The first thing an examiner
-- presses on, and the check verify_quotation is there to close.
create or replace view unsupported_claims as
select n.id, n.kind, n.title, n.body, n.parent_id
from notes n
where n.attribution = 'author'
  and n.rejected_at is null
  and not exists (
    select 1 from note_anchors a
    where a.note_id = n.id and a.quote is not null and a.quote <> ''
  );

-- Which works an axis binds, at what grade, through which part. This is the
-- bipartite map. Membership is derived from the children; nothing is stored
-- on the axis row itself.
create or replace view axis_works as
select p.id       as axis_id,
       p.title    as axis_title,
       nw.work_id,
       nw.role,
       c.id       as part_id,
       c.kind     as part_kind,
       c.ordinal  as part_ordinal,
       c.origin,
       c.reviewed
from notes p
join notes c       on c.parent_id = p.id
join note_works nw on nw.note_id = c.id
where p.kind = 'axis'
  and p.rejected_at is null
  and c.rejected_at is null;

-- Her graph: reviewed rows only. The map and the search read this by
-- default; the proposals queue is the complement.
create or replace view reviewed_notes as
select * from notes where reviewed and rejected_at is null;

commit;

-- ---------------------------------------------------------------------------
-- After running
-- ---------------------------------------------------------------------------
-- lib/types.ts and lib/notes.ts were rewritten against this migration in the
-- same push (13 Sept 2026); deploy them together. db/schema.sql is stale
-- since 004 and is not corrected here.
