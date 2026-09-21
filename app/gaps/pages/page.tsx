import Link from 'next/link';

import { FilterChips } from '@/components/filter-chips';
import { requireAllowedUser } from '@/lib/auth/guard';
import { uncheckedOffsets } from '@/lib/gaps';
import { worksWithOffsetProblems } from '@/lib/works';

export const dynamic = 'force-dynamic';

// The Gaps page's Page numbers tab, one list at a time (?show=):
//
// Unsettled: offsets.py could not match the printed page numbers to the
// file's pages, so the book is held back from sections, chunks, embeddings
// and a study aid. Fixing one is an offset on its edit page, or ranges in
// page_offsets for a book with an unnumbered insert; then offsets.py is run on
// it again, which clears it from this list.
//
// Unchecked: pages loaded, offsets.py never run. dossier.py refuses these, as
// it refused Adorno on 21 September; offsets.py --apply records the check.

export default async function GapsPagesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requireAllowedUser();
  const { show } = await searchParams;
  const [problems, unchecked] = await Promise.all([
    worksWithOffsetProblems(),
    uncheckedOffsets(),
  ]);

  const active =
    show === 'unsettled' || show === 'unchecked'
      ? show
      : problems.length > 0 ? 'unsettled' : 'unchecked';

  return (
    <div className="space-y-5">
      <FilterChips
        label="Page numbering"
        active={active}
        chips={[
          { id: 'unsettled', label: 'To settle', count: problems.length, href: '/gaps/pages?show=unsettled' },
          { id: 'unchecked', label: 'Loaded, never checked', count: unchecked.length, href: '/gaps/pages?show=unchecked' },
        ]}
      />

      {active === 'unsettled' ? (
        <>
          <p className="max-w-prose text-sm text-muted">
            The printed page numbers could not be matched to the file&rsquo;s pages, so
            these books have pages loaded and nothing searchable yet. Set the offset on the
            edit page, or enter ranges for a book whose numbering breaks, then run
            offsets.py on the work again.
          </p>
          {problems.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="max-w-4xl divide-y divide-rule border-y border-rule">
              {problems.map((w) => (
                <li key={w.id} className="space-y-1 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="shrink-0">{w.author ?? '\u2014'}</span>
                    <Link href={`/works/${w.id}`} className="min-w-0 flex-1 italic hover:text-accent">
                      {w.title}
                    </Link>
                    <span className="font-mono text-xs text-muted">offset {w.page_offset}</span>
                    <Link href={`/works/${w.id}/edit`} className="text-xs text-muted hover:text-accent">
                      Edit
                    </Link>
                  </div>
                  <p className="text-xs text-accent">{w.offset_problem}</p>
                  <p className="font-mono text-xs text-muted">{w.id}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="max-w-prose text-sm text-muted">
            Pages are loaded but offsets.py has not compared their printed numbers with the
            file. Run it on each, and record the result with --apply; a study aid cannot be
            made until then.
          </p>
          {unchecked.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="max-w-4xl divide-y divide-rule border-y border-rule">
              {unchecked.map((w) => (
                <li key={w.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm">
                  <span className="shrink-0">{w.author ?? '\u2014'}</span>
                  <Link href={`/works/${w.id}`} className="min-w-0 flex-1 italic hover:text-accent">
                    {w.title}
                  </Link>
                  <span className="font-mono text-xs text-muted">offset {w.page_offset}</span>
                  <span className="font-mono text-xs text-muted">{w.id}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
