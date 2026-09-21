import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ClaimCard } from '@/components/claim-card';
import { requireAllowedUser } from '@/lib/auth/guard';
import { CLAIM_FILTERS, claimCounts, listClaimsForWork, type ClaimFilter } from '@/lib/notes';
import { getWork } from '@/lib/works';

export const dynamic = 'force-dynamic';

// A book's dossier claims, for review. pipeline/dossier.py --load writes each
// claim the study aid was condensed from as an assistant note; here she goes
// through them and keeps the strongest. Accepted claims become ordinary notes
// (in her lists, attachable to axes) and are what the workbench's Claims tab
// shows. Rejecting hides a claim without deleting it; Reconsider brings it back.
//
// The filter is in the URL so a half-finished review can be returned to.

export default async function ClaimsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;
  const { show } = await searchParams;

  const work = await getWork(id);
  if (!work) notFound();

  const filter: ClaimFilter = CLAIM_FILTERS.some((f) => f.id === show)
    ? (show as ClaimFilter)
    : 'unreviewed';

  const [counts, claims] = await Promise.all([
    claimCounts(id),
    listClaimsForWork(id, filter),
  ]);
  const lang = work.language?.split(',')[0]?.trim() || undefined;
  const pageHref = (page: number) =>
    `/?w=${encodeURIComponent(id)}&view=preview&p=${page}`;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs text-muted">
          <Link href={`/works/${id}`} className="hover:text-accent">
            {work.author ?? work.editor ?? 'Author unknown'}, <span className="italic">{work.title}</span>
          </Link>
        </p>
        <h1 className="text-2xl">Claims from the dossier</h1>
        <p className="max-w-prose text-sm text-muted">
          The claims the study aid was condensed from, in the book&rsquo;s order, each
          with the passages it rests on. Every quotation was found in the book; each
          page number opens that page in the workbench. Accept the ones worth keeping:
          they join your notes and appear in the workbench&rsquo;s Claims tab. The
          wording of each claim is the assistant&rsquo;s.
        </p>
      </header>

      {counts.all === 0 ? (
        <p className="text-sm text-muted">
          No claims loaded for this book yet. They arrive with its dossier.
        </p>
      ) : (
        <>
          <nav aria-label="Filter claims" className="flex flex-wrap gap-2 text-sm">
            {CLAIM_FILTERS.map((f) => (
              <Link
                key={f.id}
                href={`/works/${id}/claims${f.id === 'unreviewed' ? '' : `?show=${f.id}`}`}
                aria-current={f.id === filter ? 'page' : undefined}
                className={
                  f.id === filter
                    ? 'border border-accent px-2.5 py-1 text-accent'
                    : 'border border-rule px-2.5 py-1 text-muted hover:text-accent'
                }
              >
                {f.label} <span className="text-xs">{counts[f.id]}</span>
              </Link>
            ))}
          </nav>

          {claims.length === 0 ? (
            <p className="text-sm text-muted">
              {filter === 'unreviewed'
                ? 'Every claim has been reviewed.'
                : 'None in this view.'}
            </p>
          ) : (
            <ol className="max-w-3xl divide-y divide-rule border-y border-rule">
              {claims.map((c) => (
                <ClaimCard
                  key={c.id}
                  claim={c}
                  workId={id}
                  pageHref={pageHref}
                  lang={lang}
                  mode="review"
                />
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
