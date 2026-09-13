import Link from 'next/link';

import { editNote, linkNote, removeNote, unlinkNote } from '@/lib/actions';
import { day } from '@/lib/dates';
import { listRevisions } from '@/lib/notes';
import type { NoteWithAnchors } from '@/lib/types';

// One note, on a work page or on /notes.
//
// A note with two or more anchors is a connection. It renders identically —
// there is no separate concept — and appears on every work it touches, from
// each direction, because anchors are peers rather than source and target.
//
// Editing is a <details> holding forms rather than a modal, which keeps the
// mutation path free of client JavaScript and lets several stay open at once.

export async function NoteCard({
  note,
  workId,
}: {
  note: NoteWithAnchors;
  workId?: string;   // when rendered on a work page, the anchor to lead with
}) {
  const revisions = await listRevisions(note.id);

  const here = workId ? note.anchors.find((a) => a.work_id === workId) : undefined;
  const elsewhere = note.anchors.filter((a) => a !== here);
  const isConnection = note.anchors.length > 1;

  return (
    <li className="py-4 space-y-2 text-sm">
      {here?.quote ? (
        <blockquote className="border-l-2 border-rule pl-3 italic">{here.quote}</blockquote>
      ) : null}

      <p className="whitespace-pre-wrap">{note.body}</p>

      {/* Every anchor other than the one we are standing on. On /notes that is
          all of them; on a work page it is the other side of a connection. */}
      {elsewhere.length > 0 ? (
        <ul className={isConnection ? 'space-y-1 border-l-2 border-accent pl-3' : 'space-y-1'}>
          {elsewhere.map((anchor) => (
            <li key={anchor.ordinal} className="text-xs">
              <Link href={`/works/${anchor.work_id}`} className="text-muted hover:text-accent">
                {isConnection && here ? '↔ ' : ''}
                {anchor.work_author ?? '—'},{' '}
                <span className="italic">{anchor.work_title}</span>
                {anchor.printed_page !== null ? `, ${anchor.printed_page}` : null}
              </Link>
              {anchor.quote ? (
                <p className="mt-0.5 border-l border-rule pl-2 italic text-muted">
                  {anchor.quote}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
        {here ? (
          <span>{here.printed_page !== null ? `p. ${here.printed_page}` : 'no page'}</span>
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
            {note.reviewed ? 'assistant draft, reviewed' : 'assistant draft, unreviewed'}
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
        <summary className="cursor-pointer text-xs text-muted hover:text-accent">Edit</summary>

        <form action={editNote} className="mt-3 space-y-3 border-l-2 border-rule pl-3">
          <input type="hidden" name="id" value={note.id} />
          <label className="block space-y-1">
            <span className="text-xs text-muted">Note</span>
            <textarea name="body" rows={4} defaultValue={note.body} required />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-48 flex-1 space-y-1">
              <span className="text-xs text-muted">Tags</span>
              <input type="text" name="tags" defaultValue={note.tags.join(', ')} />
            </label>
            <button
              type="submit"
              className="border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent hover:text-background"
            >
              Save
            </button>
          </div>
        </form>

        {/* A second anchor is what makes this a connection. Adding one from here
            means the link is made where the thought occurred, while reading. */}
        <form action={linkNote} className="mt-3 space-y-2 border-l-2 border-rule pl-3">
          <input type="hidden" name="note_id" value={note.id} />
          <p className="text-xs text-muted">Connect to another work</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-56 flex-1 space-y-1">
              <span className="text-xs text-muted">Work id</span>
              <input type="text" name="work_id" placeholder="taylor-archive-repertoire-2003" />
            </label>
            <label className="w-20 space-y-1">
              <span className="text-xs text-muted">Page</span>
              <input type="number" name="printed_page" />
            </label>
            <button type="submit" className="text-xs text-accent hover:underline">
              Link
            </button>
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Passage there</span>
            <textarea name="quote" rows={2} />
          </label>
        </form>

        {note.anchors.length > 1 ? (
          <div className="mt-2 space-y-1 border-l-2 border-rule pl-3">
            {note.anchors.map((anchor) => (
              <form key={anchor.ordinal} action={unlinkNote}>
                <input type="hidden" name="note_id" value={note.id} />
                <input type="hidden" name="ordinal" value={anchor.ordinal} />
                <button type="submit" className="text-xs text-muted hover:text-accent">
                  Remove anchor to {anchor.work_title}
                </button>
              </form>
            ))}
          </div>
        ) : null}

        {/* Its own form: nested inside the edit form, one button would submit
            the other's fields. */}
        <form action={removeNote} className="mt-2 border-l-2 border-rule pl-3">
          <input type="hidden" name="id" value={note.id} />
          <button type="submit" className="text-xs text-muted hover:text-accent">
            Delete this note
          </button>
        </form>

        {revisions.length > 0 ? (
          <div className="mt-4 border-l-2 border-rule pl-3">
            <p className="text-xs uppercase tracking-wide text-muted">Earlier versions</p>
            <ol className="mt-2 space-y-3">
              {revisions.map((revision) => (
                <li key={revision.id} className="space-y-1">
                  <p className="text-xs text-muted">
                    written {day(revision.written_at)}, replaced {day(revision.superseded_at)}
                  </p>
                  <p className="whitespace-pre-wrap text-xs text-muted">{revision.body}</p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </details>
    </li>
  );
}
