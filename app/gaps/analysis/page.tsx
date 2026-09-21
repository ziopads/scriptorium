import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { day } from '@/lib/dates';
import { analysisStates } from '@/lib/gaps';

export const dynamic = 'force-dynamic';

// The Gaps page's Analysis tab: every book with pages loaded, whether it has a
// study aid, and how far her review of its claims has got. Books without an
// aid come first; a study aid is made with pipeline/dossier.py.

export default async function GapsAnalysisPage() {
  await requireAllowedUser();
  const rows = await analysisStates();
  const without = rows.filter((r) => !r.has_aid);
  const withAid = rows.filter((r) => r.has_aid);

  return (
    <div className="space-y-8">
      <p className="max-w-prose text-sm text-muted">
        {rows.length} books have their pages loaded; {withAid.length} have a study aid.
        An aid needs the page numbering checked first, so a book missing from here, or
        listed on the Page numbers tab, is not ready for one yet.
      </p>

      {without.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg">
            No study aid yet <span className="text-sm text-muted">({without.length})</span>
          </h2>
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
        </section>
      ) : null}

      {withAid.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg">
            With a study aid <span className="text-sm text-muted">({withAid.length})</span>
          </h2>
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
        </section>
      ) : null}
    </div>
  );
}
