import Link from 'next/link';

import { AttributionBadge, AttributionFields } from '@/components/attribution-fields';
import {
  acceptNote,
  declineNote,
  detachWork,
  editNote,
  linkNote,
  reconsiderNote,
  removeNote,
  unlinkNote,
} from '@/lib/actions';
import { day } from '@/lib/dates';
import { linksFor, listRevisions } from '@/lib/notes';
import type { NoteWithRelations } from '@/lib/types';
import { NOTE_KIND_LABEL, NOTE_ROLE_LABEL } from '@/lib/types';

// One note, on a work page, on /notes, or as a part of an axis.
//
// A note reaches works two ways and both are shown: anchors (page and quote,
// with her translation beside it) and whole-work relations (a ficha's works,
// a synthesis's yield). A note touching more than one work is a connection and
// appears on every work it touches, from each direction.
//
// Three states render distinctly: her own notes and accepted proposals as the
// graph; pending proposals with accept and reject; rejected proposals only in
// the rejected list, with a way back.
//
// Editing is a <details> holding forms rather than a modal, which keeps the
// mutation path free of client JavaScript and lets several stay open at once.

export async function NoteCard({
  note,
  workId,
  compact = false,
}: {
  note: NoteWithRelations;
  workId?: string;    // when rendered on a work page, the anchor to lead with
  compact?: boolean;  // inside an axis: no link back to the axis, no kind badge
}) {
  const [revisions, links] = await Promise.all([listRevisions(note.id), linksFor(note.id)]);

  const here = workId ? note.anchors.find((a) => a.work_id === workId) : undefined;
  const elsewhere = note.anchors.filter((a) => a !== here);
  const worksHere = note.works.filter((w) => w.work_id !== workId);

  const touched = new Set([...note.anchors.map((a) => a.work_id), ...note.works.map((w) => w.work_id)]);
  const isConnection = touched.size > 1;
  const unsupported =
    note.attribution === 'author' && !note.anchors.some((a) => a.quote && a.quote.trim() !== '');
  const pending = note.origin === 'assistant' && !note.reviewed && note.rejected_at === null;
  const rejected = note.rejected_at !== null;

  return (
    <li className={`py-4 space-y-2 text-sm ${pending || rejected ? 'opacity-80' : ''}`}>
      {note.title ? (
        <p className="reading font-medium">
          {note.kind === 'axis' ? (
            <Link href={`/axes/${note.id}`} className="hover:text-accent">{note.title}</Link>
          ) : note.title}
        </p>
      ) : null}

      {here?.quote ? (
        <blockquote className="reading border-l-2 border-rule pl-3 italic">
          {here.quote}
          {here.translation ? (
            <span className="mt-1 block not-italic text-muted">{here.translation}</span>
          ) : null}
        </blockquote>
      ) : null}

      <p className="reading whitespace-pre-wrap">{note.body}</p>

      {/* Every anchor other than the one we are standing on. */}
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
                <p className="reading-sm mt-0.5 border-l border-rule pl-2 italic text-muted">
                  {anchor.quote}
                  {anchor.translation ? (
                    <span className="block not-italic">{anchor.translation}</span>
                  ) : null}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Whole-work relations: a ficha's works, a synthesis's yield. */}
      {worksHere.length > 0 ? (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {worksHere.map((w) => (
            <li key={w.work_id}>
              <Link href={`/works/${w.work_id}`} className="text-muted hover:text-accent">
                {w.role !== 'about' && w.role !== 'ficha' ? (
                  <span>{NOTE_ROLE_LABEL[w.role]} </span>
                ) : null}
                {w.work_author ?? '—'}, <span className="italic">{w.work_title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {links.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-muted">
          {links.map((l) => (
            <li key={`${l.kind}-${l.other_id}`}>
              {l.kind === 'answers'
                ? l.direction === 'out' ? 'answers: ' : 'answered by: '
                : `${l.kind}${l.direction === 'in' ? ' from' : ''}: `}
              <Link
                href={l.other_kind === 'axis' ? `/axes/${l.other_id}` : `/notes?q=${encodeURIComponent(l.other_body.slice(0, 40))}`}
                className="hover:text-accent"
              >
                {l.other_title ?? l.other_body.slice(0, 80)}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
        {!compact && note.kind !== 'note' ? <span>{NOTE_KIND_LABEL[note.kind]}</span> : null}
        {!compact && note.parent_id !== null ? (
          <Link href={`/axes/${note.parent_id}`} className="hover:text-accent">in an axis</Link>
        ) : null}

        {here ? (
          <span>{here.printed_page !== null ? `p. ${here.printed_page}` : 'no page'}</span>
        ) : null}

        {note.kind !== 'question' && note.kind !== 'axis' ? (
          <AttributionBadge
            attribution={note.attribution}
            attributedTo={note.attributed_to}
            unsupported={unsupported}
          />
        ) : null}

        {note.tags.map((tag) => (
          <Link key={tag} href={`/notes?tag=${encodeURIComponent(tag)}`} className="hover:text-accent">
            #{tag}
          </Link>
        ))}

        {note.origin === 'assistant' ? (
          <span className={note.reviewed ? '' : 'text-accent'}>
            {rejected
              ? 'proposal, rejected'
              : note.reviewed
                ? 'found by Claude, confirmed by her'
                : 'proposal, awaiting review'}
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

      {pending ? (
        <div className="flex gap-3 border-l-2 border-accent pl-3">
          <form action={acceptNote}>
            <input type="hidden" name="id" value={note.id} />
            <button type="submit" className="border border-accent px-3 py-1 text-xs text-accent hover:bg-accent hover:text-background">
              Accept
            </button>
          </form>
          <form action={declineNote}>
            <input type="hidden" name="id" value={note.id} />
            <button type="submit" className="text-xs text-muted hover:text-accent">Reject</button>
          </form>
        </div>
      ) : null}

      {rejected ? (
        <form action={reconsiderNote} className="border-l-2 border-rule pl-3">
          <input type="hidden" name="id" value={note.id} />
          <button type="submit" className="text-xs text-muted hover:text-accent">Reconsider</button>
        </form>
      ) : null}

      {!rejected ? (
        <details className="pt-1">
          <summary className="cursor-pointer text-xs text-muted hover:text-accent">Edit</summary>

          <form action={editNote} className="mt-3 space-y-3 border-l-2 border-rule pl-3">
            <input type="hidden" name="id" value={note.id} />
            {note.kind === 'axis' ? (
              <label className="block space-y-1">
                <span className="text-xs text-muted">Title</span>
                <input type="text" name="title" defaultValue={note.title ?? ''} />
              </label>
            ) : null}
            <label className="block space-y-1">
              <span className="text-xs text-muted">{note.kind === 'axis' ? 'Thesis' : 'Note'}</span>
              <textarea name="body" rows={4} defaultValue={note.body} required className="reading" />
            </label>
            {note.kind !== 'question' && note.kind !== 'axis' ? (
              <AttributionFields current={note.attribution} attributedTo={note.attributed_to} />
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-48 flex-1 space-y-1">
                <span className="text-xs text-muted">Tags</span>
                <input type="text" name="tags" defaultValue={note.tags.join(', ')} />
              </label>
              <button type="submit" className="border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent hover:text-background">
                Save
              </button>
            </div>
          </form>

          {/* A passage in another work. Adding it here means the link is made
              where the thought occurred, while reading. */}
          {note.kind !== 'axis' ? (
            <form action={linkNote} className="mt-3 space-y-2 border-l-2 border-rule pl-3">
              <input type="hidden" name="note_id" value={note.id} />
              <p className="text-xs text-muted">Add a passage from another work</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-56 flex-1 space-y-1">
                  <span className="text-xs text-muted">Work id</span>
                  <input type="text" name="work_id" placeholder="taylor-archive-repertoire-2003" />
                </label>
                <label className="w-20 space-y-1">
                  <span className="text-xs text-muted">Page</span>
                  <input type="number" name="printed_page" />
                </label>
                <button type="submit" className="text-xs text-accent hover:underline">Link</button>
              </div>
              <label className="block space-y-1">
                <span className="text-xs text-muted">Passage there, verbatim</span>
                <textarea name="quote" rows={2} className="reading" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted">Your translation</span>
                <textarea name="translation" rows={2} className="reading" />
              </label>
            </form>
          ) : null}

          {note.anchors.length > 1 || (note.anchors.length > 0 && note.works.length > 0) ? (
            <div className="mt-2 space-y-1 border-l-2 border-rule pl-3">
              {note.anchors.map((anchor) => (
                <form key={anchor.ordinal} action={unlinkNote}>
                  <input type="hidden" name="note_id" value={note.id} />
                  <input type="hidden" name="ordinal" value={anchor.ordinal} />
                  <button type="submit" className="text-xs text-muted hover:text-accent">
                    Remove passage from {anchor.work_title}
                  </button>
                </form>
              ))}
            </div>
          ) : null}

          {note.works.length > 1 ? (
            <div className="mt-2 space-y-1 border-l-2 border-rule pl-3">
              {note.works.map((w) => (
                <form key={w.work_id} action={detachWork}>
                  <input type="hidden" name="note_id" value={note.id} />
                  <input type="hidden" name="work_id" value={w.work_id} />
                  <button type="submit" className="text-xs text-muted hover:text-accent">
                    Remove {w.work_title}
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
              {note.kind === 'axis' ? 'Delete this axis and all its parts' : 'Delete this note'}
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
                      {revision.attribution ? ` · ${revision.attribution}` : null}
                    </p>
                    {revision.title ? <p className="text-xs text-muted">{revision.title}</p> : null}
                    <p className="reading-sm whitespace-pre-wrap text-muted">{revision.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </details>
      ) : null}
    </li>
  );
}
