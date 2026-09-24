import Link from 'next/link';

import { AxisMap } from '@/components/axis-map';
import { addAxis } from '@/lib/actions';
import { requireAllowedUser } from '@/lib/auth/guard';
import { axisMap } from '@/lib/axis-map';
import { examNumber } from '@/lib/exam-number';
import { listAxes } from '@/lib/notes';
import { readinessItems } from '@/lib/readiness';
import { listExamLists, listSections } from '@/lib/works';

export const dynamic = 'force-dynamic';

// The mapa de cruces. Each axis is an argument over several works; this page
// lists them and takes a new one in the four parts she already uses. Fichas
// are added on the axis page, one at a time, because each names its own works.
//
// Above the list, the map (lib/axis-map.ts): the axes and the works they bind,
// the works shared between axes drawn once as bridges, and under it the
// examinable works in no axis, by the readiness matrix's rule
// (lib/readiness.ts), so the two pages agree. The map's content is also given
// as a list, for reading without the picture.

export default async function AxesPage() {
  await requireAllowedUser();
  const [axes, layout, items, lists, sections] = await Promise.all([
    listAxes(),
    axisMap(),
    readinessItems(),
    listExamLists(),
    listSections(),
  ]);

  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const unbound = items.filter((i) => !i.in_axis);
  const bridges = layout.works.filter((w) => w.shared);
  const worksByAxis = new Map(
    layout.axes.map((a) => [a.id, layout.works.filter((w) => w.axes.includes(a.id))]),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl mb-1">Axes</h1>
        <p className="text-sm text-muted">
          {axes.length} {axes.length === 1 ? 'axis' : 'axes'} · an argument that gathers
          several works, with a thesis, fichas, how they connect, and an exam move
        </p>
      </div>

      {layout.axes.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base">The map</h2>
            <p className="text-xs text-muted">
              {layout.axes.length} axes · {layout.works.length} works ·{' '}
              {bridges.length} shared between axes · {unbound.length} examinable items in
              no axis
            </p>
          </div>
          <p className="text-xs text-muted">
            Works under an axis are bound by it alone; works in the band, outlined, are
            shared by several axes, a line to each. A solid line is a ficha; a dashed one,
            a work named only in the synthesis. Point at an axis or a work to light its
            lines. Only reviewed parts are drawn.
          </p>
          <div className="overflow-x-auto border-y border-rule py-3">
            <AxisMap layout={layout} />
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-accent hover:underline">
              The map as a list
            </summary>
            <ul className="mt-2 space-y-2">
              {layout.axes.map((a) => (
                <li key={a.id}>
                  <Link href={`/axes/${a.id}`} className="hover:text-accent">
                    {a.title}
                  </Link>
                  <span className="text-muted">
                    {' '}—{' '}
                    {(worksByAxis.get(a.id) ?? [])
                      .map((w) => (w.shared ? `${w.label} (shared)` : w.label))
                      .join(', ') || 'no works yet'}
                  </span>
                </li>
              ))}
            </ul>
          </details>

          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-accent hover:underline">
              Examinable items in no axis ({unbound.length})
            </summary>
            <div className="mt-2 space-y-3">
              {lists
                .filter((l) => l.examinable)
                .map((l) => {
                  const mine = unbound.filter((i) => i.list_id === l.id);
                  if (mine.length === 0) return null;
                  return (
                    <div key={l.id}>
                      <p className="text-xs text-muted">
                        {l.name} · {mine.length}
                      </p>
                      <ul className="flex flex-wrap gap-x-4 gap-y-1">
                        {mine.map((i) => {
                          const section = i.section_id ? sectionById.get(i.section_id) : undefined;
                          const code = examNumber(l.id, section, i.ordinal);
                          return (
                            <li key={`${i.id}-${i.section_id}`}>
                              <Link
                                href={`/?w=${encodeURIComponent(i.id)}`}
                                className="hover:text-accent"
                              >
                                {code ? <span className="font-mono text-xs text-muted">{code} </span> : null}
                                {(i.author ?? i.editor ?? i.title).split(',')[0]}
                                {i.year !== null ? ` ${i.year}` : ''}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              <p className="text-xs text-muted">
                The same rule as the axis mark on{' '}
                <Link href="/readiness" className="text-accent hover:underline">
                  Readiness
                </Link>
                : a volume counts as in an axis when one of its essays is.
              </p>
            </div>
          </details>
        </section>
      ) : null}

      {axes.length === 0 ? (
        <p className="text-sm text-muted">None yet.</p>
      ) : (
        <ol className="divide-y divide-rule border-y border-rule">
          {axes.map((axis) => (
            <li key={axis.id} className="py-4 space-y-1">
              <Link href={`/axes/${axis.id}`} className="font-medium hover:text-accent">
                {axis.title}
              </Link>
              <p className="text-sm">{axis.body}</p>
              <p className="text-xs text-muted">
                {axis.ficha_count} {axis.ficha_count === 1 ? 'ficha' : 'fichas'} ·{' '}
                {axis.work_count} {axis.work_count === 1 ? 'work' : 'works'}
              </p>
            </li>
          ))}
        </ol>
      )}

      <form action={addAxis} className="space-y-4 border-t border-rule pt-4">
        <h2 className="text-base">New axis</h2>

        <label className="block space-y-1">
          <span className="text-sm">Title</span>
          <input type="text" name="title" required placeholder="Eje 1 — El tecolote y lo ominoso" />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Thesis</span>
          <textarea name="thesis" rows={4} required />
          <span className="block text-xs text-muted">The claim the axis exists to make.</span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm">How they connect</span>
          <textarea name="synthesis" rows={4} />
          <span className="block text-xs text-muted">
            How the fichas combine into the thesis. Can be added later.
          </span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Works named here without a ficha of their own</span>
          <input type="text" name="yield_work_ids" placeholder="viramontes-moths-1985, rulfo-pedro-paramo-1955" />
          <span className="block text-xs text-muted">
            Catalogue ids, comma-separated: the literary yield of the axis.
          </span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Exam move</span>
          <textarea name="exam_move" rows={3} />
          <span className="block text-xs text-muted">
            What to say when a question opens on this ground. Can be added later.
          </span>
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1 space-y-1">
            <span className="text-sm">Tags</span>
            <input type="text" name="tags" placeholder="comma, separated" />
          </label>
          <button
            type="submit"
            className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
          >
            Create axis
          </button>
        </div>

        <p className="text-xs text-muted">
          Fichas come next, on the axis page. The thesis, the synthesis, and the exam
          move are recorded as your own claims.
        </p>
      </form>
    </div>
  );
}
