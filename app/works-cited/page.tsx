import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { formatBibliography, plain, type Style } from '@/lib/citation';
import { getProject, projectWorks } from '@/lib/projects';
import { getWork } from '@/lib/works';
import type { Work } from '@/lib/types';

export const dynamic = 'force-dynamic';

// A works cited from works ticked on the catalogue.
//
// Not CSV. A works cited is prose that goes into a chapter; comma-delimited
// columns are the wrong shape. The CSV exports are for data.
//
// The selection arrives as repeated ?id= parameters because the form uses GET,
// so the result is a URL she can bookmark, re-open, or send to her advisor
// without re-ticking a hundred boxes. ?project= takes a project's works instead
// (lib/projects.ts: its works and the works its notes reach), so a project's
// works cited stays current as the project grows.
//
// ?style= is chicago (17th, the default), chicago18 or mla: the record holds a
// superset of what each needs, so the style is a function. Both Chicago
// editions are offered so she can cite by whichever her department asks for.

const STYLE_LABEL: Record<Style, string> = {
  chicago: 'Chicago 17th',
  chicago18: 'Chicago 18th',
  mla: 'MLA 9th',
};

export default async function WorksCitedPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[]; style?: string; project?: string }>;
}) {
  await requireAllowedUser();

  const { id, style: rawStyle, project: rawProject } = await searchParams;
  const style: Style =
    rawStyle === 'mla' ? 'mla' : rawStyle === 'chicago18' ? 'chicago18' : 'chicago';

  const projectId = rawProject ? Number.parseInt(rawProject, 10) : Number.NaN;
  const project = Number.isNaN(projectId) ? null : await getProject(projectId);

  const ids = project
    ? (await projectWorks(project.id)).map((m) => m.work_id)
    : id === undefined
      ? []
      : Array.isArray(id)
        ? id
        : [id];
  const found = await Promise.all(ids.map((one) => getWork(one)));
  const works = found.filter((w): w is Work => w !== null);

  // Containers, fetched once for the essays that need them.
  const containerIds = [...new Set(works.map((w) => w.container_id).filter(Boolean))] as string[];
  const containers = new Map(
    (await Promise.all(containerIds.map((c) => getWork(c))))
      .filter((c): c is Work => c !== null)
      .map((c) => [c.id, c]),
  );

  // Chicago and MLA both alphabetise by the author's surname, and the records
  // already store the inverted form, so sorting the stored string is correct.
  works.sort((a, b) =>
    (a.author ?? a.editor ?? a.title).localeCompare(b.author ?? b.editor ?? b.title, 'es'),
  );

  const entries = works.map((work) => ({
    work,
    citation: formatBibliography(
      work,
      work.container_id ? containers.get(work.container_id) ?? null : null,
      style,
    ),
  }));

  const incomplete = entries.filter((e) => e.citation.missing.length > 0);
  const text = entries.map((e) => plain(e.citation.text)).join('\n\n');
  const selection = project
    ? `project=${project.id}`
    : ids.map((i) => `id=${encodeURIComponent(i)}`).join('&');
  const others = (Object.keys(STYLE_LABEL) as Style[]).filter((s) => s !== style);
  const hrefFor = (s: Style) => `/works-cited?${selection}&style=${s}`;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        {project ? (
          <p className="text-xs text-muted">
            <Link href={`/projects/${project.id}`} className="hover:text-accent">
              {project.name}
            </Link>
          </p>
        ) : null}
        <h1 className="text-2xl">Works cited</h1>
        <p className="text-sm text-muted">
          {works.length} {works.length === 1 ? 'entry' : 'entries'} · {STYLE_LABEL[style]} ·
          sorted by author · switch to{' '}
          {others.map((s, i) => (
            <span key={s}>
              {i > 0 ? ' or ' : null}
              <Link href={hrefFor(s)} className="text-accent hover:underline">
                {STYLE_LABEL[s]}
              </Link>
            </span>
          ))}
        </p>
      </header>

      {works.length === 0 ? (
        <p className="text-sm">
          Nothing selected.{' '}
          <Link href="/works" className="text-accent underline underline-offset-2">
            Choose works on the catalogue
          </Link>{' '}
          and submit.
        </p>
      ) : (
        <>
          {incomplete.length > 0 ? (
            <div className="border-l-2 border-accent pl-3 text-sm">
              <p className="text-accent">
                {incomplete.length}{' '}
                {incomplete.length === 1 ? 'entry is' : 'entries are'} incomplete.
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {incomplete.map((entry) => (
                  <li key={entry.work.id}>
                    <Link href={`/works/${entry.work.id}/edit`} className="hover:text-accent">
                      {entry.work.title}
                    </Link>{' '}
                    — missing {entry.citation.missing.join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ol className="space-y-3 text-sm">
            {entries.map((entry) => (
              <li key={entry.work.id} className="border-l-2 border-rule pl-6 -indent-3">
                {plain(entry.citation.text)}
              </li>
            ))}
          </ol>

          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted">
              Plain text — select all and copy
            </p>
            <textarea
              readOnly
              rows={Math.min(24, entries.length * 3 + 2)}
              value={text}
              className="font-mono text-xs"
            />
          </div>
        </>
      )}
    </div>
  );
}
