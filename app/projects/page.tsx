import Link from 'next/link';

import { ProjectFields } from '@/components/project-fields';
import { requireAllowedUser } from '@/lib/auth/guard';
import { readableDay } from '@/lib/dates';
import { newProject } from '@/lib/project-actions';
import { PROJECT_KINDS, listProjects } from '@/lib/projects';
import { listExamLists } from '@/lib/works';

export const dynamic = 'force-dynamic';

// Projects: works and notes gathered for one piece of writing, first the five
// comps essays, later dissertation chapters (migration 019). Each has its own
// page with its works' readiness, its notes and its works cited.

const KIND_LABEL = new Map(PROJECT_KINDS.map((k) => [k.id, k.label]));

export default async function ProjectsPage() {
  await requireAllowedUser();

  const [projects, lists] = await Promise.all([listProjects(), listExamLists()]);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl">Projects</h1>
        <p className="text-sm text-muted">
          Works and notes gathered for one piece of writing, each with its own works
          cited.
        </p>
      </header>

      {projects.length === 0 ? (
        <p className="text-sm text-muted">None yet.</p>
      ) : (
        <ol className="divide-y divide-rule border-y border-rule">
          {projects.map((p) => (
            <li key={p.id} className="space-y-1 py-3">
              <Link href={`/projects/${p.id}`} className="font-medium hover:text-accent">
                {p.name}
              </Link>
              {p.question ? <p className="reading-sm">{p.question}</p> : null}
              <p className="text-xs text-muted">
                {KIND_LABEL.get(p.kind)}
                {p.list_name ? ` · ${p.list_name}` : null}
                {p.due_on ? ` · ${readableDay(p.due_on)}` : null} · {p.work_count}{' '}
                {p.work_count === 1 ? 'work' : 'works'} added · {p.note_count}{' '}
                {p.note_count === 1 ? 'note' : 'notes'}
              </p>
            </li>
          ))}
        </ol>
      )}

      <form action={newProject} className="space-y-4 border-t border-rule pt-4">
        <h2 className="text-base">New project</h2>
        <ProjectFields lists={lists.filter((l) => l.examinable)} />
        <button
          type="submit"
          className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
        >
          Create project
        </button>
      </form>
    </div>
  );
}
