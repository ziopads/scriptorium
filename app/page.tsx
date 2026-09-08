import Link from 'next/link';

import {
  booksWithoutSource,
  incompleteBooks,
  listExamListsWithCounts,
} from '@/lib/books';

export default async function HomePage() {
  const [lists, incomplete, unsourced] = await Promise.all([
    listExamListsWithCounts(),
    incompleteBooks(),
    booksWithoutSource(),
  ]);

  const total = lists.reduce((sum, list) => sum + list.count, 0);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl mb-1">Reading list</h1>
        <p className="text-sm text-muted">
          {total} entries across {lists.length} lists.
        </p>
      </section>

      <section>
        <ul className="divide-y divide-rule border-y border-rule">
          {lists.map((list) => (
            <li key={list.id}>
              <Link
                href={`/books?list=${list.id}`}
                className="flex items-baseline justify-between py-3 hover:text-accent"
              >
                <span>
                  {list.name}
                  {list.description ? (
                    <span className="text-muted text-sm"> — {list.description}</span>
                  ) : null}
                </span>
                <span className="font-mono text-sm text-muted">{list.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-base">What still needs attention</h2>
        <p>
          <Link href="/gaps" className="text-accent underline underline-offset-2">
            {incomplete.length} records
          </Link>{' '}
          are missing a field a Chicago entry needs.
        </p>
        <p className="text-muted">
          {unsourced.length} have no file yet, so nothing can be extracted from them.
        </p>
      </section>
    </div>
  );
}
