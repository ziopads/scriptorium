import Link from 'next/link';

import { addAxis } from '@/lib/actions';
import { requireAllowedUser } from '@/lib/auth/guard';
import { listAxes } from '@/lib/notes';

export const dynamic = 'force-dynamic';

// The mapa de cruces. Each axis is an argument over several works; this page
// lists them and takes a new one in the four parts she already uses. Fichas
// are added on the axis page, one at a time, because each names its own works.

export default async function AxesPage() {
  await requireAllowedUser();
  const axes = await listAxes();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl mb-1">Axes</h1>
        <p className="text-sm text-muted">
          {axes.length} {axes.length === 1 ? 'axis' : 'axes'} · an argument that gathers
          several works, with a thesis, fichas, how they connect, and an exam move
        </p>
      </div>

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
