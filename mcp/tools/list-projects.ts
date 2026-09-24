// list_projects: her projects (migration 019), each a set of works and notes
// gathered for one piece of writing, such as a comps essay. The ids go to the
// project argument of find_works, search and list_notes.
//
// works counts the project's works as the project page does: those added and
// those its notes reach (lib/projects.ts projectWorks). notes counts member
// notes and the parts of member axes (mcp/project.ts).

import { listProjects } from '@/lib/projects';
import { projectMembership, projectNoteIds } from '@/mcp/project';

export async function listProjectsTool() {
  const projects = await listProjects();
  const out = [];
  for (const p of projects) {
    const [works, notes] = await Promise.all([projectMembership(p.id), projectNoteIds(p.id)]);
    out.push({
      id: p.id,
      name: p.name,
      kind: p.kind,
      list: p.list_name,
      question: p.question,
      due_on: p.due_on,
      works: works.size,
      notes: notes.length,
    });
  }
  return { count: out.length, projects: out };
}
