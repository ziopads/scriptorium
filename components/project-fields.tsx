import { PROJECT_KINDS, type Project } from '@/lib/projects';
import type { ExamList } from '@/lib/types';

// The fields of a project, for the new-project form on /projects and the edit
// form on a project's page. Defaults from the project when there is one.

export function ProjectFields({
  lists,
  project,
}: {
  lists: ExamList[];
  project?: Project;
}) {
  return (
    <>
      <label className="block space-y-1">
        <span className="text-sm">Name</span>
        <input
          type="text"
          name="name"
          required
          defaultValue={project?.name ?? ''}
          placeholder="Ensayo 1 — Teoría"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-sm">Kind</span>
          <select name="kind" defaultValue={project?.kind ?? 'comps'}>
            {PROJECT_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-sm">Exam list</span>
          <select name="list_id" defaultValue={project?.list_id ?? ''}>
            <option value="">None</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-sm">Date</span>
          <input type="date" name="due_on" defaultValue={project?.due_on ?? ''} />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-sm">Question</span>
        <textarea name="question" rows={3} defaultValue={project?.question ?? ''} className="reading" />
        <span className="block text-xs text-muted">
          The question the essay answers, when it is known. Can be added on the day.
        </span>
      </label>
    </>
  );
}
