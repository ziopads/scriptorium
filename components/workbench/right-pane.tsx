import Link from 'next/link';

import { AttributionFields } from '@/components/attribution-fields';
import { NoteCard } from '@/components/note-card';
import { NoteForm, type AttachedWork } from '@/components/note-form';
import { addFicha } from '@/lib/actions';
import { getNote } from '@/lib/notes';
import type { WorkbenchRow } from '@/lib/works';
import { attached, href, withAttached, type WorkbenchParams } from '@/lib/workbench-url';

// The right pane: the note under review, the ficha composer for the selected
// axis, or the new-note form. The works it writes about come from the URL
// (ws, attached by clicking rows) or, failing that, the selected work; ids are
// never typed.
//
// A passage selected in the Preview tab arrives the same way, as quote, and
// brings p with it. The page defaults only when there is a quotation: reading
// page 300 and writing a note about the book as a whole should not silently
// anchor that note to page 300.

function label(r: WorkbenchRow | undefined, id: string): string {
  if (!r) return id;
  const surname = r.author ? r.author.split(',')[0] : '—';
  const short = r.title.length > 40 ? `${r.title.slice(0, 38)}…` : r.title;
  return `${surname}, ${short}`;
}

export async function RightPane({ params, rows }: { params: WorkbenchParams; rows: WorkbenchRow[] }) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ws = attached(params);
  const ids = ws.length > 0 ? ws : params.w ? [params.w] : [];
  const works: AttachedWork[] = ids.map((id) => ({
    id,
    label: label(byId.get(id), id),
    removeHref: ws.length > 0 ? href(params, { ws: withAttached(params, ws.filter((x) => x !== id)) }) : undefined,
  }));
  // After saving, come back here with the attachments and the captured
  // passage cleared, and the page still open where she left it.
  const here = href(params, { ws: null, quote: null });

  // A note under review.
  if (params.n) {
    const id = Number.parseInt(params.n, 10);
    const note = Number.isNaN(id) ? null : await getNote(id);
    if (!note) return <p className="text-sm text-muted">No such note.</p>;
    return (
      <div className="space-y-3">
        <p className="flex items-baseline gap-3 text-xs text-muted">
          <span>{note.origin === 'assistant' && !note.reviewed ? 'Proposal' : 'Note'}</span>
          <Link href={href(params, { n: null })} className="ml-auto hover:text-accent">New note</Link>
        </p>
        <ul className="border-y border-rule">
          <NoteCard note={note} />
        </ul>
        {note.works.length > 0 || note.anchors.length > 0 ? (
          <p className="text-xs text-muted">
            Open in the centre:{' '}
            {[...note.anchors.map((a) => ({ id: a.work_id, t: a.work_title })), ...note.works.map((w) => ({ id: w.work_id, t: w.work_title }))]
              .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
              .map((x, i) => (
                <span key={x.id}>
                  {i > 0 ? ' · ' : ''}
                  <Link href={href(params, { w: x.id })} className="italic hover:text-accent">{x.t}</Link>
                </span>
              ))}
          </p>
        ) : null}
      </div>
    );
  }

  // The ficha composer for the selected axis.
  if (params.a) {
    return (
      <div className="space-y-3">
        <p className="flex items-baseline gap-3 text-xs text-muted">
          <span>New ficha for this axis</span>
          <Link href={href(params, { a: null })} className="ml-auto hover:text-accent">New note instead</Link>
        </p>
        <form action={addFicha} className="space-y-4">
          <input type="hidden" name="axis_id" value={params.a} />
          <input type="hidden" name="return_to" value={href(params, { ws: null })} />
          <div className="space-y-1">
            <span className="text-sm">Works</span>
            <input type="hidden" name="work_ids" value={ids.join(',')} />
            {works.length === 0 ? (
              <p className="text-xs text-muted">Select a work in the list, or press + on rows to add several.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {works.map((w) => (
                  <li key={w.id} className="flex items-center gap-1 border border-rule px-2 py-0.5 text-xs">
                    <span>{w.label}</span>
                    {ws.length > 0 ? <Link href={w.removeHref!} className="text-muted hover:text-accent" aria-label={`Remove ${w.label}`}>×</Link> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="block space-y-1">
            <span className="text-sm">Ficha</span>
            <textarea name="body" rows={6} required className="reading" />
            <span className="block text-xs text-muted">What this work contributes to the argument.</span>
          </label>
          <AttributionFields />
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-40 flex-1 space-y-1">
              <span className="text-sm">Tags</span>
              <input type="text" name="tags" placeholder="comma, separated" />
            </label>
            <button type="submit" className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background">
              Add ficha
            </button>
          </div>
        </form>
        <p className="text-xs text-muted">
          Synthesis and exam move are edited on the{' '}
          <Link href={`/axes/${params.a}`} className="hover:text-accent">axis page</Link>.
        </p>
      </div>
    );
  }

  // The new-note form.
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">New note</p>
      <NoteForm
        works={works}
        returnTo={here}
        compact
        defaultQuote={params.quote}
        defaultPage={params.quote ? params.p : undefined}
        clearQuoteHref={href(params, { quote: null })}
      />
    </div>
  );
}
