import Link from 'next/link';

import { FilterChips } from '@/components/filter-chips';
import { setPagination } from '@/lib/actions';
import { requireAllowedUser } from '@/lib/auth/guard';
import { uncheckedOffsets } from '@/lib/gaps';
import { worksWithOffsetProblems } from '@/lib/works';

export const dynamic = 'force-dynamic';

// The Gaps page's Page numbers tab, one list at a time (?show=):
//
// Two kinds of unsettled numbering, because they are fixed differently.
//
// Ranges: the folios are legible and consistent, but the book carries more
// than one numbering sequence — an unnumbered plate section, front matter
// running into the body. One page_offset cannot describe it; page_offsets
// rows can (migration 008). The book itself is sound.
//
// No usable numbers: fewer than eight consistent folios in the whole file.
// Two very different files land here, and only the folio count separates
// them. Zero folios read means the file prints no page numbers anywhere —
// a converter's output, or a scan of an unnumbered edition. A few that
// disagree means the numbers are there and unreadable, which is usually a
// bad scan and a reason to find another copy.
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
    show === 'ranges' || show === 'numbers' || show === 'accepted' || show === 'unchecked'
      ? show
      : show === 'unsettled'
        ? 'ranges'
        : problems.length > 0 ? 'ranges' : 'unchecked';

  // The two kinds are told apart by the flag offsets.py wrote: a book with
  // more than one numbering sequence names them, anything else could not read
  // enough folios to judge. Accepted works (migration 016) leave both lists
  // and get their own, because the decision has been made and the book is
  // searchable; they stay visible because every page they yield is unverified.
  const isRanges = (problem: string) =>
    /numbering sequences|page_offsets ranges disagree/.test(problem);
  const open = problems.filter((w) => w.pagination_accepted_at === null);
  const accepted = problems.filter((w) => w.pagination_accepted_at !== null);
  const needsRanges = open.filter((w) => isRanges(w.offset_problem));
  const noNumbers = open.filter((w) => !isRanges(w.offset_problem));
  const listed =
    active === 'ranges' ? needsRanges
    : active === 'numbers' ? noNumbers
    : active === 'accepted' ? accepted
    : [];

  return (
    <div className="space-y-5">
      <FilterChips
        label="Page numbering"
        active={active}
        chips={[
          { id: 'ranges', label: 'Ranges needed', count: needsRanges.length, href: '/gaps/pages?show=ranges' },
          { id: 'numbers', label: 'No usable numbers', count: noNumbers.length, href: '/gaps/pages?show=numbers' },
          { id: 'accepted', label: 'Accepted as they are', count: accepted.length, href: '/gaps/pages?show=accepted' },
          { id: 'unchecked', label: 'Loaded, never checked', count: unchecked.length, href: '/gaps/pages?show=unchecked' },
        ]}
      />

      {active !== 'unchecked' ? (
        <>
          <p className="max-w-prose text-sm text-muted">
            {active === 'ranges'
              ? 'The folios are legible, but the book carries more than one numbering sequence, so no single offset describes it. Enter ranges in page_offsets, then run offsets.py on the work again to clear it.'
              : active === 'accepted'
                ? 'These files were accepted as they stand: the numbering is still unsettled, and the pipeline no longer holds the text back. Every page number the app shows for them is marked unverified, and a page cited from one has to be checked against the PDF.'
                : 'Too few legible folios to settle the numbering. Read the folio count below: none at all means the file prints no page numbers anywhere, which is a decision about how to cite it; a few that disagree usually means a bad scan and a better copy is worth finding.'}
          </p>
          {listed.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="max-w-4xl divide-y divide-rule border-y border-rule">
              {listed.map((w) => (
                <li
                  key={w.id}
                  className={`space-y-1 py-2 text-sm${
                    w.pagination_accepted_at ? ' border-l-2 border-accent pl-3 opacity-80' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="shrink-0">{w.author ?? '\u2014'}</span>
                    <Link href={`/works/${w.id}`} className="min-w-0 flex-1 italic hover:text-accent">
                      {w.title}
                    </Link>
                    {w.pagination_accepted_at ? (
                      <span className="shrink-0 text-xs text-accent">pages unverified</span>
                    ) : null}
                    <span className="font-mono text-xs text-muted">offset {w.page_offset}</span>
                    <Link href={`/works/${w.id}/edit`} className="text-xs text-muted hover:text-accent">
                      Edit
                    </Link>
                    <form action={setPagination}>
                      <input type="hidden" name="id" value={w.id} />
                      <input
                        type="hidden"
                        name="accepted"
                        value={w.pagination_accepted_at ? 'no' : 'yes'}
                      />
                      <button type="submit" className="text-xs text-muted hover:text-accent">
                        {w.pagination_accepted_at ? 'Withdraw' : 'Accept as is'}
                      </button>
                    </form>
                  </div>
                  <p className="text-xs text-muted">
                    {w.folios === 0
                      ? `no page numbers read in ${w.pages} pages`
                      : `${w.folios} page numbers read in ${w.pages} pages`}
                    {w.source_format && w.source_format !== 'none' ? ` \u00b7 ${w.source_format}` : ''}
                  </p>
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
