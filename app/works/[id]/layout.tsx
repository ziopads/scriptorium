import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Stars } from '@/components/stars';
import { WorkTabs } from '@/components/work-tabs';
import { requireAllowedUser } from '@/lib/auth/guard';
import { claimCounts, listAxesForWork, listNotesForWork } from '@/lib/notes';
import { examinableIds, getWorkWithContainer, membershipsFor } from '@/lib/works';
import { KIND_LABEL } from '@/lib/types';

// A book's page: the header and the tab bar, drawn once for every tab.
//
// The tabs are the workbench's (Meta, Contents, Preview, Dossier, Claims,
// Notes, Axes), each at its own address under /works/<id>. The claims are one
// aspect of a book among the others, so reviewing them no longer means
// leaving the book for a separate page.

export default async function WorkLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;

  const work = await getWorkWithContainer(id);
  if (!work) notFound();

  const [memberships, examinable, claims, notes, axes] = await Promise.all([
    membershipsFor(id),
    examinableIds(),
    claimCounts(id),
    listNotesForWork(id),
    listAxesForWork(id),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        {work.container ? (
          <p className="text-xs text-muted">
            in{' '}
            <Link href={`/works/${work.container.id}`} className="italic hover:text-accent">
              {work.container.title}
            </Link>
          </p>
        ) : null}

        <h1 className="text-2xl italic">{work.title}</h1>
        {work.subtitle ? <p className="text-lg italic text-muted">{work.subtitle}</p> : null}
        <p className="text-sm text-muted">
          {work.author ?? work.editor ?? 'Author unknown'}
          {work.year !== null ? ` · ${work.year}` : null}
          {work.kind !== 'monograph' ? ` · ${KIND_LABEL[work.kind]}` : null}
          {examinable.has(work.id) ? null : ' · not examinable'}
        </p>

        <div className="flex items-baseline gap-2 text-sm">
          <span className="text-muted">Rating</span>
          <Stars id={work.id} value={work.priority} />
        </div>

        <div className="flex flex-wrap items-baseline gap-3 pt-2 text-sm">
          {memberships.map((m) => (
            <Link
              key={m.id}
              href={`/works?list=${m.id}`}
              className="text-accent hover:underline underline-offset-2"
            >
              {m.name}
              {m.section_title ? (
                <span className="text-muted"> · {m.section_letter}. {m.section_title}</span>
              ) : null}
              {m.section_kind === 'supplementary' ? (
                <span className="text-muted"> (supplementary)</span>
              ) : null}
            </Link>
          ))}
          <span className="ml-auto flex items-baseline gap-3">
            {work.has_pages ? (
              <Link
                href={`/?w=${encodeURIComponent(work.id)}`}
                className="text-accent hover:underline underline-offset-2"
                title="Open the book in the workbench, where passages become notes"
              >
                Open in the workbench
              </Link>
            ) : null}
            <Link href={`/works/${work.id}/edit`} className="text-muted hover:text-accent">
              Edit
            </Link>
          </span>
        </div>
      </header>

      <WorkTabs
        id={work.id}
        counts={{ claims: claims.all, notes: notes.length, axes: axes.length }}
      />

      <div>{children}</div>
    </div>
  );
}
