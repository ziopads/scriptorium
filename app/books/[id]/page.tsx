import Link from 'next/link';
import { notFound } from 'next/navigation';

import { addNote, changeStatus } from '@/lib/actions';
import { NoteCard } from '@/components/note-card';
import { requireAllowedUser } from '@/lib/auth/guard';
import { getBook, listsForBook } from '@/lib/books';
import { formatBibliography, formatNote } from '@/lib/citation';
import { listNotesForBook } from '@/lib/notes';

const STATUSES = ['unread', 'reading', 'read'] as const;

const SOURCE_LABEL: Record<string, string> = {
  pdf_text: 'PDF with a text layer',
  pdf_ocr: 'scanned PDF, OCR applied',
  epub: 'EPUB — locatable, not citable',
  none: 'no file held',
};

function Field({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === '') return null;
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export const dynamic = 'force-dynamic';

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAllowedUser();

  const { id } = await params;

  const book = await getBook(id);
  if (!book) notFound();

  const [lists, notes] = await Promise.all([
    listsForBook(id),
    listNotesForBook(id),
  ]);

  const bibliography = formatBibliography(book);
  const note = formatNote(book, null);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl italic">{book.title}</h1>
        {book.subtitle ? (
          <p className="text-lg italic text-muted">{book.subtitle}</p>
        ) : null}
        <p className="text-sm text-muted">{book.author ?? book.editor ?? 'Author unknown'}</p>

        <div className="flex flex-wrap gap-3 pt-2 text-sm">
          {lists.map((l) => (
            <Link
              key={l.id}
              href={`/books?list=${l.id}`}
              className="text-accent hover:underline underline-offset-2"
            >
              {l.name}
            </Link>
          ))}
          <Link
            href={`/books/${book.id}/edit`}
            className="ml-auto text-muted hover:text-accent"
          >
            Edit
          </Link>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-base">Citation</h2>

        {bibliography.missing.length > 0 ? (
          <p className="text-xs text-accent">
            Incomplete — missing {bibliography.missing.join(', ')}. The forms below
            emit what is known and nothing more.
          </p>
        ) : null}

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted">Bibliography</p>
          <p className="border-l-2 border-rule pl-3 text-sm">{bibliography.text}</p>
        </div>

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted">Note</p>
          <p className="border-l-2 border-rule pl-3 text-sm">{note.text}</p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-base">Record</h2>
        <dl className="text-sm">
          <Field label="Translator" value={book.translator} />
          <Field label="Editor" value={book.author ? book.editor : null} />
          <Field label="Publisher" value={book.publisher} />
          <Field label="Place" value={book.place} />
          <Field label="Year" value={book.year} />
          <Field label="Edition" value={book.edition} />
          <Field label="Language" value={book.language} />
          <Field label="Source" value={SOURCE_LABEL[book.source_format]} />
          <Field
            label="Page offset"
            value={book.page_offset === 0 ? null : book.page_offset}
          />
          <Field label="Identifier" value={book.id} />
        </dl>

        {book.notes_internal ? (
          <p className="border-l-2 border-accent pl-3 text-sm text-muted">
            {book.notes_internal}
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-base">Reading</h2>
        <form action={changeStatus} className="flex items-center gap-2 text-sm">
          <input type="hidden" name="id" value={book.id} />
          <select name="status" defaultValue={book.status} className="w-40">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="submit" className="text-accent hover:underline underline-offset-2">
            Save
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-base">Notes</h2>

        {notes.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {notes.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </ul>
        )}

        <form action={addNote} className="space-y-3 border-t border-rule pt-4">
          <input type="hidden" name="book_id" value={book.id} />

          <label className="block space-y-1">
            <span className="text-sm">Note</span>
            <textarea name="body" rows={4} required />
          </label>

          <label className="block space-y-1">
            <span className="text-sm">Quotation</span>
            <textarea name="quote" rows={2} />
            <span className="block text-xs text-muted">
              Verbatim. This is what re-locates the note if the book is extracted
              later, so type it as printed.
            </span>
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="w-28 space-y-1">
              <span className="text-sm">Page</span>
              <input type="number" name="printed_page" />
            </label>

            <label className="min-w-56 flex-1 space-y-1">
              <span className="text-sm">Tags</span>
              <input type="text" name="tags" placeholder="comma, separated" />
            </label>

            <button
              type="submit"
              className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
            >
              Add note
            </button>
          </div>

          <p className="text-xs text-muted">
            The page is the printed folio, not the file page.
          </p>
        </form>
      </section>
    </div>
  );
}
