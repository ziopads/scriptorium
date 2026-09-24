-- Scriptorium — migration 019: projects
--
-- Run against a database carrying 001–018. Additive: three new tables. No
-- existing row changes.
--
-- WHAT A PROJECT IS
--
--   Works and notes gathered for one piece of writing: first the five one-day
--   comps essays, later dissertation chapters. A project's works cited is its
--   works plus every work its notes quote or are about (lib/projects.ts), so
--   /works-cited only has to be told the project.
--
-- WHY MEMBERSHIP TABLES
--
--   Decided 24 Sept 2026 (docs/HANDOFF.md, evening update). Tags on notes need
--   no schema, but works take no tags, so a book with no notes yet could not
--   join a project. A project as a kind of note fails on the single parent_id:
--   one note can serve several essays. So membership is two many-to-many
--   tables, one for works and one for notes.
--
--   An axis added to a project brings its parts (fichas, synthesis, exam move)
--   with it; that is read through parent_id and nothing is stored for the
--   parts. Membership is not versioned, as note_works and note_anchors are
--   not.
--
-- list_id is optional: whether each comps essay is tied to one exam list is
-- a question for Zazil. When it is set, the project page offers to add that
-- list's works in one step; nothing else depends on it.
--
-- id is int rather than bigint because the Neon HTTP driver returns bigint as
-- a string (docs/HANDOFF.md, 24 Sept, note ids), and a project count will
-- never need the range.

begin;

create table if not exists projects (
  id          int generated always as identity primary key,
  name        text not null,
  kind        text not null default 'comps',
  list_id     text references exam_lists(id) on delete set null,
  question    text,
  due_on      date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint projects_kind_ck check (kind in ('comps', 'chapter', 'other')),
  constraint projects_name_ck check (btrim(name) <> '')
);

create table if not exists project_works (
  project_id  int    not null references projects(id) on delete cascade,
  work_id     text   not null references works(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (project_id, work_id)
);

create index if not exists project_works_work_idx on project_works (work_id);

create table if not exists project_notes (
  project_id  int    not null references projects(id) on delete cascade,
  note_id     bigint not null references notes(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (project_id, note_id)
);

create index if not exists project_notes_note_idx on project_notes (note_id);

commit;
