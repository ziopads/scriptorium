import Link from 'next/link';

import { ExpandAll } from '@/components/expand-all';
import { requireAllowedUser } from '@/lib/auth/guard';
import { day } from '@/lib/dates';
import { documentInfo } from '@/lib/documents';
import { examNumber } from '@/lib/exam-number';
import {
  examinableIds,
  listExamLists,
  listItemsForLists,
  listSections,
  listWorks,
  type ListItemRow,
} from '@/lib/works';

export const dynamic = 'force-dynamic';

// The reading list by list and section, each section opening like an
// accordion onto its books in the printed order, and the exam list as her
// department issued it, to download and print.
//
// The sections are native <details>, so they open and close without client
// code. Each book shows its exam number, author, title, year and how many of
// her notes touch it, with a link to its page and one to the workbench.
//
// The exam number comes from lib/exam-number.ts, shared with the readiness
// matrix.

function Chevron() {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-3 text-muted transition-transform group-open:rotate-90"
    >
      ›
    </span>
  );
}

function Items({
  items,
  listId,
  section,
}: {
  items: ListItemRow[];
  listId: string;
  section?: { letter: string | null; kind: string };
}) {
  return (
    <ol className="ml-5 mt-1 divide-y divide-rule border-y border-rule">
      {items.map((w) => {
        const code = examNumber(listId, section, w.ordinal);
        const who = w.author ?? (w.editor ? `${w.editor}, ed.` : '\u2014');
        return (
          <li key={`${w.id}-${w.section_id}`} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm">
            {code ? <span className="w-20 shrink-0 font-mono text-xs text-muted">{code}</span> : null}
            <span className="shrink-0">{who}</span>
            <span className="min-w-0 flex-1">
              <span className="italic">{w.title}</span>
              {w.year !== null ? <span className="text-muted">, {w.year}</span> : null}
            </span>
            <span className="w-20 shrink-0 text-right text-xs text-muted">
              {w.note_count} {w.note_count === 1 ? 'note' : 'notes'}
            </span>
            <span className="flex shrink-0 gap-3 text-xs">
              <Link href={`/works/${w.id}`} className="text-accent hover:underline underline-offset-2">
                page
              </Link>
              <Link href={`/?w=${encodeURIComponent(w.id)}`} className="text-accent hover:underline underline-offset-2">
                workbench
              </Link>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default async function ListsPage() {
  await requireAllowedUser();

  const [lists, sections, works, examinable, items, examList] = await Promise.all([
    listExamLists(),
    listSections(),
    listWorks(),
    examinableIds(),
    listItemsForLists(),
    documentInfo('exam-list'),
  ]);

  return (
    <div className="space-y-10">
      <section className="space-y-2">
        <h1 className="text-2xl">Reading list</h1>
        <p className="text-sm text-muted">
          {examinable.size} examinable works · {works.length} records in all
        </p>
        {examList ? (
          <p className="text-sm">
            <a
              href="/lists/exam-list"
              className="border border-accent px-3 py-1.5 text-accent hover:bg-accent hover:text-background"
            >
              Download the exam list (PDF)
            </a>
            <span className="pl-3 text-xs text-muted">
              {examList.filename} · {Math.round(examList.size / 1024)} KB · uploaded {day(examList.uploaded_at)}
            </span>
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        <div className="flex justify-end">
          <ExpandAll group="lists" />
        </div>
        {lists.map((list) => {
          const own = sections.filter((s) => s.list_id === list.id);
          const listItems = items.filter((i) => i.list_id === list.id);
          const loose = listItems.filter(
            (i) => i.section_id === null || !own.some((s) => s.id === i.section_id),
          );
          return (
            <div key={list.id} className="border-y border-rule py-3">
              <div className="flex items-baseline justify-between">
                <Link href={`/works?list=${list.id}`} className="hover:text-accent">
                  {list.name}
                  {list.examinable ? null : (
                    <span className="text-xs text-muted"> · not examinable</span>
                  )}
                </Link>
                <span className="text-xs text-muted">{listItems.length} items</span>
              </div>

              <div className="mt-2 space-y-1">
                {own.map((section) => {
                  const inSection = listItems.filter((i) => i.section_id === section.id);
                  return (
                    <details key={section.id} data-group="lists" className="group">
                      <summary className="flex cursor-pointer list-none items-baseline gap-2 text-sm text-muted hover:text-accent [&::-webkit-details-marker]:hidden">
                        <Chevron />
                        <span>
                          {section.letter ? `${section.letter}. ` : null}
                          {section.title}
                          {section.kind === 'supplementary' ? ' (supplementary)' : null}
                        </span>
                        <span className="text-xs">{inSection.length}</span>
                      </summary>
                      {inSection.length > 0 ? (
                        <Items items={inSection} listId={list.id} section={section} />
                      ) : (
                        <p className="ml-5 text-xs text-muted">No items.</p>
                      )}
                    </details>
                  );
                })}

                {loose.length > 0 ? (
                  <details data-group="lists" className="group">
                    <summary className="flex cursor-pointer list-none items-baseline gap-2 text-sm text-muted hover:text-accent [&::-webkit-details-marker]:hidden">
                      <Chevron />
                      <span>{own.length > 0 ? 'Not in a section' : 'Items'}</span>
                      <span className="text-xs">{loose.length}</span>
                    </summary>
                    <Items items={loose} listId={list.id} />
                  </details>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-base">What still needs attention</h2>
        <p>
          The <Link href="/gaps" className="text-accent underline underline-offset-2">Gaps</Link>{' '}
          page lists records missing a citation field, books without a PDF or not yet
          searchable, books without a study aid, and page numbering to settle.
        </p>
      </section>
    </div>
  );
}
