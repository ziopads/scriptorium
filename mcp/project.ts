// Projects for the MCP tools (migration 019, lib/projects.ts): list_projects,
// and the project argument of find_works, search and list_notes.
//
// A project's works are the ones added to it and the ones its notes reach, by
// projectWorks() in lib/projects.ts, the rule the project page and its works
// cited use. Its notes are the member notes and the parts of member axes.
// pipeline/mcp_server.py carries copies of both queries (PROJECT_WORKS_SQL,
// PROJECT_NOTES_SQL); change one, change the copy.

import { db } from '@/lib/db';
import { getProject, projectWorks, type Project } from '@/lib/projects';
import { ToolError } from '@/mcp/work';

export async function projectRecord(id: number): Promise<Project> {
  const project = await getProject(id);
  if (project) return project;
  throw new ToolError(`no project ${id}. list_projects gives the ids.`);
}

// work id -> 'added' or 'notes'
export async function projectMembership(id: number): Promise<Map<string, 'added' | 'notes'>> {
  const rows = await projectWorks(id);
  return new Map(rows.map((r) => [r.work_id, r.added ? 'added' : 'notes']));
}

// Member notes and the parts of member axes, rejected ones left out.
export async function projectNoteIds(id: number): Promise<number[]> {
  const rows = (await db()`
    select n.id from notes n
    where n.rejected_at is null
      and n.id in (
        select pn.note_id from project_notes pn where pn.project_id = ${id}
        union
        select c.id from notes c
        join project_notes pn on pn.note_id = c.parent_id
        where pn.project_id = ${id}
      )
  `) as { id: string | number }[];
  return rows.map((r) => Number(r.id));
}
