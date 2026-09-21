import { notFound } from 'next/navigation';

import { ClaimCard } from '@/components/claim-card';
import { FilterChips } from '@/components/filter-chips';
import { requireAllowedUser } from '@/lib/auth/guard';
import { CLAIM_FILTERS, claimCounts, listClaimsForWork, type ClaimFilter } from '@/lib/notes';
import { listSections } from '@/lib/sections';
import type { NoteWithRelations } from '@/lib/types';
import { getWork } from '@/lib/works';

export const dynamic = 'force-dynamic';

// The book page's Claims tab: the claims the study aid was condensed from,
// for review. pipeline/dossier.py --load writes each as an assistant note;
// here she goes through them and keeps the strongest. Accepted claims become
// ordinary notes (in her lists, attachable to axes) and are what the
// workbench's Claims tab shows. Rejecting hides a claim without deleting it;
// Reconsider brings it back.
//
// Grouped by where in the book each claim's first quotation falls: by chapter
// where the book has a chapter map, otherwise in bands of thirty pages. The
// status filter is in the URL so a half-finished review can be returned to.

const BAND = 30;

interface Group {
  key: string;
  label: string;
  claims: NoteWithRelations[];
}

function firstPage(claim: NoteWithRelations, workId: string): number | null {
  const pages = claim.anchors
    .filter((a) => a.work_id === workId && a.printed_page !== null)
    .map((a) => a.printed_page as number);
  return pages.length ? Math.min(...pages) : null;
}

export default async function WorkClaimsPage({
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

  const [counts, claims, allSections] = await Promise.all([
    claimCounts(id),
    listClaimsForWork(id, filter),
    listSections(id),
  ]);

  if (counts.all === 0) {
    return (
      <p className="text-sm text-muted">
        No claims loaded for this book yet. They arrive with its dossier.
      </p>
    );
  }

  // Chapters where there is a map, bands otherwise.
  const chapters = allSections.filter((s) => s.level === 1);
  const byChapter = chapters.length >= 2;
  const groups = new Map<string, Group>();
  const order: string[] = [];

  function place(claim: NoteWithRelations) {
    const page = firstPage(claim, id);
    let key: string;
    let label: string;
    if (page === null) {
      key = 'none';
      label = 'No page';
    } else if (byChapter) {
      let i = -1;
      for (let k = 0; k < chapters.length; k++) {
        if (chapters[k].first_page <= page) i = k;
      }
      if (i === -1) {
        key = 'before';
        label = `Before ${chapters[0].title}`;
      } else {
        const s = chapters[i];
        const last = s.last_page ?? (chapters[i + 1] ? chapters[i + 1].first_page - 1 : null);
        key = `s${s.ordinal}`;
        label = `${s.title} (pp. ${s.first_page}${last !== null ? `–${last}` : '–'})`;
      }
    } else {
      const band = Math.floor((page - 1) / BAND);
      key = `b${band}`;
      label = `pp. ${band * BAND + 1}–${band * BAND + BAND}`;
    }
    if (!groups.has(key)) {
      groups.set(key, { key, label, claims: [] });
      order.push(key);
    }
    groups.get(key)!.claims.push(claim);
  }
  claims.forEach(place);
  const shown = order.map((k) => groups.get(k)!);

  const lang = work.language?.split(',')[0]?.trim() || undefined;
  const pageHref = (page: number) => `/works/${id}/preview?p=${page}`;

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-sm text-muted">
        The claims the study aid was condensed from, in the book&rsquo;s order, each
        with the passages it rests on. Every quotation was found in the book; each page
        number opens that page. Accept the ones worth keeping: they join your notes and
        appear in the workbench&rsquo;s Claims tab. The wording of each claim is the
        assistant&rsquo;s.
      </p>

      <FilterChips
        label="Filter claims"
        active={filter}
        chips={CLAIM_FILTERS.map((f) => ({
          id: f.id,
          label: f.label,
          count: counts[f.id],
          href: `/works/${id}/claims${f.id === 'unreviewed' ? '' : `?show=${f.id}`}`,
        }))}
      />

      {claims.length === 0 ? (
        <p className="text-sm text-muted">
          {filter === 'unreviewed' ? 'Every claim has been reviewed.' : 'None in this view.'}
        </p>
      ) : (
        <>
          <nav
            id="parts"
            aria-label={byChapter ? 'Chapters' : 'Page ranges'}
            className="flex scroll-mt-4 flex-wrap gap-x-4 gap-y-1 text-sm"
          >
            {shown.map((g) => (
              <a key={g.key} href={`#${g.key}`} className="text-accent hover:underline underline-offset-2">
                {g.label}
                <span className="pl-1 text-xs text-muted">{g.claims.length}</span>
              </a>
            ))}
          </nav>

          <div className="space-y-8">
            {shown.map((g) => (
              <section key={g.key} id={g.key} className="scroll-mt-4 space-y-2">
                <h3 className="text-sm text-accent">{g.label}</h3>
                <ol className="max-w-3xl divide-y divide-rule border-y border-rule">
                  {g.claims.map((c) => (
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
                <p className="max-w-3xl text-right text-xs">
                  <a href="#parts" className="text-muted hover:text-accent">back to the list</a>
                </p>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
