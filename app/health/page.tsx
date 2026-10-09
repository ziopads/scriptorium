import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { databaseFigures, neonFigures, voyageCheck, type Result } from '@/lib/health';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'System health — Scriptorium' };

// One page to answer "where are we most vulnerable to something failing this
// week?" Every figure is read when the page loads (lib/health.ts); nothing is
// cached. Services that publish no usage API get a link to their dashboard and
// are listed as checked by hand, never given an invented number.

type Level = 'fail' | 'warn' | 'ok' | 'hand';

const WARN_AT = 0.7;
const FAIL_AT = 0.85;

// The Free plan's compute allowance, from neon.com/pricing (checked 8 Oct
// 2026). Used only when Neon's API reports no quota of its own, and labelled so.
const FREE_PLAN_COMPUTE_HOURS = 100;

const NEON_PROJECT = process.env.NEON_PROJECT_ID ?? 'dark-glade-66435488';

const LINKS = [
  { label: 'Neon project', href: `https://console.neon.tech/app/projects/${NEON_PROJECT}` },
  { label: 'Neon billing and usage', href: 'https://console.neon.tech/app/billing' },
  { label: 'Vercel dashboard (Usage tab)', href: 'https://vercel.com/dashboard' },
  { label: 'Voyage dashboard (usage, rate limits)', href: 'https://dashboard.voyageai.com/' },
  { label: 'Claude usage (each person signs in to their own)', href: 'https://claude.ai/settings/usage' },
  { label: 'GitHub repository', href: 'https://github.com/ziopads/scriptorium' },
];

interface Row {
  level: Level;
  what: string;
  reading: string;
  note?: string;
  href?: string;
  share?: number;
}

function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'not reported';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} kB`;
}

function hours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)} h`;
}

function levelFor(share: number): Level {
  return share >= FAIL_AT ? 'fail' : share >= WARN_AT ? 'warn' : 'ok';
}

function day(iso: string | null): string {
  if (!iso) return 'not reported';
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric',
  });
}

const BADGE: Record<Level, { label: string; cls: string }> = {
  fail: { label: 'Act now', cls: 'bg-accent text-background' },
  warn: { label: 'Watch', cls: 'border border-accent text-accent' },
  ok: { label: 'OK', cls: 'border border-rule text-muted' },
  hand: { label: 'Check by hand', cls: 'border border-dashed border-rule text-muted' },
};

const ORDER: Record<Level, number> = { fail: 0, warn: 1, hand: 2, ok: 3 };

function Bar({ share }: { share: number }) {
  const pct = Math.min(100, Math.round(share * 100));
  return (
    <span className="inline-block h-1.5 w-32 bg-rule align-middle" aria-hidden>
      <span className="block h-1.5 bg-accent" style={{ width: `${pct}%` }} />
    </span>
  );
}

function failed<T>(r: Result<T>): r is Result<T> & { error: string } {
  return r.error !== undefined;
}

export default async function HealthPage() {
  await requireAllowedUser();

  const neonPending = neonFigures();
  const [database, neon, voyage] = await Promise.all([
    databaseFigures(),
    neonPending ?? Promise.resolve(null),
    voyageCheck(),
  ]);
  const checkedAt = new Date().toLocaleString('en-US', {
    timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'medium',
  });

  const rows: Row[] = [];

  // Neon: storage and compute, as Neon measures them.
  if (neon === null) {
    rows.push({
      level: 'hand',
      what: 'Neon storage and compute',
      reading: 'Not connected: NEON_API_KEY and NEON_PROJECT_ID are not set',
      note: 'Add both in Vercel (and .env.local) to read these live.',
      href: LINKS[1].href,
    });
  } else if (failed(neon)) {
    rows.push({ level: 'fail', what: 'Neon API', reading: `Could not read: ${neon.error}`, href: LINKS[0].href });
  } else if (neon.value) {
    const n = neon.value;
    const production = n.branches.find((b) => b.isDefault) ?? n.branches[0];
    if (production && production.logicalBytes !== null && n.storageLimitBytes) {
      const share = production.logicalBytes / n.storageLimitBytes;
      rows.push({
        level: levelFor(share),
        what: `Neon storage (${production.name})`,
        reading: `${bytes(production.logicalBytes)} of ${bytes(n.storageLimitBytes)}`,
        note: 'Over the limit, Neon blocks writes.',
        share,
        href: LINKS[1].href,
      });
    } else {
      rows.push({
        level: 'hand',
        what: 'Neon storage',
        reading: `${bytes(production?.logicalBytes)} used; limit not reported by the API`,
        href: LINKS[1].href,
      });
    }
    if (n.computeSeconds !== null) {
      const quota = n.computeQuotaSeconds ?? FREE_PLAN_COMPUTE_HOURS * 3600;
      const share = n.computeSeconds / quota;
      rows.push({
        level: levelFor(share),
        what: 'Neon compute this period',
        reading: `${hours(n.computeSeconds)} of ${hours(quota)}`,
        note:
          (n.computeQuotaSeconds === null
            ? 'Limit is the Free plan allowance from the pricing page; the API reported none. '
            : '') + `Period ${day(n.periodStart)} – ${day(n.periodEnd)}. Run out and the database suspends.`,
        share,
        href: LINKS[1].href,
      });
    } else {
      rows.push({ level: 'hand', what: 'Neon compute', reading: 'Not reported by the API', href: LINKS[1].href });
    }
  }

  // Postgres: the database answering at all, and its own size.
  if (failed(database)) {
    rows.push({ level: 'fail', what: 'Database', reading: `Query failed: ${database.error}`, href: LINKS[0].href });
  } else if (database.value) {
    const d = database.value;
    rows.push({
      level: 'ok',
      what: 'Database answering',
      reading: `${bytes(d.bytes)} of data and indexes · ${database.ms} ms`,
      note: 'Postgres’s own count. Neon’s storage figure above also counts history.',
    });
    rows.push({
      level: d.chunksUnembedded > 0 ? 'warn' : 'ok',
      what: 'Search coverage',
      reading: `${d.chunks.toLocaleString()} chunks · ${d.chunksUnembedded.toLocaleString()} without embeddings`,
      note: d.chunksUnembedded > 0 ? 'Run embed.py for the works named on the Gaps page.' : undefined,
      href: '/gaps',
    });
  }

  // Voyage: the call every meaning search makes.
  if (failed(voyage)) {
    const limited = /HTTP 429/.test(voyage.error);
    rows.push({
      level: 'fail',
      what: 'Voyage (query embeddings)',
      reading: limited ? 'Rate limited (HTTP 429)' : `Failed: ${voyage.error}`,
      note: 'While this fails, search by meaning fails, in the app and through Claude.',
      href: LINKS[3].href,
    });
  } else {
    rows.push({
      level: voyage.ms > 5000 ? 'warn' : 'ok',
      what: 'Voyage (query embeddings)',
      reading: `Answering · ${voyage.ms} ms`,
      note: 'Usage totals and rate limits have no API: see the dashboard.',
      href: LINKS[3].href,
    });
  }

  // No usage API.
  rows.push({
    level: 'hand',
    what: 'Vercel (hosting, function time)',
    reading: 'No usage API this page can read',
    href: LINKS[2].href,
  });
  rows.push({
    level: 'hand',
    what: 'Claude (Zazil’s Pro, James’s Max)',
    reading: 'No usage API; limits reset in five-hour windows',
    note: 'The likeliest interruption for her during long research sessions.',
    href: LINKS[4].href,
  });

  rows.sort((a, b) => ORDER[a.level] - ORDER[b.level] || (b.share ?? 0) - (a.share ?? 0));
  const worst = rows[0];

  return (
    <div className="max-w-4xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl">System health</h1>
        <p className="text-sm text-muted">
          Read live at {checkedAt} (Denver). Reload the page to check again.
        </p>
        {worst && worst.level !== 'ok' ? (
          <p className="pt-2 text-sm">
            Most vulnerable now: <strong>{worst.what}</strong> — {worst.reading}
          </p>
        ) : null}
      </header>

      <section className="space-y-2">
        <h2 className="text-base">Limits and services, most vulnerable first</h2>
        <ul className="divide-y divide-rule border-y border-rule">
          {rows.map((r) => (
            <li key={r.what} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3 text-sm">
              <span className={`w-28 shrink-0 px-2 py-0.5 text-center text-xs ${BADGE[r.level].cls}`}>
                {BADGE[r.level].label}
              </span>
              <span className="w-56 shrink-0">{r.what}</span>
              <span className="flex-1">
                {r.reading}
                {r.share !== undefined ? (
                  <span className="ml-3 whitespace-nowrap text-xs text-muted">
                    <Bar share={r.share} /> {Math.round(r.share * 100)}%
                  </span>
                ) : null}
                {r.note ? <span className="block text-xs text-muted">{r.note}</span> : null}
              </span>
              {r.href ? (
                r.href.startsWith('/') ? (
                  <Link href={r.href} className="text-xs text-accent hover:underline">open</Link>
                ) : (
                  <a href={r.href} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                    open ↗
                  </a>
                )
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          Watch from {Math.round(WARN_AT * 100)}% of a limit; act from {Math.round(FAIL_AT * 100)}%.
        </p>
      </section>

      {database.value ? (
        <section className="space-y-2">
          <h2 className="text-base">Database</h2>
          <p className="text-sm text-muted">
            {database.value.works} works · {database.value.worksWithPages} with pages ·{' '}
            {database.value.worksBlocked} blocked on page numbers · {database.value.dossierSections}{' '}
            study-aid sections · {database.value.proposals.toLocaleString()} assistant proposals awaiting review
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-normal">Largest tables</th>
                <th className="py-1 text-right font-normal">Size</th>
                <th className="py-1 text-right font-normal">Rows (estimate)</th>
              </tr>
            </thead>
            <tbody>
              {database.value.tables.map((t) => (
                <tr key={t.name} className="border-t border-rule">
                  <td className="py-1 font-mono text-xs">{t.name}</td>
                  <td className="py-1 text-right">{bytes(t.bytes)}</td>
                  <td className="py-1 text-right">{Math.round(t.rows).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {neon && neon.value ? (
        <section className="space-y-2">
          <h2 className="text-base">Neon branches</h2>
          <ul className="text-sm">
            {neon.value.branches.map((b) => (
              <li key={b.name}>
                {b.name}
                {b.isDefault ? ' (default)' : ''} — {bytes(b.logicalBytes)}
                {b.state ? ` · ${b.state}` : ''}
              </li>
            ))}
          </ul>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">What Neon’s API returned</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(neon.value.raw, null, 2)}
            </pre>
          </details>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-base">Dashboards</h2>
        <ul className="space-y-1 text-sm">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                {l.label} ↗
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
