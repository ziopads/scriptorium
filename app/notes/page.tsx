import Link from 'next/link';

import { NoteCard } from '@/components/note-card';
import { requireAllowedUser } from '@/lib/auth/guard';
import { day as localDay, readableDay } from '@/lib/dates';
import {
  allTags,
  listAllNotes,
  listConnections,
  listNotesByTag,
  listOpenQuestions,
  listRejectedNotes,
  listUnattributedNotes,
  listUnreviewedNotes,
  listUnsupportedClaims,
  searchNotes,
} from '@/lib/notes';
import type { NoteWithRelations } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; q?: string; filter?: string; day?: string }>;
}) {
  await requireAllowedUser();

  const { tag, q, filter, day } = await searchParams;

  const everything = await listAllNotes();

  const notes: NoteWithRelations[] =
    filter === 'proposals'
      ? await listUnreviewedNotes()
      : filter === 'rejected'
        ? await listRejectedNotes()
        : filter === 'unclassified'
          ? await listUnattributedNotes()
          : filter === 'unsupported'
            ? await listUnsupportedClaims()
            : filter === 'questions'
              ? await listOpenQuestions()
              : filter === 'connections'
                ? await listConnections()
                : filter === 'untagged'
                  ? everything.filter((n) => n.tags.length === 0)
                  : tag
                    ? await listNotesByTag(tag)
                    : q
                      ? await searchNotes(q)
                      : day
                        ? everything.filter((n) => localDay(n.created_at) === day)
                        : everything;

  const tags = await allTags();

  // The review queues are counted on every visit so the counts are visible
  // before she opens them. Four small queries; the page is not hot.
  const [proposalCount, unclassifiedCount, unsupportedCount, questionCount] = await Promise.all([
    listUnreviewedNotes().then((n) => n.length),
    listUnattributedNotes().then((n) => n.length),
    listUnsupportedClaims().then((n) => n.length),
    listOpenQuestions().then((n) => n.length),
  ]);

  const days = new Map<string, number>();
  for (const note of everything) {
    const key = localDay(note.created_at);
    days.set(key, (days.get(key) ?? 0) + 1);
  }
  const dayList = [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const connectionCount = everything.filter((n) => {
    const touched = new Set([...n.anchors.map((a) => a.work_id), ...n.works.map((w) => w.work_id)]);
    return n.kind !== 'axis' && touched.size > 1;
  }).length;

  // Grouped by the day written, but only in the unfiltered view — inside a tag
  // or a search the grouping would fragment the result.
  const grouped = !tag && !q && !filter && !day;
  const byDay = new Map<string, NoteWithRelations[]>();
  if (grouped) {
    for (const note of notes) {
      const key = localDay(note.created_at);
      const existing = byDay.get(key);
      if (existing) existing.push(note);
      else byDay.set(key, [note]);
    }
  }

  const heading = tag
    ? `#${tag}`
    : q
      ? `Search: ${q}`
      : day
        ? readableDay(day)
        : filter === 'proposals'
          ? 'Proposals from Claude, awaiting review'
          : filter === 'rejected'
            ? 'Rejected proposals'
            : filter === 'unclassified'
              ? 'Whose claim? Not yet answered'
              : filter === 'unsupported'
                ? 'Author’s claims with no passage behind them'
                : filter === 'questions'
                  ? 'Open questions'
                  : filter
                    ? filter
                    : 'Notes';

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
          className={!tag && !q && !filter && !day ? 'text-accent' : 'text-muted hover:text-accent'}
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
          href="/notes?filter=connections"
          className={filter === 'connections' ? 'text-accent' : 'text-muted hover:text-accent'}
        >
          connections ({connectionCount})
        </Link>
        <Link
          href="/notes?filter=untagged"
          className={filter === 'untagged' ? 'text-accent' : 'text-muted hover:text-accent'}
        >
          untagged
        </Link>
        <Link
          href="/notes?filter=questions"
          className={filter === 'questions' ? 'text-accent' : 'text-muted hover:text-accent'}
        >
          open questions ({questionCount})
        </Link>
        <Link href="/axes" className="text-muted hover:text-accent">
          axes →
        </Link>
      </nav>

      {/* The three things to check before an exam, kept apart from browsing. */}
      <nav className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className="text-muted">Review:</span>
        <Link
          href="/notes?filter=unclassified"
          className={filter === 'unclassified' ? 'text-accent' : unclassifiedCount > 0 ? 'text-accent hover:underline' : 'text-muted hover:text-accent'}
        >
          whose claim? ({unclassifiedCount})
        </Link>
        <Link
          href="/notes?filter=unsupported"
          className={filter === 'unsupported' ? 'text-accent' : unsupportedCount > 0 ? 'text-accent hover:underline' : 'text-muted hover:text-accent'}
        >
          no passage behind it ({unsupportedCount})
        </Link>
        <Link
          href="/notes?filter=proposals"
          className={filter === 'proposals' ? 'text-accent' : proposalCount > 0 ? 'text-accent hover:underline' : 'text-muted hover:text-accent'}
        >
          proposals from Claude ({proposalCount})
        </Link>
        <Link
          href="/notes?filter=rejected"
          className={filter === 'rejected' ? 'text-accent' : 'text-muted hover:text-accent'}
        >
          rejected
        </Link>
      </nav>

      {dayList.length > 1 ? (
        <nav className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span className="text-muted">By day:</span>
          {dayList.slice(0, 30).map(([key, count]) => (
            <Link
              key={key}
              href={`/notes?day=${key}`}
              className={key === day ? 'text-accent' : 'text-muted hover:text-accent'}
            >
              {key}
              <span className="ml-1 font-mono">{count}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {notes.length === 0 ? (
        <p className="text-sm text-muted">Nothing here yet.</p>
      ) : grouped ? (
        <div className="space-y-8">
          {[...byDay.entries()].map(([key, dayNotes]) => (
            <section key={key}>
              <h2 className="mb-1 text-xs uppercase tracking-wide text-muted">
                <Link href={`/notes?day=${key}`} className="hover:text-accent">
                  {readableDay(key)}
                </Link>
              </h2>
              <ul className="divide-y divide-rule border-y border-rule">
                {notes.length > 0
                  ? dayNotes.map((note) => <NoteCard key={note.id} note={note} />)
                  : null}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
        </ul>
      )}
    </div>
  );
}
