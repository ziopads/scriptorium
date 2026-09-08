import { getAllowedUser } from '@/lib/auth/guard';
import { allListMemberships, listBooks } from '@/lib/books';
import { formatBibliography } from '@/lib/citation';
import { csvResponse, toCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';

// Every book, every column, plus the formatted Chicago entry and its list
// memberships. This is the backup: if this application disappeared tomorrow,
// this file and the notes export are the work.
//
// getAllowedUser rather than requireAllowedUser, because requireAllowedUser
// redirects — and a download endpoint answering with a redirect to a sign-in
// page saves a file full of HTML instead of reporting an error.
export async function GET() {
  const user = await getAllowedUser();
  if (!user) {
    return new Response('Not authorized', { status: 401 });
  }

  const [books, memberships] = await Promise.all([
    listBooks(),
    allListMemberships(),
  ]);

  const byBook = new Map<string, typeof memberships>();
  for (const m of memberships) {
    const existing = byBook.get(m.book_id);
    if (existing) existing.push(m);
    else byBook.set(m.book_id, [m]);
  }

  const rows = books.map((book) => {
    const lists = byBook.get(book.id) ?? [];
    const citation = formatBibliography(book);

    return {
      ...book,
      lists: lists.map((l) => l.name),
      list_rationales: lists
        .filter((l) => l.rationale)
        .map((l) => `${l.name}: ${l.rationale}`),
      chicago_bibliography: citation.text.replaceAll('*', ''),
      missing_fields: citation.missing,
    };
  });

  const columns = [
    'id',
    'author',
    'title',
    'subtitle',
    'translator',
    'editor',
    'publisher',
    'place',
    'year',
    'edition',
    'language',
    'lists',
    'list_rationales',
    'status',
    'source_format',
    'page_offset',
    'chicago_bibliography',
    'missing_fields',
    'notes_internal',
    'updated_at',
  ];

  return csvResponse('scriptorium-books', toCsv(columns, rows));
}
