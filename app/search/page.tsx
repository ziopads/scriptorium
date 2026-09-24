import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { MEANING_K, motif, type MotifMode, type MotifRow } from '@/lib/motif';
import { getProject, listProjects, projectWorks } from '@/lib/projects';
import { WORD_LIMIT } from '@/lib/search';

export const dynamic = 'force-dynamic';

// Search, drawn as a motif strip: one row per work, the book's length from
// its first printed page to its last, a mark wherever the search found a
// passage (lib/motif.ts). By word it is complete: every passage carrying one
// of the forms. By meaning it is the MEANING_K passages closest to the
// question, in either language. The passages themselves are listed below the
// strip, which is also the strip's content for reading without the picture.
//
// A GET form, so a search is a URL she can keep. ?project= limits it to a
// project's works. Server-rendered: each mark is a link to the page in the
// reader, with its pages and a line of text on hover.

const TRACK = 1000;

function who(row: MotifRow): string {
  return (row.author ?? row.title).split(',')[0];
}

function Strip({ row }: { row: MotifRow }) {
  const span = Math.max(1, row.last - row.first);
  const at = (page: number) => Math.min(TRACK, Math.max(0, ((page - row.first) / span) * TRACK));
  return (
    <svg
      viewBox={`0 0 ${TRACK} 16`}
      preserveAspectRatio="none"
      className="block h-4 w-full"
      role="img"
      aria-label={`${row.marks.length} passages in ${who(row)}, pages ${row.first} to ${row.last}`}
    >
      <line x1={0} y1={8} x2={TRACK} y2={8} stroke="var(--rule)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {row.marks.map((m, i) => {
        const x = at(m.start);
        const width = Math.max(4, at(m.end) - x);
        return (
          <a key={i} href={`/works/${encodeURIComponent(row.id)}/preview?p=${m.start}`}>
            <title>{`p. ${m.pages_label} · ${m.detail}\n${m.excerpt}`}</title>
            <rect
              x={Math.min(x, TRACK - width)}
              y={1}
              width={width}
              height={14}
              fill="var(--accent)"
              opacity={0.2 + 0.8 * m.weight}
            />
          </a>
        );
      })}
    </svg>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: string; project?: string }>;
}) {
  await requireAllowedUser();

  const { q = '', mode: rawMode, project: rawProject } = await searchParams;
  const mode: MotifMode = rawMode === 'meaning' ? 'meaning' : 'words';
  const projectId = rawProject ? Number.parseInt(rawProject, 10) : Number.NaN;

  const [projects, project] = await Promise.all([
    listProjects(),
    Number.isNaN(projectId) ? null : getProject(projectId),
  ]);
  const works = project ? (await projectWorks(project.id)).map((m) => m.work_id) : null;

  const result = q.trim()
    ? works && works.length === 0
      ? null
      : await motif({ mode, query: q, works })
    : null;

  // Groups by list, in the order motif() returns them.
  const groups: { name: string; rows: MotifRow[] }[] = [];
  for (const row of result?.rows ?? []) {
    const name = row.list_name ?? 'Not on a list';
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.rows.push(row);
    else groups.push({ name, rows: [row] });
  }
  const anyUnverified = result?.rows.some((r) => r.unverified) ?? false;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl">Search</h1>
        <p className="text-sm text-muted">
          Where a word or a theme turns up across the books, drawn as a strip per book
          from its first page to its last.
        </p>
      </header>

      <form action="/search" className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={mode === 'words' ? 'lechuza, tecolote, owl' : 'la lechuza como presagio'}
            aria-label="Search"
            className="min-w-64 flex-1"
          />
          <button
            type="submit"
            className="shrink-0 border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
          >
            Search
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="words" defaultChecked={mode === 'words'} className="w-auto" />
            By word
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="meaning" defaultChecked={mode === 'meaning'} className="w-auto" />
            By meaning
          </label>
          {projects.length > 0 ? (
            <label className="flex items-center gap-2">
              <span className="text-muted">In</span>
              <select name="project" defaultValue={project ? String(project.id) : ''} className="w-auto max-w-64">
                <option value="">every searchable work</option>
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <p className="text-xs text-muted">
          By word: every passage with one of the words, forms separated by commas,
          accents and capitals ignored, each matched at the start of a word (lechuza
          finds lechuzas). Complete: no mark means the word is not there. By meaning: the{' '}
          {MEANING_K} passages closest to the question, in Spanish or English whichever
          you write in; no mark means only that other passages were closer. Front matter
          is left out.
        </p>
      </form>

      {works && works.length === 0 ? (
        <p className="text-sm text-muted">
          {project?.name} has no works yet.{' '}
          <Link href={`/works?project=${project?.id}`} className="text-accent hover:underline">
            Add some in the catalogue
          </Link>
          .
        </p>
      ) : null}

      {result?.error ? <p className="text-sm text-accent">{result.error}</p> : null}

      {result && !result.error ? (
        result.rows.length === 0 ? (
          <p className="text-sm text-muted">
            {mode === 'words'
              ? `No passage in the searchable works carries ${result.forms.join(', ')}.`
              : 'Nothing found.'}{' '}
            Works that cannot be searched are listed on{' '}
            <Link href="/gaps/files" className="text-accent hover:underline">
              Gaps → Files
            </Link>
            .
          </p>
        ) : (
          <>
            <section className="space-y-4">
              <p className="text-xs text-muted">
                {result.rows.length} {result.rows.length === 1 ? 'work' : 'works'} ·{' '}
                {result.passages} passages
                {mode === 'words'
                  ? ` · ${result.rows.reduce((n, r) => n + r.hits, 0)} occurrences of ${result.forms.join(', ')}`
                  : ''}
                {project ? ` · in ${project.name}` : ''} · darker marks:{' '}
                {mode === 'words' ? 'more occurrences' : 'closer to the question'} · click a
                mark to open the page
                {result.capped ? ` · stopped at ${WORD_LIMIT} passages; narrow the words` : ''}
              </p>

              {groups.map((g) => (
                <div key={g.name} className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted">{g.name}</p>
                  {g.rows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[minmax(0,14rem)_1fr] items-center gap-3">
                      <Link
                        href={`/?w=${encodeURIComponent(row.id)}`}
                        className="truncate text-xs hover:text-accent"
                        title={`${row.author ?? ''}${row.author ? ', ' : ''}${row.title}`}
                      >
                        {who(row)}
                        {row.year !== null ? ` ${row.year}` : ''}{' '}
                        <span className="italic text-muted">{row.title}</span>
                      </Link>
                      <div className="flex items-center gap-2">
                        <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted">{row.first}</span>
                        <Strip row={row} />
                        <span className="w-24 shrink-0 font-mono text-[10px] text-muted">
                          {row.last}
                          {row.unverified ? '*' : ''} · {row.hits}
                          {row.unchecked ? ' · unchecked' : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              <p className="text-xs text-muted">
                The numbers either side of a strip are the book&rsquo;s first and last printed
                pages, then the count of {mode === 'words' ? 'occurrences' : 'passages'}. A mark
                sits at its passage&rsquo;s pages, which can span two.
                {anyUnverified ? (
                  <>
                    {' '}
                    <span className="text-accent">*</span> Page numbers unverified: check them
                    against the PDF before citing.
                  </>
                ) : null}
                {result.rows.some((r) => r.unchecked)
                  ? ' Unchecked: the numbering was never checked, so its pages are not citations.'
                  : null}
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base">The passages</h2>
              {result.rows.map((row) => (
                <details key={row.id} className="border-t border-rule pt-2">
                  <summary className="cursor-pointer text-sm hover:text-accent">
                    {who(row)}
                    {row.year !== null ? ` ${row.year}` : ''},{' '}
                    <span className="italic">{row.title}</span>{' '}
                    <span className="text-xs text-muted">
                      · {row.marks.length} {row.marks.length === 1 ? 'passage' : 'passages'}
                    </span>
                  </summary>
                  <ol className="mt-2 space-y-2">
                    {row.marks.map((m, i) => (
                      <li key={i} className="reading-sm">
                        <Link
                          href={`/works/${encodeURIComponent(row.id)}/preview?p=${m.start}`}
                          className="font-sans text-xs text-accent hover:underline"
                        >
                          p. {m.pages_label}
                        </Link>{' '}
                        <span className="font-sans text-xs text-muted">{m.detail}</span>
                        <p>{m.excerpt}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
            </section>
          </>
        )
      ) : null}
    </div>
  );
}
