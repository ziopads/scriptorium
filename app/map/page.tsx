import Link from 'next/link';

import { CorpusMap } from '@/components/corpus-map';
import { requireAllowedUser } from '@/lib/auth/guard';
import { corpusMap } from '@/lib/neighbours';
import { getProject, listProjects, projectWorks } from '@/lib/projects';

export const dynamic = 'force-dynamic';

// The corpus map: every searchable work placed by the resemblance of its text
// to every other's (lib/neighbours.ts), with the language average taken away.
// A prompt for reading and for pairings, not evidence, and the page says so.
// ?focus= opens with one work's nearest works drawn; ?project= dims the works
// outside a project. The resemblances are also listed under the map.

function who(p: { author: string | null; editor: string | null; title: string }): string {
  return (p.author ?? p.editor ?? p.title).split(',')[0];
}

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string; project?: string }>;
}) {
  await requireAllowedUser();
  const { focus, project: rawProject } = await searchParams;
  const projectId = rawProject ? Number.parseInt(rawProject, 10) : Number.NaN;

  const [points, projects, project] = await Promise.all([
    corpusMap(),
    listProjects(),
    Number.isNaN(projectId) ? null : getProject(projectId),
  ]);
  const inProject = project ? (await projectWorks(project.id)).map((m) => m.work_id) : null;
  const byId = new Map(points.map((p) => [p.id, p]));

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl">Corpus map</h1>
        <p className="max-w-3xl text-sm text-muted">
          Every searchable work, placed by how much its text resembles every other&rsquo;s.
          Point at a work to draw lines to its five nearest; those lines are the real
          resemblances, and the positions only approximate them, since a hundred books
          cannot all keep their distances on a flat page. Each language&rsquo;s average has
          been taken away first, so that a Spanish and an English book on the same subject
          can sit together. A prompt for reading and for pairings, never evidence: it
          cannot say why two books sit together.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-2">
          <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="var(--foreground)" /></svg>
          Spanish
        </span>
        <span className="flex items-center gap-2">
          <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="var(--background)" stroke="var(--foreground)" /></svg>
          English
        </span>
        <span>Click a work to open its Nearest tab. Unlabelled points name themselves on hover.</span>
        {projects.length > 0 ? (
          <form action="/map" className="ml-auto flex items-center gap-2">
            {focus ? <input type="hidden" name="focus" value={focus} /> : null}
            <select name="project" defaultValue={project ? String(project.id) : ''} className="w-auto max-w-56">
              <option value="">Every work</option>
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="submit" className="text-accent hover:underline">
              Show
            </button>
          </form>
        ) : null}
      </div>

      {points.length === 0 ? (
        <p className="text-sm text-muted">Not enough searchable works to draw a map.</p>
      ) : (
        <div className="overflow-x-auto border-y border-rule py-2">
          <CorpusMap points={points} focus={focus && byId.has(focus) ? focus : null} inProject={inProject} />
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-accent hover:underline">
          The map as a list: each work&rsquo;s five nearest
        </summary>
        <ul className="mt-2 space-y-1">
          {[...points]
            .sort((a, b) => who(a).localeCompare(who(b), 'es'))
            .map((p) => (
              <li key={p.id}>
                <Link href={`/works/${encodeURIComponent(p.id)}/nearest`} className="hover:text-accent">
                  {who(p)}
                  {p.year !== null ? ` ${p.year}` : ''}
                </Link>
                <span className="text-muted">
                  {' '}—{' '}
                  {p.neighbours
                    .map((n) => {
                      const q = byId.get(n.id);
                      return q ? `${who(q)}${q.year !== null ? ` ${q.year}` : ''} (${n.similarity.toFixed(2)})` : n.id;
                    })
                    .join(', ')}
                </span>
              </li>
            ))}
        </ul>
      </details>
    </div>
  );
}
