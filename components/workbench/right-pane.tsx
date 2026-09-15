import Link from 'next/link';

import { AttributionFields } from '@/components/attribution-fields';
import { NoteCard } from '@/components/note-card';
import { NoteForm, type AttachedWork } from '@/components/note-form';
import { ResettingForm } from '@/components/resetting-form';
import { SubmitButton } from '@/components/submit-button';
import { AddWorkForm } from '@/components/workbench/add-work-form';
import { QuoteCapture } from '@/components/workbench/quote-capture';
import { addAxis, addFicha, bridgeToAxis, makeFicha, unbridge, unmakeFicha } from '@/lib/actions';
import { getNote, linksFor } from '@/lib/notes';
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

export async function RightPane({
  params,
  rows,
  axes,
}: {
  params: WorkbenchParams;
  rows: WorkbenchRow[];
  axes: { id: number; title: string | null }[];
}) {
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

  // What a new work would sit inside: the book open in the centre, when the
  // Preview tab is showing one. An essay added while reading Rael belongs to
  // Rael, and the page she is on is where it starts.
  const container = params.view === 'preview' && params.w ? byId.get(params.w) : undefined;

  // A note under review.
  if (params.n) {
    const id = Number.parseInt(params.n, 10);
    const note = Number.isNaN(id) ? null : await getNote(id);
    if (!note) return <p className="text-sm text-muted">No such note.</p>;
    const links = await linksFor(note.id);
    const bridged = new Set(
      links.filter((l) => l.kind === 'bridge' && l.direction === 'out').map((l) => l.other_id),
    );
    const touchesWork = note.anchors.length > 0 || note.works.length > 0;
    const elsewhere = axes.filter((a) => a.id !== note.parent_id && !bridged.has(a.id));

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

        {/* An axis and a note meet two ways. A ficha is membership: the note
            becomes a part of the axis. A bridge is a cross-reference and
            leaves the note where it is. */}
        {note.kind === 'note' || note.kind === 'ficha' ? (
          <div className="space-y-2 border-t border-rule pt-3 text-xs">
            {note.kind === 'ficha' ? (
              <form action={unmakeFicha} className="flex flex-wrap items-baseline gap-2">
                <input type="hidden" name="note_id" value={note.id} />
                <input type="hidden" name="return_to" value={href(params, {})} />
                <span className="text-muted">
                  A ficha of{' '}
                  {note.parent_id !== null ? (
                    <Link
                      href={href(params, { a: String(note.parent_id), n: null })}
                      className="hover:text-accent"
                    >
                      {axes.find((a) => a.id === note.parent_id)?.title ?? 'an axis'}
                    </Link>
                  ) : (
                    'an axis'
                  )}
                  .
                </span>
                <button type="submit" className="text-muted hover:text-accent">
                  Make it a plain note again
                </button>
              </form>
            ) : axes.length === 0 ? null : touchesWork ? (
              <form action={makeFicha} className="flex flex-wrap items-baseline gap-2">
                <input type="hidden" name="note_id" value={note.id} />
                <input type="hidden" name="return_to" value={href(params, {})} />
                <label className="flex items-baseline gap-2">
                  <span className="text-muted">Make this a ficha of</span>
                  <select name="axis_id" className="w-44" required defaultValue="">
                    <option value="" disabled>choose an axis</option>
                    {axes.map((a) => (
                      <option key={a.id} value={a.id}>{a.title}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="text-accent hover:underline">Move it</button>
              </form>
            ) : (
              <p className="text-muted">
                A ficha says what a work contributes, so attach a work before making
                this one.
              </p>
            )}

            {elsewhere.length > 0 ? (
              <form action={bridgeToAxis} className="flex flex-wrap items-baseline gap-2">
                <input type="hidden" name="note_id" value={note.id} />
                <input type="hidden" name="return_to" value={href(params, {})} />
                <label className="flex items-baseline gap-2">
                  <span className="text-muted">Also bears on</span>
                  <select name="axis_id" className="w-44" required defaultValue="">
                    <option value="" disabled>choose an axis</option>
                    {elsewhere.map((a) => (
                      <option key={a.id} value={a.id}>{a.title}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="text-accent hover:underline">Link</button>
              </form>
            ) : null}

            {bridged.size > 0 ? (
              <ul className="space-y-0.5">
                {axes
                  .filter((a) => bridged.has(a.id))
                  .map((a) => (
                    <li key={a.id} className="flex items-baseline gap-2">
                      <Link
                        href={href(params, { a: String(a.id), n: null })}
                        className="text-muted hover:text-accent"
                      >
                        bears on {a.title}
                      </Link>
                      <form action={unbridge}>
                        <input type="hidden" name="note_id" value={note.id} />
                        <input type="hidden" name="axis_id" value={a.id} />
                        <input type="hidden" name="return_to" value={href(params, {})} />
                        <button type="submit" className="text-muted hover:text-accent">×</button>
                      </form>
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  // A new axis. `a=new` rather than a separate key: an axis id is numeric, so
  // the sentinel cannot collide, and the pane already keys on `a`.
  if (params.a === 'new') {
    return (
      <div className="space-y-3">
        <p className="flex items-baseline gap-3 text-xs text-muted">
          <span>New axis</span>
          <Link href={href(params, { a: null })} className="ml-auto hover:text-accent">
            New note instead
          </Link>
        </p>
        <ResettingForm action={addAxis} className="space-y-4">
          <input type="hidden" name="return_to" value={href(params, { ws: null, quote: null })} />
          <label className="block space-y-1">
            <span className="text-sm">Title</span>
            <input type="text" name="title" required placeholder="Eje 8 — …" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm">Thesis</span>
            <textarea name="thesis" rows={5} required className="reading" />
            <span className="block text-xs text-muted">
              What the axis argues. The works come next, one ficha each.
            </span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm">Tags</span>
            <input type="text" name="tags" placeholder="comma, separated" />
          </label>
          <div className="flex items-baseline gap-3">
            <SubmitButton>Create axis</SubmitButton>
            <span className="text-xs text-muted">
              {works.length > 0
                ? `Then a ficha for ${works.length === 1 ? 'the attached work' : `each of the ${works.length} attached works`}.`
                : 'Synthesis and exam move are added on the axis page.'}
            </span>
          </div>
        </ResettingForm>
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
        <ResettingForm action={addFicha} className="space-y-4">
          <input type="hidden" name="axis_id" value={params.a} />
          <input type="hidden" name="return_to" value={href(params, { ws: null, quote: null })} />
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
            <SubmitButton>Add ficha</SubmitButton>
          </div>
        </ResettingForm>
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
      <p className="flex items-baseline gap-3 text-xs text-muted">
        <span>New note</span>
        <Link href={href(params, { a: 'new', n: null })} className="ml-auto hover:text-accent">
          New axis
        </Link>
      </p>
      <NoteForm
        works={works}
        returnTo={here}
        compact
        defaultQuote={params.quote}
        defaultPage={params.quote ? params.p : undefined}
        clearQuoteHref={href(params, { quote: null })}
        captureSlot={params.view === 'preview' ? <QuoteCapture params={params} /> : null}
      />
      <AddWorkForm
        returnTo={href(params, { quote: params.quote ?? null })}
        containerId={container?.id}
        containerLabel={container ? label(container, container.id) : undefined}
        page={params.p}
      />
    </div>
  );
}
