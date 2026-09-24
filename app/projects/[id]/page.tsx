import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NoteCard } from '@/components/note-card';
import { ProjectFields } from '@/components/project-fields';
import { ReadinessCell, ReadinessLegend, tally } from '@/components/readiness-cell';
import { requireAllowedUser } from '@/lib/auth/guard';
import { readableDay } from '@/lib/dates';
import { listNotesByIds } from '@/lib/notes';
import {
  addListToProject,
  addWorkToProject,
  removeNoteFromProject,
  removeProject,
  removeWorkFromProject,
  saveProject,
} from '@/lib/project-actions';
import { PROJECT_KINDS, getProject, projectNoteIds, projectWorks } from '@/lib/projects';
import { preparationFor, type Preparation } from '@/lib/readiness';
import { listExamLists, listWorks } from '@/lib/works';

export const dynamic = 'force-dynamic';

// One project: its works with their readiness, its notes, and its works
// cited. Works are added here; notes are added from the Notes page, by
// ticking them and choosing the project, the same bar that tags them. An
// axis added there brings its fichas, synthesis and exam move.
//
// The works shown are the ones added and the ones its notes reach
// (lib/projects.ts). The works cited is the same set.

const KIND_LABEL = new Map(PROJECT_KINDS.map((k) => [k.id, k.label]));

function sortByAuthor(a: Preparation, b: Preparation): number {
  return (a.author ?? a.editor ?? a.title).localeCompare(b.author ?? b.editor ?? b.title, 'es');
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAllowedUser();
  const { id } = await params;
  const projectId = Number.parseInt(id, 10);
  if (Number.isNaN(projectId)) notFound();

  const project = await getProject(projectId);
  if (!project) notFound();

  const [members, noteIds, lists, works] = await Promise.all([
    projectWorks(projectId),
    projectNoteIds(projectId),
    listExamLists(),
    listWorks(),
  ]);
  const [prep, notes] = await Promise.all([
    preparationFor(members.map((m) => m.work_id)),
    listNotesByIds(noteIds),
  ]);

  const added = members
    .filter((m) => m.added)
    .map((m) => prep.get(m.work_id))
    .filter((p): p is Preparation => p !== undefined)
    .sort(sortByAuthor);
  const reached = members
    .filter((m) => !m.added)
    .map((m) => prep.get(m.work_id))
    .filter((p): p is Preparation => p !== undefined)
    .sort(sortByAuthor);
  const all = [...added, ...reached];
  const t = tally(all);

  const addedIds = new Set(added.map((w) => w.id));
  const addable = works.filter((w) => !addedIds.has(w.id));

  const cited = (style: string) =>
    `/works-cited?project=${project.id}${style === 'chicago' ? '' : `&style=${style}`}`;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs text-muted">
          <Link href="/projects" className="hover:text-accent">Projects</Link>
        </p>
        <h1 className="text-2xl">{project.name}</h1>
        <p className="text-sm text-muted">
          {KIND_LABEL.get(project.kind)}
          {project.list_name ? ` · ${project.list_name}` : null}
          {project.due_on ? ` · ${readableDay(project.due_on)}` : null}
        </p>
        {project.question ? <p className="reading max-w-2xl">{project.question}</p> : null}
      </header>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base">Works</h2>
          <p className="text-xs text-muted">
            {t.works} works · {t.searchable} searchable · {t.notes} with notes · {t.quoted}{' '}
            with a quotation · {t.axis} in an axis · {t.aid} with a reviewed study aid
          </p>
        </div>

        {all.length === 0 ? (
          <p className="text-sm text-muted">
            None yet. Add works below, or add notes from the Notes page: the works they
            quote or are about join the project with them.
          </p>
        ) : (
          <>
            <ReadinessLegend />
            {added.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs text-muted">Added to the project</p>
                <div className="flex flex-wrap gap-1.5">
                  {added.map((w) => (
                    <ReadinessCell key={w.id} item={w} caption={w.year !== null ? String(w.year) : null} />
                  ))}
                </div>
              </div>
            ) : null}
            {reached.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs text-muted">Reached only through the project&rsquo;s notes</p>
                <div className="flex flex-wrap gap-1.5">
                  {reached.map((w) => (
                    <ReadinessCell key={w.id} item={w} caption={w.year !== null ? String(w.year) : null} />
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-rule pt-3 text-sm">
          <form action={addWorkToProject} className="flex min-w-72 flex-1 items-end gap-2">
            <input type="hidden" name="project_id" value={project.id} />
            <label className="flex-1 space-y-1">
              <span className="text-xs text-muted">Add a work</span>
              <select name="work_id" required defaultValue="">
                <option value="" disabled>
                  Choose a work
                </option>
                {addable.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.author ?? w.editor ?? '—'}, {w.title}
                    {w.year !== null ? ` (${w.year})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="text-xs text-accent hover:underline">
              Add
            </button>
          </form>

          {project.list_id ? (
            <form action={addListToProject}>
              <input type="hidden" name="project_id" value={project.id} />
              <input type="hidden" name="list_id" value={project.list_id} />
              <button type="submit" className="text-xs text-accent hover:underline">
                Add every work on {project.list_name}
              </button>
            </form>
          ) : null}

          {added.length > 0 ? (
            <form action={removeWorkFromProject} className="flex items-end gap-2">
              <input type="hidden" name="project_id" value={project.id} />
              <label className="space-y-1">
                <span className="text-xs text-muted">Take a work out</span>
                <select name="work_id" required defaultValue="">
                  <option value="" disabled>
                    Choose a work
                  </option>
                  {added.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.author ?? w.editor ?? '—'}, {w.title}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="text-xs text-muted hover:text-accent">
                Remove
              </button>
            </form>
          ) : null}
        </div>
        <p className="text-xs text-muted">
          A work reached through a note leaves the project when the note does.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base">Works cited</h2>
        <p className="text-sm">
          {all.length} {all.length === 1 ? 'entry' : 'entries'}:{' '}
          <Link href={cited('chicago')} className="text-accent hover:underline">Chicago 17th</Link>
          {' · '}
          <Link href={cited('chicago18')} className="text-accent hover:underline">Chicago 18th</Link>
          {' · '}
          <Link href={cited('mla')} className="text-accent hover:underline">MLA 9th</Link>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base">Notes</h2>
        {notes.length === 0 ? (
          <p className="text-sm text-muted">
            None yet. On the{' '}
            <Link href="/notes" className="text-accent hover:underline">Notes</Link> page, tick
            notes or axes and choose this project. An axis brings its fichas, synthesis and
            exam move.
          </p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                selectSlot={
                  <form action={removeNoteFromProject}>
                    <input type="hidden" name="project_id" value={project.id} />
                    <input type="hidden" name="note_id" value={String(note.id)} />
                    <button
                      type="submit"
                      title="Take this note out of the project. The note itself is kept."
                      aria-label="Take this note out of the project"
                      className="text-xs text-muted hover:text-accent"
                    >
                      ×
                    </button>
                  </form>
                }
              />
            ))}
          </ul>
        )}
      </section>

      <details className="border-t border-rule pt-3">
        <summary className="cursor-pointer text-sm text-accent hover:underline">
          Edit the project
        </summary>
        <form action={saveProject} className="space-y-4 pt-4">
          <input type="hidden" name="project_id" value={project.id} />
          <ProjectFields lists={lists.filter((l) => l.examinable)} project={project} />
          <button
            type="submit"
            className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
          >
            Save
          </button>
        </form>

        <form action={removeProject} className="mt-6 flex flex-wrap items-center gap-3 text-xs">
          <input type="hidden" name="project_id" value={project.id} />
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" name="confirm" value="yes" required className="w-auto" />
            Delete this project. Its works and notes are kept; only the grouping goes.
          </label>
          <button type="submit" className="text-muted hover:text-accent">
            Delete project
          </button>
        </form>
      </details>
    </div>
  );
}
