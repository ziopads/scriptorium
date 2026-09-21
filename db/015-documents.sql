-- Scriptorium — migration 015: documents held in the database
--
-- Run against a database carrying 001–014. Additive: one new table.
--
-- WHY
--
--   The exam list, as her department issued it, is a PDF she needs to print
--   from the list page. It carries her name and her dissertation's structure,
--   so it is kept out of the repository (which is on GitHub) and out of
--   public/ (which anyone with the link could download). It lives here
--   instead, and app/lists/exam-list/route.ts serves it only to a signed-in
--   user.
--
--   One row per document, keyed by a short name the app asks for
--   ('exam-list'). Replacing the list when a new version is issued is
--   pipeline/upload_document.py run again with the new file; no deploy.
--
--   Written only by pipeline/upload_document.py. The application reads it and
--   never writes it.

begin;

create table if not exists documents (
  id           text primary key,
  filename     text not null,
  content_type text not null,
  bytes        bytea not null,
  size         integer not null,
  uploaded_at  timestamptz not null default now()
);

comment on table documents is
  'Files the app serves to a signed-in user and that must not sit in the '
  'repository, such as her exam list. Written by pipeline/upload_document.py.';

commit;
