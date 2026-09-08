import Link from 'next/link';

import { saveImprint } from '@/lib/actions';
import { requireAllowedUser } from '@/lib/auth/guard';
import { incompleteBooks } from '@/lib/books';

export const dynamic = 'force-dynamic';

// One row per incomplete record, each its own form, so a save writes one book
// and leaves the page where it was. The point of this screen is working down a
// list of twenty without navigating away from it.
export default async function GapsPage() {
  await requireAllowedUser();

  const entries = await incompleteBooks();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl">Gaps</h1>
        <p className="text-sm text-muted">
          {entries.length} records missing a field a Chicago entry needs. The
          reading list did not supply these; nothing here was inferred.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm">Nothing outstanding.</p>
      ) : (
        <ul className="space-y-6">
          {entries.map(({ book, missing }) => (
            <li key={book.id} className="border-b border-rule pb-6">
              <div className="mb-2 flex items-baseline justify-between gap-4">
                <Link href={`/books/${book.id}`} className="italic hover:text-accent">
                  {book.title}
                </Link>
                <span className="shrink-0 text-xs text-accent">
                  missing {missing.join(', ')}
                </span>
              </div>

              {book.notes_internal ? (
                <p className="mb-3 text-xs text-muted">{book.notes_internal}</p>
              ) : null}

              <form action={saveImprint} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={book.id} />

                <label className="min-w-56 flex-1 space-y-1">
                  <span className="text-xs text-muted">Author</span>
                  <input type="text" name="author" defaultValue={book.author ?? ''} />
                </label>

                <label className="min-w-56 flex-1 space-y-1">
                  <span className="text-xs text-muted">Publisher</span>
                  <input type="text" name="publisher" defaultValue={book.publisher ?? ''} />
                </label>

                <label className="w-40 space-y-1">
                  <span className="text-xs text-muted">Place</span>
                  <input type="text" name="place" defaultValue={book.place ?? ''} />
                </label>

                <label className="w-24 space-y-1">
                  <span className="text-xs text-muted">Year</span>
                  <input type="number" name="year" defaultValue={book.year ?? ''} />
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
