import Link from 'next/link';

import { NoteCard } from '@/components/note-card';
import { requireAllowedUser } from '@/lib/auth/guard';
import {
  allTags,
  listAllNotes,
  listNotesByTag,
  listUnreviewedNotes,
  searchNotes,
} from '@/lib/notes';

export const dynamic = 'force-dynamic';

// Notes across the whole corpus. This never touches chunks — it is the
// September half of retrieval, and it works with no books extracted at all.
export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; q?: string; filter?: string }>;
}) {
  await requireAllowedUser();

  const { tag, q, filter } = await searchParams;

  const notes =
    filter === 'unreviewed'
      ? await listUnreviewedNotes()
      : filter === 'untagged'
        ? (await listAllNotes()).filter((n) => n.tags.length === 0)
        : tag
          ? await listNotesByTag(tag)
          : q
            ? await searchNotes(q)
            : await listAllNotes();

  const tags = await allTags();

  const heading = tag ? `#${tag}` : q ? `Search: ${q}` : filter ? filter : 'Notes';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl mb-1">{heading}</h1>
        <p className="text-sm text-muted">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
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
        <a
          href="/api/export/notes"
          className="ml-auto self-center text-xs text-muted hover:text-accent"
        >
          Download CSV
        </a>
      </form>

      <nav className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        <Link
          href="/notes"
          className={!tag && !q && !filter ? 'text-accent' : 'text-muted hover:text-accent'}
        >
          All
        </Link>

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
          href="/notes?filter=untagged"
          className={
            filter === 'untagged' ? 'text-accent' : 'text-muted hover:text-accent'
          }
        >
          untagged
        </Link>

        <Link
          href="/notes?filter=unreviewed"
          className={
            filter === 'unreviewed' ? 'text-accent' : 'text-muted hover:text-accent'
          }
        >
          unreviewed
        </Link>
      </nav>

      {notes.length === 0 ? (
        <p className="text-sm text-muted">Nothing here yet.</p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} showBook />
          ))}
        </ul>
      )}
    </div>
  );
}
