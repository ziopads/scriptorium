import Link from 'next/link';

import { FilterChips } from '@/components/filter-chips';
import { requireAllowedUser } from '@/lib/auth/guard';
import { FILE_STATES, fileStates, type FileState } from '@/lib/gaps';

export const dynamic = 'force-dynamic';

// The Gaps page's Files tab: every examinable book by how far its file has
// got, from no PDF at all to searchable, one state at a time. The state is in
// the URL (?state=), chosen with the sub-tabs, so it survives scrolling and
// the back button.
//
// Replaces the "No copy yet", "Waiting on OCR" and "Not yet looked at" lists,
// which read works.pdf_state, a column nothing has updated since the pipeline
// stopped reading books.csv.

export default async function GapsFilesPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  await requireAllowedUser();
  const { state } = await searchParams;
  const rows = await fileStates();

  const active: FileState = FILE_STATES.some((s) => s.id === state)
    ? (state as FileState)
    : 'no_pdf';
  const current = FILE_STATES.find((s) => s.id === active)!;
  const works = rows.filter((r) => r.state === active);

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-sm text-muted">
        {rows.length} examinable books, essays counted with their volumes. A PDF counts
        as held when the record names one; the pipeline accepts it only from the
        ACCOUNTED folder, and refuses by name any that sit elsewhere.
      </p>

      <FilterChips
        label="File states"
        active={active}
        chips={FILE_STATES.map((s) => ({
          id: s.id,
          label: s.label,
          count: rows.filter((r) => r.state === s.id).length,
          href: s.id === 'no_pdf' ? '/gaps/files' : `/gaps/files?state=${s.id}`,
        }))}
      />

      <p className="max-w-prose text-sm text-muted">{current.blurb}</p>

      {works.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className="max-w-4xl divide-y divide-rule border-y border-rule">
          {works.map((w) => (
            <li key={w.id} className="space-y-0.5 py-1.5 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="w-48 shrink-0 truncate">{w.author ?? '\u2014'}</span>
                <Link href={`/works/${w.id}`} className="min-w-0 flex-1 italic hover:text-accent">
                  {w.title}
                </Link>
                {w.year ? <span className="text-xs text-muted">{w.year}</span> : null}
                {w.pdf_verdict && active !== 'searchable' ? (
                  <span className="text-xs text-accent">{w.pdf_verdict}</span>
                ) : null}
              </div>
              {w.source_path ? (
                <p className="truncate font-mono text-xs text-muted" title={w.source_path}>
                  {w.source_path}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
