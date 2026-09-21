import Link from 'next/link';

import { saveImprint } from '@/lib/actions';
import { requireAllowedUser } from '@/lib/auth/guard';
import { incompleteWorks } from '@/lib/works';

export const dynamic = 'force-dynamic';

// The Gaps page's Citations tab: records missing a field a citation needs.
// One row per record, each its own form, so a save writes one work and leaves
// the page where it was: the point is working down a list without navigating
// away from it.
//
// ISBN is on the form though no citation style prints it: it names the
// edition, and edition decides pagination. pipeline/isbns.py and enrich.py
// propose ISBNs and imprints in bulk; this form is for the ones done by hand.

export default async function GapsCitationsPage() {
  await requireAllowedUser();
  const entries = await incompleteWorks();

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-sm text-muted">
        {entries.length} records missing a field a citation needs. The reading list did
        not supply these; nothing here was inferred. An essay is judged against its
        container&rsquo;s imprint, so filling in the volume fixes every essay inside it.
      </p>

      {entries.length === 0 ? (
        <p className="text-sm">Nothing outstanding.</p>
      ) : (
        <ul className="space-y-6">
          {entries.map(({ work, missing }) => (
            <li key={work.id} className="border-b border-rule pb-6">
              <div className="mb-2 flex items-baseline justify-between gap-4">
                <Link href={`/works/${work.id}`} className="italic hover:text-accent">
                  {work.title}
                </Link>
                <span className="shrink-0 text-xs text-accent">
                  missing {missing.join(', ')}
                </span>
              </div>

              {work.container_id ? (
                <p className="mb-2 text-xs text-muted">
                  Essay in{' '}
                  <Link href={`/works/${work.container_id}`} className="hover:text-accent">
                    {work.container_id}
                  </Link>{' '}
                  — fix the volume, not this row.
                </p>
              ) : null}

              {work.notes_internal ? (
                <p className="mb-3 text-xs text-muted">{work.notes_internal}</p>
              ) : null}

              <form action={saveImprint} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={work.id} />

                <label className="min-w-56 flex-1 space-y-1">
                  <span className="text-xs text-muted">Author</span>
                  <input type="text" name="author" defaultValue={work.author ?? ''} />
                </label>

                <label className="min-w-56 flex-1 space-y-1">
                  <span className="text-xs text-muted">Publisher</span>
                  <input type="text" name="publisher" defaultValue={work.publisher ?? ''} />
                </label>

                <label className="w-40 space-y-1">
                  <span className="text-xs text-muted">Place</span>
                  <input type="text" name="place" defaultValue={work.place ?? ''} />
                </label>

                <label className="w-24 space-y-1">
                  <span className="text-xs text-muted">Year</span>
                  <input type="number" name="year" defaultValue={work.year ?? ''} />
                </label>

                <label className="w-44 space-y-1">
                  <span className="text-xs text-muted">ISBN</span>
                  <input type="text" name="isbn" defaultValue={work.isbn ?? ''} />
                </label>

                <button
                  type="submit"
                  className="border border-accent px-3 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
                >
                  Save
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
