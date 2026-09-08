import Link from 'next/link';

import { listBooks, listBooksInList, listExamLists } from '@/lib/books';
import { formatBibliography } from '@/lib/citation';

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
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

      <nav className="flex flex-wrap gap-3 text-sm">
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
      </nav>

      <ul className="divide-y divide-rule border-y border-rule">
        {books.map((book) => {
          const citation = formatBibliography(book);
          return (
            <li key={book.id} className="py-3">
              <div className="flex items-baseline justify-between gap-4">
                <Link href={`/books/${book.id}`} className="hover:text-accent">
                  {book.author ?? book.editor ?? '—'}
                  {'. '}
                  <span className="italic">{book.title}</span>
                  {book.year ? <span className="text-muted"> ({book.year})</span> : null}
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
