import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { examinableIds, incompleteWorks, listExamLists, listWorks, listSections } from '@/lib/works';

export const dynamic = 'force-dynamic';

// The reading list by list and section, and what still needs attention. Was
// the home page until the workbench took `/`.

export default async function ListsPage() {
  await requireAllowedUser();

  const [lists, sections, works, incomplete, examinable] = await Promise.all([
    listExamLists(),
    listSections(),
    listWorks(),
    incompleteWorks(),
    examinableIds(),
  ]);

  const unsourced = works.filter(
    (w) => w.source_format === 'none' && w.container_id === null && examinable.has(w.id),
  );

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl mb-1">Reading list</h1>
        <p className="text-sm text-muted">
          {examinable.size} examinable works · {works.length} records in all
        </p>
      </section>

      <section className="space-y-4">
        {lists.map((list) => {
          const own = sections.filter((s) => s.list_id === list.id);
          return (
            <div key={list.id} className="border-y border-rule py-3">
              <div className="flex items-baseline justify-between">
                <Link href={`/works?list=${list.id}`} className="hover:text-accent">
                  {list.name}
                  {list.examinable ? null : (
                    <span className="text-xs text-muted"> · not examinable</span>
                  )}
                </Link>
              </div>
              {own.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-muted">
                  {own.map((section) => (
                    <li key={section.id}>
                      {section.letter ? `${section.letter}. ` : null}
                      {section.title}
                      {section.kind === 'supplementary' ? ' (supplementary)' : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-base">What still needs attention</h2>
        <p>
          <Link href="/gaps" className="text-accent underline underline-offset-2">
            {incomplete.length} records
          </Link>{' '}
          are missing a field a citation needs.
        </p>
        <p>
          <Link
            href="/works?source=missing"
            className="text-accent underline underline-offset-2"
          >
            {unsourced.length} examinable works
          </Link>{' '}
          have no file yet. That list is the one to work down when hunting for copies.
        </p>
      </section>
    </div>
  );
}
