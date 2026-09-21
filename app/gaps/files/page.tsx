import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { FILE_STATES, fileStates } from '@/lib/gaps';

export const dynamic = 'force-dynamic';

// The Gaps page's Files tab: every examinable book by how far its file has
// got, from no PDF at all to searchable. Replaces the "No copy yet", "Waiting
// on OCR" and "Not yet looked at" lists, which read works.pdf_state, a column
// nothing has updated since the pipeline stopped reading books.csv.

export default async function GapsFilesPage() {
  await requireAllowedUser();
  const rows = await fileStates();

  const groups = FILE_STATES.map((s) => ({
    ...s,
    works: rows.filter((r) => r.state === s.id),
  }));

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="max-w-prose text-sm text-muted">
          {rows.length} examinable books, essays counted with their volumes. A PDF counts
          as held when the record names one; the pipeline accepts it only from the
          ACCOUNTED folder, and refuses by name any that sit elsewhere.
        </p>
        <nav aria-label="File states" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {groups.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="text-accent hover:underline underline-offset-2">
              {g.label}
              <span className="pl-1 text-xs text-muted">{g.works.length}</span>
            </a>
          ))}
        </nav>
      </div>

      {groups.map((g) =>
        g.works.length === 0 ? null : (
          <section key={g.id} id={g.id} className="scroll-mt-4 space-y-2">
            <h2 className="text-lg">
              {g.label} <span className="text-sm text-muted">({g.works.length})</span>
            </h2>
            <p className="max-w-prose text-sm text-muted">{g.blurb}</p>
            <ul className="max-w-4xl divide-y divide-rule border-y border-rule">
              {g.works.map((w) => (
                <li key={w.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm">
                  <span className="w-48 shrink-0 truncate">{w.author ?? '\u2014'}</span>
                  <Link href={`/works/${w.id}`} className="min-w-0 flex-1 italic hover:text-accent">
                    {w.title}
                  </Link>
                  {w.year ? <span className="text-xs text-muted">{w.year}</span> : null}
                  {w.pdf_verdict && g.id !== 'searchable' ? (
                    <span className="text-xs text-accent">{w.pdf_verdict}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
