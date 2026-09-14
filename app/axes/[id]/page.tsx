import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AttributionFields } from '@/components/attribution-fields';
import { NoteCard } from '@/components/note-card';
import { addAxisPart, addFicha, attachWork } from '@/lib/actions';
import { requireAllowedUser } from '@/lib/auth/guard';
import { getAxisTree } from '@/lib/notes';

export const dynamic = 'force-dynamic';

// One axis, in the four parts she already uses. Each part is a note: it has
// its own attribution, provenance, revisions and tags, and edits through the
// same card as everything else. Membership of works in the axis is whatever
// the parts name; nothing is stored on the axis row.

export default async function AxisPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAllowedUser();
  const { id } = await params;
  const axisId = Number.parseInt(id, 10);
  if (Number.isNaN(axisId)) notFound();

  const tree = await getAxisTree(axisId);
  if (!tree) notFound();

  const { axis, fichas, synthesis, exam_move } = tree;

  // Every work the axis binds, with the grade of membership.
  const members = new Map<string, { title: string; author: string | null; role: string }>();
  for (const f of fichas) for (const w of f.works) members.set(w.work_id, { title: w.work_title, author: w.work_author, role: 'ficha' });
  if (synthesis) for (const w of synthesis.works) if (!members.has(w.work_id)) members.set(w.work_id, { title: w.work_title, author: w.work_author, role: 'yield' });

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs text-muted">
          <Link href="/axes" className="hover:text-accent">Axes</Link>
        </p>
        <h1 className="text-2xl">{axis.title}</h1>
        <p className="text-xs text-muted">
          {fichas.length} {fichas.length === 1 ? 'ficha' : 'fichas'} · {members.size}{' '}
          {members.size === 1 ? 'work' : 'works'}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-base">Thesis</h2>
        <ul className="border-y border-rule">
          <NoteCard note={axis} compact />
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base">Works</h2>
        {members.size === 0 ? (
          <p className="text-sm text-muted">None yet. Add a ficha.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {[...members.entries()].map(([workId, m]) => (
              <li key={workId}>
                <Link href={`/works/${workId}`} className="hover:text-accent">
                  {m.author ?? '—'}, <span className="italic">{m.title}</span>
                </Link>
                {m.role === 'yield' ? <span className="text-xs text-muted"> · named in the synthesis</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-base">Fichas</h2>
        <p className="text-xs text-muted">
          One paragraph on what a work contributes to this argument. A ficha can cover
          several works if you read them as one contribution.
        </p>

        {fichas.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ol className="divide-y divide-rule border-y border-rule">
            {fichas.map((f) => (
              <NoteCard key={f.id} note={f} compact />
            ))}
          </ol>
        )}

        <form action={addFicha} className="space-y-4 border-t border-rule pt-4">
          <input type="hidden" name="axis_id" value={axis.id} />
          <label className="block space-y-1">
            <span className="text-sm">Works</span>
            <input type="text" name="work_ids" required placeholder="freud-lo-ominoso-1919, todorov-fantastic-1970" />
            <span className="block text-xs text-muted">Catalogue ids, comma-separated.</span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm">Ficha</span>
            <textarea name="body" rows={4} required />
          </label>
          <AttributionFields />
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-56 flex-1 space-y-1">
              <span className="text-sm">Tags</span>
              <input type="text" name="tags" placeholder="comma, separated" />
            </label>
            <button
              type="submit"
              className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
            >
              Add ficha
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-base">How they connect</h2>
        {synthesis ? (
          <>
            <ul className="border-y border-rule">
              <NoteCard note={synthesis} compact />
            </ul>
            <form action={attachWork} className="flex flex-wrap items-end gap-2 text-sm">
              <input type="hidden" name="note_id" value={synthesis.id} />
              <input type="hidden" name="role" value="yield" />
              <label className="min-w-56 flex-1 space-y-1">
                <span className="text-xs text-muted">Name another work without a ficha</span>
                <input type="text" name="work_id" placeholder="rulfo-pedro-paramo-1955" />
              </label>
              <button type="submit" className="text-xs text-accent hover:underline">Add</button>
            </form>
          </>
        ) : (
          <form action={addAxisPart} className="space-y-3">
            <input type="hidden" name="axis_id" value={axis.id} />
            <input type="hidden" name="kind" value="synthesis" />
            <textarea name="body" rows={4} required placeholder="How the fichas combine into the thesis." />
            <label className="block space-y-1">
              <span className="text-xs text-muted">Works named here without a ficha of their own</span>
              <input type="text" name="yield_work_ids" placeholder="catalogue ids, comma-separated" />
            </label>
            <button type="submit" className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background">
              Save
            </button>
          </form>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-base">Exam move</h2>
        {exam_move ? (
          <ul className="border-y border-rule">
            <NoteCard note={exam_move} compact />
          </ul>
        ) : (
          <form action={addAxisPart} className="space-y-3">
            <input type="hidden" name="axis_id" value={axis.id} />
            <input type="hidden" name="kind" value="exam_move" />
            <textarea name="body" rows={3} required placeholder="What to say when a question opens on this ground." />
            <button type="submit" className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background">
              Save
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
