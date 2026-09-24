import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { examNumber } from '@/lib/exam-number';
import { FILE_STATES, type FileState } from '@/lib/gaps';
import { readinessItems, type AidState, type ReadinessItem } from '@/lib/readiness';
import { listExamLists, listSections } from '@/lib/works';

export const dynamic = 'force-dynamic';

// The readiness matrix: the examinable lists, section by section, one cell per
// item, so that the works she would meet in the exam with nothing prepared
// can be seen on one screen.
//
// A cell carries two things (lib/readiness.ts says why they are separate):
// the file, as the cell's ground, and four marks for preparation. Every cell
// opens the work in the workbench, and says in full, on hover and to a screen
// reader, what the marks say in short.
//
// Server-rendered HTML with no client code and no D3: a grid of links is what
// this is, and the browser draws it without help.

const FILE_LABEL = new Map(FILE_STATES.map((s) => [s.id, s.label]));

// The ground of a cell. Searchable is the finished state and reads as plain
// paper; anything still in the pipeline is tinted; no file at all is an
// outline, since there is nothing there yet.
function ground(file: FileState | null): string {
  if (file === null) return 'border-rule bg-white';
  if (file === 'searchable') return 'border-rule bg-white';
  if (file === 'no_pdf') return 'border-dashed border-muted text-muted';
  return 'border-rule bg-[#efe9df]';
}

function surname(item: ReadinessItem): string {
  const who = item.author ?? item.editor;
  if (who) return who.split(',')[0].trim();
  return item.title;
}

function Mark({ on, half = false, label }: { on: boolean; half?: boolean; label: string }) {
  const cls = on
    ? 'bg-accent border-accent'
    : half
      ? 'border-accent'
      : 'border-rule';
  return <span aria-hidden="true" title={label} className={`inline-block h-2 w-2 border ${cls}`} />;
}

function aidLabel(aid: AidState): string {
  if (aid === 'reviewed') return 'study aid reviewed';
  if (aid === 'draft') return 'study aid drafted, not reviewed';
  return 'no study aid';
}

function describe(item: ReadinessItem, code: string | null): string {
  const parts = [
    code,
    `${item.author ?? item.editor ?? ''}${item.author || item.editor ? ', ' : ''}${item.title}`,
    item.file === null ? 'film' : FILE_LABEL.get(item.file) ?? item.file,
    item.has_notes ? 'has notes' : 'no notes',
    item.has_quotation ? 'has a quotation' : 'no quotation',
    item.in_axis ? 'in an axis' : 'in no axis',
    aidLabel(item.study_aid),
  ];
  return parts.filter(Boolean).join(' · ');
}

function Cell({ item, code }: { item: ReadinessItem; code: string | null }) {
  const text = describe(item, code);
  return (
    <Link
      href={`/?w=${encodeURIComponent(item.id)}`}
      title={text}
      aria-label={text}
      className={`block w-28 border px-1.5 py-1 hover:border-accent ${ground(item.file)}`}
    >
      <span className="block font-mono text-[10px] leading-tight text-muted">{code ?? ' '}</span>
      <span className="block truncate text-xs leading-snug">{surname(item)}</span>
      <span className="mt-1 flex gap-1">
        <Mark on={item.has_notes} label="notes" />
        <Mark on={item.has_quotation} label="quotation" />
        <Mark on={item.in_axis} label="axis" />
        <Mark
          on={item.study_aid === 'reviewed'}
          half={item.study_aid === 'draft'}
          label="study aid"
        />
      </span>
    </Link>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-muted">
      <div className="space-y-1">
        <p className="uppercase tracking-wide">The cell: the file</p>
        <p className="flex items-center gap-2">
          <span className="inline-block h-3 w-5 border border-rule bg-white" /> searchable
        </p>
        <p className="flex items-center gap-2">
          <span className="inline-block h-3 w-5 border border-rule bg-[#efe9df]" /> held, numbering
          to settle, or loaded: not yet searchable
        </p>
        <p className="flex items-center gap-2">
          <span className="inline-block h-3 w-5 border border-dashed border-muted" /> no PDF
        </p>
      </div>
      <div className="space-y-1">
        <p className="uppercase tracking-wide">The marks, left to right</p>
        <p className="flex items-center gap-2">
          <span className="flex gap-1">
            <Mark on label="" />
            <Mark on={false} label="" />
            <Mark on={false} label="" />
            <Mark on={false} half label="" />
          </span>
          notes · a quotation · in an axis · study aid
        </p>
        <p>
          Filled: yes. Empty: not yet. An outlined last mark is a study aid drafted
          and not yet reviewed.
        </p>
        <p>Counts only notes you have written or accepted; proposals waiting for you do not.</p>
      </div>
    </div>
  );
}

function tally(items: ReadinessItem[]) {
  return {
    works: items.length,
    searchable: items.filter((i) => i.file === 'searchable').length,
    notes: items.filter((i) => i.has_notes).length,
    quoted: items.filter((i) => i.has_quotation).length,
    axis: items.filter((i) => i.in_axis).length,
    aid: items.filter((i) => i.study_aid === 'reviewed').length,
  };
}

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

      <Legend />

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
                      <Cell
                        key={`${item.id}-${item.section_id}`}
                        item={item}
                        code={examNumber(list.id, row.section, item.ordinal)}
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
