import Link from 'next/link';

import { CatalogueTable, type Row } from '@/components/catalogue-table';
import { requireAllowedUser } from '@/lib/auth/guard';
import { formatBibliography } from '@/lib/citation';
import { listProjects, projectWorks } from '@/lib/projects';
import {
  examinableIds,
  listExamLists,
  listWorks,
  listWorksInList,
} from '@/lib/works';
import { PURPOSE_LABEL, type Purpose } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PURPOSES: Purpose[] = ['comps', 'both', 'dissertation', 'unassigned'];

// ?project= chooses the project the selection bar adds to and takes out of
// (migration 019), and marks the rows already in it. A project page links
// here to pick its works. The parameter rides along on every filter link.
export default async function WorksPage({
  searchParams,
}: {
  searchParams: Promise<{
    list?: string;
    source?: string;
    purpose?: string;
    kind?: string;
    project?: string;
  }>;
}) {
  await requireAllowedUser();

  const { list, source, purpose, kind, project: rawProject } = await searchParams;

  const [lists, all, examinable, projects] = await Promise.all([
    listExamLists(),
    list ? listWorksInList(list) : listWorks(),
    examinableIds(),
    listProjects(),
  ]);

  const chosen = projects.find((p) => String(p.id) === rawProject) ?? null;
  const membership: Record<string, 'added' | 'notes'> = {};
  if (chosen) {
    for (const m of await projectWorks(chosen.id)) {
      membership[m.work_id] = m.added ? 'added' : 'notes';
    }
  }
  const project = chosen ? String(chosen.id) : undefined;

  const byId = new Map(all.map((w) => [w.id, w]));

  const filtered = all
    .filter((w) =>
      source === 'missing'
        ? w.source_format === 'none'
        : source === 'held'
          ? w.source_format !== 'none'
          : true,
    )
    .filter((w) => (purpose ? w.purpose === purpose : true))
    .filter((w) => (kind === 'contained' ? w.container_id !== null : true));

  const missingCount = all.filter(
    (w) =>
      w.source_format === 'none' &&
      w.container_id === null &&
      examinable.has(w.id),
  ).length;
  const active = lists.find((l) => l.id === list);

  // Counts are about examinable works throughout. Two denominators on one
  // screen — 160 works against 63 with no file — read as an inconsistency even
  // when both are right, because the second silently excluded containers and
  // the working lists.
  const examinableAll = all.filter((w) => examinable.has(w.id));
  const citable = examinableAll.filter(
    (w) => w.source_format === 'pdf_text' || w.source_format === 'pdf_ocr',
  ).length;
  const heldNotCitable = examinableAll.filter(
    (w) => w.source_format === 'epub',
  ).length;

  const rows: Row[] = filtered.map((work) => {
    const container = work.container_id ? byId.get(work.container_id) ?? null : null;
    return {
      id: work.id,
      author: work.author ?? work.editor,
      title: work.title,
      year: work.year,
      kind: work.kind,
      container_title: container?.title ?? null,
      status: work.status,
      purpose: work.purpose,
      standing: work.standing,
      examinable: examinable.has(work.id),
      source_format: work.source_format,
      has_pages: work.has_pages ?? false,
      priority: work.priority,
      missing: formatBibliography(work, container).missing,
    };
  });

  const query = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ list, source, purpose, kind, project, ...extra })) {
      if (value) params.set(key, value);
    }
    const string = params.toString();
    return string ? `/works?${string}` : '/works';
  };

  return (
    <div className="space-y-6">
      {chosen ? (
        <p className="border-l-2 border-accent pl-3 text-sm">
          Choosing works for{' '}
          <Link href={`/projects/${chosen.id}`} className="text-accent hover:underline">
            {chosen.name}
          </Link>
          : tick works, then Add to project or Take out of project in the bar.{' '}
          <Link href={query({ project: undefined })} className="text-xs text-muted hover:text-accent">
            stop
          </Link>
        </p>
      ) : null}

      <div>
        <h1 className="text-2xl mb-1">{active ? active.name : 'Catalogue'}</h1>
        <p className="text-sm text-muted">
          {rows.length} shown · {examinableAll.length} examinable, of which{' '}
          {citable} are citable
          {heldNotCitable > 0 ? ` and ${heldNotCitable} held without page numbers` : null}
          {' '}· {missingCount} with no file
        </p>
      </div>

      <nav className="flex flex-wrap items-baseline gap-3 text-sm">
        <Link
          href={query({ list: undefined })}
          className={list ? 'text-muted hover:text-accent' : 'text-accent'}
        >
          All lists
        </Link>
        {lists.map((l) => (
          <Link
            key={l.id}
            href={query({ list: l.id })}
            className={l.id === list ? 'text-accent' : 'text-muted hover:text-accent'}
          >
            {l.name}
            {l.examinable ? null : <span className="text-xs"> (not examinable)</span>}
          </Link>
        ))}
        <Link href="/works/new" className="ml-auto text-xs text-muted hover:text-accent">
          Add a work
        </Link>
        <a href="/api/export/works" className="text-xs text-muted hover:text-accent">
          Download CSV
        </a>
      </nav>

      <nav className="flex flex-wrap gap-3 text-xs">
        <Link
          href={query({ purpose: undefined, source: undefined, kind: undefined })}
          className={!purpose && !source && !kind ? 'text-accent' : 'text-muted hover:text-accent'}
        >
          Any
        </Link>
        {PURPOSES.map((p) => (
          <Link
            key={p}
            href={query({ purpose: p })}
            className={p === purpose ? 'text-accent' : 'text-muted hover:text-accent'}
          >
            {PURPOSE_LABEL[p]}
          </Link>
        ))}
        <Link
          href={query({ source: 'held' })}
          className={source === 'held' ? 'text-accent' : 'text-muted hover:text-accent'}
        >
          File held
        </Link>
        <Link
          href={query({ source: 'missing' })}
          className={source === 'missing' ? 'text-accent' : 'text-muted hover:text-accent'}
        >
          No file yet ({missingCount})
        </Link>
        <Link
          href={query({ kind: 'contained' })}
          className={kind === 'contained' ? 'text-accent' : 'text-muted hover:text-accent'}
        >
          Essays and chapters
        </Link>
      </nav>

      <CatalogueTable
        rows={rows}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        project={chosen ? chosen.id : null}
        membership={membership}
      />
    </div>
  );
}
