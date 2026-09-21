import Link from 'next/link';

import { FilterChips } from '@/components/filter-chips';
import { requireAllowedUser } from '@/lib/auth/guard';
import { day } from '@/lib/dates';
import { analysisStates } from '@/lib/gaps';

export const dynamic = 'force-dynamic';

// The Gaps page's Analysis tab: every book with pages loaded, split by whether
// it has a study aid, one side at a time (?show=without or ?show=with). A
// study aid is made with pipeline/dossier.py.

export default async function GapsAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requireAllowedUser();
  const { show } = await searchParams;
  const rows = await analysisStates();
  const without = rows.filter((r) => !r.has_aid);
  const withAid = rows.filter((r) => r.has_aid);
  const active = show === 'with' ? 'with' : 'without';

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-sm text-muted">
        {rows.length} books have their pages loaded. A study aid needs the page
        numbering checked first, so a book listed on the Page numbers tab is not ready
        for one yet.
      </p>

      <FilterChips
        label="Study aids"
        active={active}
        chips={[
          { id: 'without', label: 'No study aid yet', count: without.length, href: '/gaps/analysis' },
          { id: 'with', label: 'With a study aid', count: withAid.length, href: '/gaps/analysis?show=with' },
        ]}
      />

      {active === 'without' ? (
        without.length === 0 ? (
          <p className="text-sm text-muted">Every book with pages has a study aid.</p>
        ) : (
          <ul className="max-w-4xl divide-y divide-rule border-y border-rule">
            {without.map((w) => (
              <li key={w.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm">
                <span className="w-48 shrink-0 truncate">{w.author ?? '\u2014'}</span>
                <Link href={`/works/${w.id}`} className="min-w-0 flex-1 italic hover:text-accent">
                  {w.title}
                </Link>
                {w.year ? <span className="text-xs text-muted">{w.year}</span> : null}
                <span className="font-mono text-xs text-muted">{w.id}</span>
              </li>
            ))}
          </ul>
        )
      ) : withAid.length === 0 ? (
        <p className="text-sm text-muted">No study aids yet.</p>
      ) : (
        <ul className="max-w-4xl divide-y divide-rule border-y border-rule">
          {withAid.map((w) => (
            <li key={w.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
              <span className="w-48 shrink-0 truncate">{w.author ?? '\u2014'}</span>
              <span className="min-w-0 flex-1">
                <Link href={`/works/${w.id}/dossier`} className="italic hover:text-accent">
                  {w.title}
                </Link>
                {w.aid_at ? (
                  <span className="pl-2 text-xs text-muted">aid of {day(w.aid_at)}</span>
                ) : null}
              </span>
              <Link href={`/works/${w.id}/claims`} className="text-xs text-accent hover:underline underline-offset-2">
                {w.claims === 0
                  ? 'no claims loaded'
                  : w.unreviewed > 0
                    ? `${w.unreviewed} of ${w.claims} claims to review`
                    : `all ${w.claims} claims reviewed`}
              </Link>
              {w.accepted > 0 ? (
                <span className="text-xs text-muted">{w.accepted} accepted</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
