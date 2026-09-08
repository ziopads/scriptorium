import { getAllowedUser } from '@/lib/auth/guard';
import { listBooks } from '@/lib/books';
import { formatNote } from '@/lib/citation';
import { csvResponse, toCsv } from '@/lib/csv';
import { listAllNotes } from '@/lib/notes';

export const dynamic = 'force-dynamic';

// Every note with its citation already formatted, so a row can be pasted into a
// draft without going back to the catalogue.
//
// origin and reviewed are columns rather than a footnote. An export that does
// not say which sentences she wrote is worse than no export, because the
// ambiguity travels with the file (N-6).
export async function GET() {
  const user = await getAllowedUser();
  if (!user) {
    return new Response('Not authorized', { status: 401 });
  }

  const [notes, books] = await Promise.all([listAllNotes(), listBooks()]);
  const byId = new Map(books.map((book) => [book.id, book]));

  const rows = notes.map((note) => {
    const book = byId.get(note.book_id);

    return {
      ...note,
      citation: book
        ? formatNote(book, note.printed_page).text.replaceAll('*', '')
        : '',
      provenance:
        note.origin === 'human'
          ? 'written by hand'
          : note.reviewed
            ? 'assistant draft, reviewed'
            : 'assistant draft, UNREVIEWED',
    };
  });

  const columns = [
    'id',
    'book_id',
    'book_author',
    'book_title',
    'printed_page',
    'quote',
    'body',
    'tags',
    'citation',
    'provenance',
    'created_at',
    'updated_at',
  ];

  return csvResponse('scriptorium-notes', toCsv(columns, rows));
}
