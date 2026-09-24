import { ReadinessCell, ReadinessLegend, tally } from '@/components/readiness-cell';
import { requireAllowedUser } from '@/lib/auth/guard';
import { examNumber } from '@/lib/exam-number';
import { readinessItems } from '@/lib/readiness';
import { listExamLists, listSections } from '@/lib/works';

export const dynamic = 'force-dynamic';

// The readiness matrix: the examinable lists, section by section, one cell per
// item, so that the works she would meet in the exam with nothing prepared
// can be seen on one screen. The cell and its legend are in
// components/readiness-cell.tsx, shared with a project's page.
//
// Server-rendered HTML with no client code and no D3: a grid of links is what
// this is, and the browser draws it without help.

export default async function ReadinessPage() {
  await requireAllowedUser();

  const [lists, sections, items] = await Promise.all([
    listExamLists(),
    listSections(),
    readinessItems(),
  ]);

  const examinable = lists.filter((l) => l.examinable);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl">Readiness</h1>
        <p className="text-sm text-muted">
          Every item on the examinable lists, by section: whether its file is searchable,
          and whether it has notes, a quotation, a place in an axis and a study aid. A
          volume counts what is written on the essays inside it. Each cell opens the
          work in the workbench.
        </p>
      </header>

      <ReadinessLegend />

      {examinable.map((list) => {
        const own = sections.filter((s) => s.list_id === list.id);
        const listItems = items.filter((i) => i.list_id === list.id);
        const loose = listItems.filter(
          (i) => i.section_id === null || !own.some((s) => s.id === i.section_id),
        );
        const t = tally(listItems);
        const rows = [
          ...own.map((section) => ({
            key: section.id,
            label: `${section.letter ? `${section.letter}. ` : ''}${section.title}${
              section.kind === 'supplementary' ? ' (supplementary)' : ''
            }`,
            section,
            items: listItems.filter((i) => i.section_id === section.id),
          })),
          ...(loose.length > 0
            ? [{ key: `${list.id}-loose`, label: 'Not in a section', section: undefined, items: loose }]
            : []),
        ].filter((row) => row.items.length > 0);

        return (
          <section key={list.id} className="space-y-3 border-t border-rule pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg">{list.name}</h2>
              <p className="text-xs text-muted">
                {t.works} items · {t.searchable} searchable · {t.notes} with notes ·{' '}
                {t.quoted} with a quotation · {t.axis} in an axis · {t.aid} with a
                reviewed study aid
              </p>
            </div>

            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.key} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                  <p className="w-56 shrink-0 pt-1 text-xs text-muted">{row.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {row.items.map((item) => (
                      <ReadinessCell
                        key={`${item.id}-${item.section_id}`}
                        item={item}
                        caption={examNumber(list.id, row.section, item.ordinal)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
