import Link from 'next/link';

import { CatalogueTable, type Row } from '@/components/catalogue-table';
import { requireAllowedUser } from '@/lib/auth/guard';
import { listBooks, listBooksInList, listExamLists } from '@/lib/books';
import { formatBibliography } from '@/lib/citation';
import { PURPOSE_LABEL, type Purpose } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PURPOSE_FILTERS: Purpose[] = ['comps', 'both', 'dissertation', 'unassigned'];

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; source?: string; purpose?: string }>;
}) {
  await requireAllowedUser();

  const { list, source, purpose } = await searchParams;

  const [lists, all] = await Promise.all([
    listExamLists(),
    list ? listBooksInList(list) : listBooks(),
  ]);

  const filtered = all
    .filter((b) =>
      source === 'missing'
        ? b.source_format === 'none'
        : source === 'held'
          ? b.source_format !== 'none'
          : true,
    )
    .filter((b) => (purpose ? b.purpose === purpose : true));

  const missingCount = all.filter((b) => b.source_format === 'none').length;
  const active = lists.find((l) => l.id === list);

  const rows: Row[] = filtered.map((book) => ({
    id: book.id,
    author: book.author ?? book.editor,
    title: book.title,
    year: book.year,
    status: book.status,
    purpose: book.purpose,
    standing: book.standing,
    has_file: book.source_format !== 'none',
    missing: formatBibliography(book).missing,
  }));

  const query = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { list, source, purpose, ...extra };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const string = params.toString();
    return string ? `/books?${string}` : '/books';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl mb-1">{active ? active.name : 'Catalogue'}</h1>
        <p className="text-sm text-muted">
          {rows.length} of {all.length} · {all.length - missingCount} with a file
        </p>
      </div>

      <nav className="flex flex-wrap items-baseline gap-3 text-sm">
        <Link
          href={query({ list: undefined })}
          className={list ? 'text-muted hover:text-accent' : 'text-accent'}
        >
          All lists
        </Link>
        {lists.map((l) => (
          <Link
            key={l.id}
            href={query({ list: l.id })}
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

      <nav className="flex flex-wrap gap-3 text-xs">
        <Link
          href={query({ purpose: undefined, source: undefined })}
          className={!purpose && !source ? 'text-accent' : 'text-muted hover:text-accent'}
        >
          Any
        </Link>

        {PURPOSE_FILTERS.map((p) => (
          <Link
            key={p}
            href={query({ purpose: p })}
            className={p === purpose ? 'text-accent' : 'text-muted hover:text-accent'}
          >
            {PURPOSE_LABEL[p]}
          </Link>
        ))}

        <Link
          href={query({ source: 'held' })}
          className={source === 'held' ? 'text-accent' : 'text-muted hover:text-accent'}
        >
          File held
        </Link>
        <Link
          href={query({ source: 'missing' })}
          className={
            source === 'missing' ? 'text-accent' : 'text-muted hover:text-accent'
          }
        >
          No file yet ({missingCount})
        </Link>
      </nav>

      <CatalogueTable rows={rows} />
    </div>
  );
}
