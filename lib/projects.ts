// Projects: works and notes gathered for one piece of writing (migration 019).
//
// Membership is two tables, project_works and project_notes. An axis that is
// a member brings its parts with it, read through parent_id; nothing is
// stored for the parts.
//
// A project's works cited is derived, never stored: its works, plus every work
// that its notes (and the parts of its axes) quote or are about. Only notes
// in her graph count toward that, as in the readiness matrix: the
// reviewed_notes view, which leaves out rejected notes and proposals waiting
// for her. A note she added to a project while it was still a proposal
// contributes its works once she accepts it.

import { db } from '@/lib/db';

export type ProjectKind = 'comps' | 'chapter' | 'other';

export const PROJECT_KINDS: { id: ProjectKind; label: string }[] = [
  { id: 'comps', label: 'Comps essay' },
  { id: 'chapter', label: 'Dissertation chapter' },
  { id: 'other', label: 'Other writing' },
];

export interface Project {
  id: number;
  name: string;
  kind: ProjectKind;
  list_id: string | null;
  list_name: string | null;
  question: string | null;
  // 'YYYY-MM-DD', cast to text in the query so the driver does not turn a
  // date into a midnight timestamp in some timezone.
  due_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectSummary extends Project {
  work_count: number;
  note_count: number;
}

export interface ProjectInput {
  name: string;
  kind: ProjectKind;
  list_id: string | null;
  question: string | null;
  due_on: string | null;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const sql = db();
  const rows = await sql`
    select p.id, p.name, p.kind, p.list_id, el.name as list_name, p.question,
           p.due_on::text as due_on, p.created_at, p.updated_at,
           (select count(*)::int from project_works pw where pw.project_id = p.id) as work_count,
           (select count(*)::int from project_notes pn where pn.project_id = p.id) as note_count
    from projects p
    left join exam_lists el on el.id = p.list_id
    order by p.due_on nulls last, p.created_at
  `;
  return rows as ProjectSummary[];
}

export async function getProject(id: number): Promise<Project | null> {
  const sql = db();
  const rows = (await sql`
    select p.id, p.name, p.kind, p.list_id, el.name as list_name, p.question,
           p.due_on::text as due_on, p.created_at, p.updated_at
    from projects p
    left join exam_lists el on el.id = p.list_id
    where p.id = ${id}
  `) as Project[];
  return rows[0] ?? null;
}

export async function createProject(input: ProjectInput): Promise<number> {
  const sql = db();
  const rows = (await sql`
    insert into projects (name, kind, list_id, question, due_on)
    values (${input.name}, ${input.kind}, ${input.list_id}, ${input.question}, ${input.due_on})
    returning id
  `) as { id: number }[];
  return rows[0].id;
}

export async function updateProject(id: number, input: ProjectInput): Promise<void> {
  const sql = db();
  await sql`
    update projects set
      name = ${input.name}, kind = ${input.kind}, list_id = ${input.list_id},
      question = ${input.question}, due_on = ${input.due_on}, updated_at = now()
    where id = ${id}
  `;
}

// Deletes the project and its memberships. The works and notes themselves are
// untouched.
export async function deleteProject(id: number): Promise<void> {
  const sql = db();
  await sql`delete from projects where id = ${id}`;
}

export async function addProjectWorks(projectId: number, workIds: string[]): Promise<number> {
  if (workIds.length === 0) return 0;
  const sql = db();
  const rows = (await sql`
    insert into project_works (project_id, work_id)
    select ${projectId}, w.id from works w where w.id = any(${workIds}::text[])
    on conflict do nothing
    returning work_id
  `) as { work_id: string }[];
  await touch(projectId);
  return rows.length;
}

// Every work on one list, in one step: for an essay tied to a list.
export async function addListWorks(projectId: number, listId: string): Promise<number> {
  const sql = db();
  const rows = (await sql`
    insert into project_works (project_id, work_id)
    select ${projectId}, li.work_id from list_items li where li.list_id = ${listId}
    on conflict do nothing
    returning work_id
  `) as { work_id: string }[];
  await touch(projectId);
  return rows.length;
}

export async function removeProjectWork(projectId: number, workId: string): Promise<void> {
  const sql = db();
  await sql`delete from project_works where project_id = ${projectId} and work_id = ${workId}`;
  await touch(projectId);
}

export async function addProjectNotes(projectId: number, noteIds: number[]): Promise<number> {
  if (noteIds.length === 0) return 0;
  const sql = db();
  const rows = (await sql`
    insert into project_notes (project_id, note_id)
    select ${projectId}, n.id from notes n where n.id = any(${noteIds}::bigint[])
    on conflict do nothing
    returning note_id
  `) as { note_id: string }[];
  await touch(projectId);
  return rows.length;
}

export async function removeProjectNote(projectId: number, noteId: number): Promise<void> {
  const sql = db();
  await sql`delete from project_notes where project_id = ${projectId} and note_id = ${noteId}`;
  await touch(projectId);
}

async function touch(projectId: number): Promise<void> {
  const sql = db();
  await sql`update projects set updated_at = now() where id = ${projectId}`;
}

// The project's works: those added to it, and those its notes reach. added
// and from_notes say which, and both can be true.
export interface ProjectWork {
  work_id: string;
  added: boolean;
  from_notes: boolean;
}

export async function projectWorks(projectId: number): Promise<ProjectWork[]> {
  const sql = db();
  const rows = await sql`
    with members as (
      select note_id from project_notes where project_id = ${projectId}
    ),
    -- Member notes, and the parts of member axes.
    scope as (
      select m.note_id as id from members m
      union
      select c.id from notes c join members m on m.note_id = c.parent_id
    ),
    from_notes as (
      select distinct t.work_id
      from (
        select note_id, work_id from note_anchors
        union
        select note_id, work_id from note_works
      ) t
      join scope s on s.id = t.note_id
      join reviewed_notes r on r.id = t.note_id
    ),
    added as (
      select work_id from project_works where project_id = ${projectId}
    )
    select coalesce(a.work_id, f.work_id) as work_id,
           a.work_id is not null as added,
           f.work_id is not null as from_notes
    from added a
    full join from_notes f on f.work_id = a.work_id
  `;
  return rows as ProjectWork[];
}

// The ids of the notes that are members, for the notes list on the project
// page. Parts of member axes are shown on the axis's own page.
export async function projectNoteIds(projectId: number): Promise<number[]> {
  const sql = db();
  const rows = (await sql`
    select pn.note_id from project_notes pn
    join notes n on n.id = pn.note_id
    where pn.project_id = ${projectId} and n.rejected_at is null
    order by pn.added_at
  `) as { note_id: string | number }[];
  return rows.map((r) => Number(r.note_id));
}
