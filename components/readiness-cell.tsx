import Link from 'next/link';

import { FILE_STATES, type FileState } from '@/lib/gaps';
import type { AidState, Preparation } from '@/lib/readiness';

// One work's cell in the readiness matrix, and the legend that explains it.
// Used by /readiness (by list and section) and by a project's page (its
// works). lib/readiness.ts says what the file state and the four marks mean.
//
// A cell opens the work in the workbench, and says in full, on hover and to
// a screen reader, what the marks say in short. No client code.

const FILE_LABEL = new Map(FILE_STATES.map((s) => [s.id, s.label]));

// The ground of a cell. Searchable is the finished state and reads as plain
// paper; anything still in the pipeline is tinted; no file at all is an
// outline, since there is nothing there yet.
function ground(file: FileState | null): string {
  if (file === null || file === 'searchable') return 'border-rule bg-white';
  if (file === 'no_pdf') return 'border-dashed border-muted text-muted';
  return 'border-rule bg-[#efe9df]';
}

function surname(item: Preparation): string {
  const who = item.author ?? item.editor;
  if (who) return who.split(',')[0].trim();
  return item.title;
}

function Mark({ on, half = false, label }: { on: boolean; half?: boolean; label: string }) {
  const cls = on ? 'bg-accent border-accent' : half ? 'border-accent' : 'border-rule';
  return (
    <span
      aria-hidden="true"
      title={label || undefined}
      className={`inline-block h-2 w-2 border ${cls}`}
    />
  );
}

function aidLabel(aid: AidState): string {
  if (aid === 'reviewed') return 'study aid reviewed';
  if (aid === 'draft') return 'study aid drafted, not reviewed';
  return 'no study aid';
}

function describe(item: Preparation, caption: string | null): string {
  const who = item.author ?? item.editor;
  return [
    caption,
    who ? `${who}, ${item.title}` : item.title,
    item.year !== null ? String(item.year) : null,
    item.file === null ? 'film' : FILE_LABEL.get(item.file) ?? item.file,
    item.has_notes ? 'has notes' : 'no notes',
    item.has_quotation ? 'has a quotation' : 'no quotation',
    item.in_axis ? 'in an axis' : 'in no axis',
    aidLabel(item.study_aid),
  ]
    .filter(Boolean)
    .join(' · ');
}

// caption is the small first line: the exam number on /readiness, the year
// on a project page, where a work may sit on no list.
export function ReadinessCell({ item, caption }: { item: Preparation; caption: string | null }) {
  const text = describe(item, caption);
  return (
    <Link
      href={`/?w=${encodeURIComponent(item.id)}`}
      title={text}
      aria-label={text}
      className={`block w-28 border px-1.5 py-1 hover:border-accent ${ground(item.file)}`}
    >
      <span className="block font-mono text-[10px] leading-tight text-muted">
        {caption ?? ' '}
      </span>
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

export function ReadinessLegend() {
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

export function tally(items: Preparation[]) {
  return {
    works: items.length,
    searchable: items.filter((i) => i.file === 'searchable').length,
    notes: items.filter((i) => i.has_notes).length,
    quoted: items.filter((i) => i.has_quotation).length,
    axis: items.filter((i) => i.in_axis).length,
    aid: items.filter((i) => i.study_aid === 'reviewed').length,
  };
}
