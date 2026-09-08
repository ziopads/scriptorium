import Link from 'next/link';

import { editNote, removeNote } from '@/lib/actions';
import { listRevisions } from '@/lib/notes';
import type { Note, NoteWithBook } from '@/lib/types';

// Dates are shown as a plain ISO day. A relative form ("3 days ago") reads
// nicely and is useless in a citation, which is the thing these notes are
// eventually for.
function day(value: string): string {
  return value.slice(0, 10);
}

// One note, used on the book page and on /notes.
//
// Editing is a <details> holding a form rather than a modal or an edit route.
// That keeps the whole mutation path free of client JavaScript — the disclosure
// triangle is HTML, and the form posts to a Server Action. It also means she can
// open several at once, which is what happens when the job is tagging a run of
// notes written without tags.

function isWithBook(note: Note | NoteWithBook): note is NoteWithBook {
  return 'book_title' in note;
}

export async function NoteCard({
  note,
  showBook = false,
}: {
  note: Note | NoteWithBook;
  showBook?: boolean;
}) {
  const revisions = await listRevisions(note.id);

  return (
    <li className="py-4 space-y-1 text-sm">
      {showBook && isWithBook(note) ? (
        <Link
          href={`/books/${note.book_id}`}
          className="block text-xs text-muted hover:text-accent"
        >
          {note.book_author ?? '—'},{' '}
          <span className="italic">{note.book_title}</span>
          {note.printed_page !== null ? `, ${note.printed_page}` : null}
        </Link>
      ) : null}

      {note.quote ? (
        <blockquote className="border-l-2 border-rule pl-3 italic">
          {note.quote}
        </blockquote>
      ) : null}

      <p className="whitespace-pre-wrap">{note.body}</p>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
        {!showBook ? (
          <span>
            {note.printed_page !== null ? `p. ${note.printed_page}` : 'no page'}
          </span>
        ) : null}

        {note.tags.map((tag) => (
          <Link
            key={tag}
            href={`/notes?tag=${encodeURIComponent(tag)}`}
            className="hover:text-accent"
          >
            #{tag}
          </Link>
        ))}

        {note.tags.length === 0 ? <span className="italic">untagged</span> : null}

        {note.origin === 'assistant' ? (
          <span className={note.reviewed ? '' : 'text-accent'}>
            {note.reviewed
              ? 'assistant draft, reviewed'
              : 'assistant draft, unreviewed'}
          </span>
        ) : null}

        <span className="ml-auto">
          {day(note.created_at)}
          {revisions.length > 0 ? (
            <>
              {' · edited '}
              {day(note.updated_at)}
              {revisions.length > 1 ? ` (${revisions.length} revisions)` : null}
            </>
          ) : null}
        </span>
      </div>

      <details className="pt-1">
        <summary className="cursor-pointer text-xs text-muted hover:text-accent">
          Edit
        </summary>

        <form action={editNote} className="mt-3 space-y-3 border-l-2 border-rule pl-3">
          <input type="hidden" name="id" value={note.id} />
          <input type="hidden" name="book_id" value={note.book_id} />

          <label className="block space-y-1">
            <span className="text-xs text-muted">Note</span>
            <textarea name="body" rows={4} defaultValue={note.body} required />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted">Quotation</span>
            <textarea name="quote" rows={2} defaultValue={note.quote ?? ''} />
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="w-24 space-y-1">
              <span className="text-xs text-muted">Page</span>
              <input
                type="number"
                name="printed_page"
                defaultValue={note.printed_page ?? ''}
              />
            </label>

            <label className="min-w-48 flex-1 space-y-1">
              <span className="text-xs text-muted">Tags</span>
              <input
                type="text"
                name="tags"
                defaultValue={note.tags.join(', ')}
                placeholder="comma, separated"
              />
            </label>

            <button
              type="submit"
              className="border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent hover:text-background"
            >
              Save
            </button>
          </div>
        </form>

        {/* Deletion is its own form. Nesting it inside the edit form would make
            one button submit the other's fields. */}
        <form action={removeNote} className="mt-2 border-l-2 border-rule pl-3">
          <input type="hidden" name="id" value={note.id} />
          <input type="hidden" name="book_id" value={note.book_id} />
          <button type="submit" className="text-xs text-muted hover:text-accent">
            Delete this note
          </button>
        </form>

        {revisions.length > 0 ? (
          <div className="mt-4 border-l-2 border-rule pl-3">
            <p className="text-xs uppercase tracking-wide text-muted">
              Earlier versions
            </p>
            <ol className="mt-2 space-y-3">
              {revisions.map((revision) => (
                <li key={revision.id} className="space-y-1">
                  <p className="text-xs text-muted">
                    written {day(revision.written_at)}, replaced{' '}
                    {day(revision.superseded_at)}
                    {revision.origin === 'assistant'
                      ? revision.reviewed
                        ? ' · assistant draft, reviewed'
                        : ' · assistant draft, unreviewed'
                      : null}
                  </p>
                  <p className="whitespace-pre-wrap text-xs text-muted">
                    {revision.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </details>
    </li>
  );
}
