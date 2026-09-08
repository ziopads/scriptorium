import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { listBooks, listBooksInList, listExamLists } from '@/lib/books';
import { formatBibliography } from '@/lib/citation';

export const dynamic = 'force-dynamic';

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  await requireAllowedUser();

  const { list } = await searchParams;

  const [lists, books] = await Promise.all([
    listExamLists(),
    list ? listBooksInList(list) : listBooks(),
  ]);

  const active = lists.find((l) => l.id === list);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl mb-1">{active ? active.name : 'Catalogue'}</h1>
        <p className="text-sm text-muted">{books.length} entries</p>
      </div>

      <nav className="flex flex-wrap items-baseline gap-3 text-sm">
        <Link
          href="/books"
          className={list ? 'text-muted hover:text-accent' : 'text-accent'}
        >
          All
        </Link>
        {lists.map((l) => (
          <Link
            key={l.id}
            href={`/books?list=${l.id}`}
            className={l.id === list ? 'text-accent' : 'text-muted hover:text-accent'}
          >
            {l.name}
          </Link>
        ))}

        <a
          href="/api/export/books"
          className="ml-auto text-xs text-muted hover:text-accent"
        >
          Download CSV
        </a>
      </nav>

      {/* GET rather than a Server Action, so the selection ends up in the URL
          and the resulting works cited can be bookmarked or re-opened without
          ticking eighty-five boxes again. */}
      <form action="/works-cited" className="space-y-4">
        <ul className="divide-y divide-rule border-y border-rule">
          {books.map((book) => {
            const citation = formatBibliography(book);
            return (
              <li key={book.id} className="py-3">
                <div className="flex items-baseline gap-3">
                  <input
                    type="checkbox"
                    name="id"
                    value={book.id}
                    id={`pick-${book.id}`}
                    className="mt-1 w-auto shrink-0"
                  />

                  <div className="flex-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <Link href={`/books/${book.id}`} className="hover:text-accent">
                        {book.author ?? book.editor ?? '—'}
                        {'. '}
                        <span className="italic">{book.title}</span>
                        {book.year ? (
                          <span className="text-muted"> ({book.year})</span>
                        ) : null}
                      </Link>
                      <span className="shrink-0 font-mono text-xs text-muted">
                        {book.status}
                      </span>
                    </div>

                    {citation.missing.length > 0 ? (
                      <p className="mt-1 text-xs text-accent">
                        missing: {citation.missing.join(', ')}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex items-baseline gap-4">
          <button
            type="submit"
            className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
          >
            Works cited from selection
          </button>
          <span className="text-xs text-muted">
            Chicago 17th, sorted by author, with incomplete records flagged.
          </span>
        </div>
      </form>
    </div>
  );
}
