import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { getBook } from '@/lib/books';
import { formatBibliography } from '@/lib/citation';
import type { Book } from '@/lib/types';

export const dynamic = 'force-dynamic';

// A works cited from books ticked on the catalogue.
//
// Not CSV. A works cited is prose that goes into a chapter, and comma-delimited
// columns are the wrong shape for it. The CSV exports at /api/export are for
// data — backup, and anything that wants a spreadsheet.
//
// The selection arrives as repeated ?id= parameters because the form uses GET,
// which makes the result a URL she can bookmark, re-open, or send to her
// advisor without re-ticking eighty-five boxes.
export default async function WorksCitedPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  await requireAllowedUser();

  const { id } = await searchParams;
  const ids = id === undefined ? [] : Array.isArray(id) ? id : [id];

  const found = await Promise.all(ids.map((one) => getBook(one)));
  const books = found.filter((book): book is Book => book !== null);

  // Chicago orders a bibliography by author surname. The records already store
  // the inverted form, so a plain sort on the stored string is correct.
  books.sort((a, b) =>
    (a.author ?? a.editor ?? a.title).localeCompare(
      b.author ?? b.editor ?? b.title,
      'es',
    ),
  );

  const entries = books.map((book) => ({
    book,
    citation: formatBibliography(book),
  }));

  const incomplete = entries.filter((entry) => entry.citation.missing.length > 0);

  const plain = entries
    .map((entry) => entry.citation.text.replaceAll('*', ''))
    .join('\n\n');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl">Works cited</h1>
        <p className="text-sm text-muted">
          {books.length} {books.length === 1 ? 'entry' : 'entries'}, Chicago 17th
          edition, sorted by author.
        </p>
      </header>

      {books.length === 0 ? (
        <p className="text-sm">
          Nothing selected.{' '}
          <Link href="/books" className="text-accent underline underline-offset-2">
            Choose books on the catalogue
          </Link>{' '}
          and submit.
        </p>
      ) : (
        <>
          {incomplete.length > 0 ? (
            <div className="border-l-2 border-accent pl-3 text-sm">
              <p className="text-accent">
                {incomplete.length}{' '}
                {incomplete.length === 1 ? 'entry is' : 'entries are'} incomplete.
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {incomplete.map((entry) => (
                  <li key={entry.book.id}>
                    <Link
                      href={`/books/${entry.book.id}/edit`}
                      className="hover:text-accent"
                    >
                      {entry.book.title}
                    </Link>{' '}
                    — missing {entry.citation.missing.join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ol className="space-y-3 text-sm">
            {entries.map((entry) => (
              <li
                key={entry.book.id}
                className="border-l-2 border-rule pl-3 -indent-3 pl-6"
              >
                {entry.citation.text.replaceAll('*', '')}
              </li>
            ))}
          </ol>

          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted">
              Plain text — select all and copy
            </p>
            <textarea
              readOnly
              rows={Math.min(20, entries.length * 3 + 2)}
              value={plain}
              className="font-mono text-xs"
            />
          </div>
        </>
      )}
    </div>
  );
}
