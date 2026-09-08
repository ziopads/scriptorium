import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { allTags, listNotesByTag, listUnreviewedNotes, searchNotes } from '@/lib/notes';
import type { NoteWithBook } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Notes across the whole corpus, filtered by tag or by a substring of her own
// writing. This never touches chunks — it is the September half of retrieval,
// and it works with no books extracted at all.
export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; q?: string; unreviewed?: string }>;
}) {
  await requireAllowedUser();

  const { tag, q, unreviewed } = await searchParams;

  let notes: NoteWithBook[] = [];
  if (unreviewed) {
    notes = await listUnreviewedNotes();
  } else if (tag) {
    notes = await listNotesByTag(tag);
  } else if (q) {
    notes = await searchNotes(q);
  }

  const tags = await allTags();

  const heading = unreviewed
    ? 'Unreviewed'
    : tag
      ? `#${tag}`
      : q
        ? `“${q}”`
        : 'Notes';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl mb-1">{heading}</h1>
        <p className="text-sm text-muted">
          {tag || q || unreviewed
            ? `${notes.length} notes`
            : 'Choose a tag, or search your own writing.'}
        </p>
      </div>

      <form action="/notes" className="flex gap-3">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search notes and quotations"
          className="max-w-md"
        />
        <button
          type="submit"
          className="shrink-0 border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
        >
          Search
        </button>
      </form>

      {tags.length > 0 ? (
        <nav className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {tags.map((t) => (
            <Link
              key={t.tag}
              href={`/notes?tag=${encodeURIComponent(t.tag)}`}
              className={t.tag === tag ? 'text-accent' : 'text-muted hover:text-accent'}
            >
              #{t.tag}
              <span className="ml-1 font-mono text-xs">{t.count}</span>
            </Link>
          ))}
          <Link
            href="/notes?unreviewed=1"
            className={unreviewed ? 'text-accent' : 'text-muted hover:text-accent'}
          >
            unreviewed
          </Link>
        </nav>
      ) : null}

      {notes.length > 0 ? (
        <ul className="divide-y divide-rule border-y border-rule">
          {notes.map((n) => (
            <li key={n.id} className="py-4 space-y-1 text-sm">
              <Link
                href={`/books/${n.book_id}`}
                className="text-xs text-muted hover:text-accent"
              >
                {n.book_author ?? '—'}, <span className="italic">{n.book_title}</span>
                {n.printed_page !== null ? `, ${n.printed_page}` : null}
              </Link>

              {n.quote ? (
                <blockquote className="border-l-2 border-rule pl-3 italic">
                  {n.quote}
                </blockquote>
              ) : null}

              <p className="whitespace-pre-wrap">{n.body}</p>

              <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                {n.tags.map((t) => (
                  <Link
                    key={t}
                    href={`/notes?tag=${encodeURIComponent(t)}`}
                    className="hover:text-accent"
                  >
                    #{t}
                  </Link>
                ))}
                {n.origin === 'assistant' ? (
                  <span className={n.reviewed ? '' : 'text-accent'}>
                    {n.reviewed
                      ? 'assistant draft, reviewed'
                      : 'assistant draft, unreviewed'}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
