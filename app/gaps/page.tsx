import Link from 'next/link';

import { saveImprint } from '@/lib/actions';
import { requireAllowedUser } from '@/lib/auth/guard';
import {
  incompleteWorks,
  worksWithOffsetProblems,
  worksWithoutPdf,
} from '@/lib/works';

export const dynamic = 'force-dynamic';

function NoPdf({
  works,
  heading,
  blurb,
}: {
  works: Awaited<ReturnType<typeof worksWithoutPdf>>['none'];
  heading: string;
  blurb: string;
}) {
  if (works.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-lg">
        {heading} <span className="text-sm text-muted">({works.length})</span>
      </h2>
      <p className="text-sm text-muted">{blurb}</p>
      <ul className="divide-y divide-rule border-y border-rule">
        {works.map((w) => (
          <li key={w.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm">
            <span className="w-20 shrink-0 font-mono text-xs text-muted">{w.code}</span>
            <span className="shrink-0">{w.author ?? '\u2014'}</span>
            <Link href={`/works/${w.id}`} className="min-w-0 flex-1 italic hover:text-accent">
              {w.title}
            </Link>
            {w.year ? <span className="text-xs text-muted">{w.year}</span> : null}
            {w.pdf_verdict ? (
              <span className="text-xs text-accent">{w.pdf_verdict}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Works held back from sections, chunks and embeddings because their page
// numbering is unsettled. Fixing one is an offset on its edit page, or ranges
// in page_offsets for a book with an unnumbered insert; then offsets.py is run
// on it again, which clears it from this list.
function OffsetProblems({
  works,
}: {
  works: Awaited<ReturnType<typeof worksWithOffsetProblems>>;
}) {
  if (works.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-lg">
        Page numbering to settle <span className="text-sm text-muted">({works.length})</span>
      </h2>
      <p className="text-sm text-muted">
        The printed page numbers could not be matched to the file&rsquo;s pages, so
        these books have pages loaded and nothing searchable yet. Set the offset on the
        edit page, or enter ranges for a book whose numbering breaks, then run
        offsets.py on the work again.
      </p>
      <ul className="divide-y divide-rule border-y border-rule">
        {works.map((w) => (
          <li key={w.id} className="space-y-1 py-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="shrink-0">{w.author ?? '\u2014'}</span>
              <Link href={`/works/${w.id}`} className="min-w-0 flex-1 italic hover:text-accent">
                {w.title}
              </Link>
              <span className="font-mono text-xs text-muted">offset {w.page_offset}</span>
              <Link
                href={`/works/${w.id}/edit`}
                className="text-xs text-muted hover:text-accent"
              >
                Edit
              </Link>
            </div>
            <p className="text-xs text-accent">{w.offset_problem}</p>
            <p className="font-mono text-xs text-muted">{w.id}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// One row per incomplete record, each its own form, so a save writes one work
// and leaves the page where it was. The point of this screen is working down a
// list without navigating away from it.
export default async function GapsPage() {
  await requireAllowedUser();

  const [entries, pdfs, offsets] = await Promise.all([
    incompleteWorks(),
    worksWithoutPdf(),
    worksWithOffsetProblems(),
  ]);

  return (
    <div className="space-y-8">
      <OffsetProblems works={offsets} />

      <NoPdf
        works={pdfs.none}
        heading="No copy yet"
        blurb="On an examination list, and nobody has found a PDF. This is the list to
               go shopping from — a library, an interlibrary loan, a bookshop."
      />

      <NoPdf
        works={pdfs.queued}
        heading="Waiting on OCR"
        blurb="A copy exists but its text cannot be read yet: either no text layer at
               all, or recognition poor enough that the words are not the book's.
               Being worked on; nothing to do here."
      />

      <NoPdf
        works={pdfs.unknown}
        heading="Not yet looked at"
        blurb="Nobody has said whether a copy exists. Not the same as having looked
               and found nothing."
      />

      <header className="space-y-1 pt-2">
        <h1 className="text-2xl">Gaps</h1>
        <p className="text-sm text-muted">
          {entries.length} records missing a field a citation needs. The reading list did
          not supply these; nothing here was inferred. An essay is judged against its
          container&rsquo;s imprint, so filling in the volume fixes every essay inside it.
        </p>
      </header>

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
