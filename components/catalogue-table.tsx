'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';

import { characterizeSelection } from '@/lib/actions';
import {
  PURPOSE_CODE,
  PURPOSE_LABEL,
  STANDING_LABEL,
  type Purpose,
  type Standing,
  type WorkKind,
} from '@/lib/types';

// The catalogue, with range selection and a bulk bar.
//
// The one client component in the application: shift-click needs browser state,
// and ticking 125 rows one at a time is a real cost. The mutation is still a
// Server Action — only the selecting happens here.
//
// One selection drives both jobs: characterize the ticked works, or build a
// works cited from them.

export interface Row {
  id: string;
  author: string | null;
  title: string;
  year: number | null;
  kind: WorkKind;
  container_title: string | null;
  status: string;
  purpose: Purpose;
  standing: Standing;
  examinable: boolean;
  source_format: string;
  missing: string[];
}

// What the file marker means, spelled out rather than left to a tooltip.
//
// The distinction that matters is not held against not held. It is citable
// against not citable: an EPUB reflows, so there is no page 87 to cite, and a
// row showing the same tick as a complete PDF hides that. Borderlands is the
// case in point — held, searchable, and useless for a footnote.
const FILE_MARK: Record<string, { mark: string; label: string; dim: boolean }> = {
  pdf_text: { mark: '✓', label: 'PDF — citable to a page', dim: false },
  pdf_ocr: { mark: '✓', label: 'Scanned PDF, OCR applied — citable to a page', dim: false },
  epub: { mark: '○', label: 'EPUB — searchable, no page numbers', dim: true },
  none: { mark: '', label: 'No file', dim: true },
};

// Distinct from every real value, so "leave alone" cannot be confused with a
// choice. A single "none" default meant one stray Apply wiped a field across a
// whole catalogue in Vivarium.
const NO_CHANGE = '__nochange__';

const PURPOSES: Purpose[] = ['comps', 'both', 'dissertation', 'unassigned'];
const STANDINGS: Standing[] = ['assigned', 'added', 'excluded'];

export function CatalogueTable({ rows }: { rows: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPurpose, setBulkPurpose] = useState<string>(NO_CHANGE);
  const [bulkStanding, setBulkStanding] = useState<string>(NO_CHANGE);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A ref, not state: read during a click, never rendered, and state would
  // rerender every row on each tick.
  const anchorRef = useRef<string | null>(null);

  function toggle(id: string, shift: boolean) {
    // Read the anchor BEFORE setSelected. The updater does not run until React
    // re-renders, by which time the assignment below has already overwritten
    // the ref — which makes every shift-click a range from a row to itself.
    const anchor = anchorRef.current;

    setSelected((prev) => {
      const next = new Set(prev);
      const turningOn = !prev.has(id);

      if (shift && anchor !== null && anchor !== id) {
        const a = rows.findIndex((r) => r.id === anchor);
        const b = rows.findIndex((r) => r.id === id);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) {
            if (turningOn) next.add(rows[i].id);
            else next.delete(rows[i].id);
          }
          return next;
        }
      }

      if (turningOn) next.add(id);
      else next.delete(id);
      return next;
    });

    anchorRef.current = id;
  }

  function toggleAll() {
    setSelected((prev) => {
      const all = rows.length > 0 && rows.every((r) => prev.has(r.id));
      return all ? new Set<string>() : new Set(rows.map((r) => r.id));
    });
    anchorRef.current = null;
  }

  const wouldChange = bulkPurpose !== NO_CHANGE || bulkStanding !== NO_CHANGE;

  function apply() {
    const ids = [...selected];
    if (!ids.length || !wouldChange) return;

    startTransition(async () => {
      const { updated } = await characterizeSelection(ids, {
        purpose: bulkPurpose === NO_CHANGE ? undefined : (bulkPurpose as Purpose),
        standing: bulkStanding === NO_CHANGE ? undefined : (bulkStanding as Standing),
      });
      setNote(`${updated} updated`);
      setSelected(new Set());
      setBulkPurpose(NO_CHANGE);
      setBulkStanding(NO_CHANGE);
      anchorRef.current = null;
    });
  }

  const worksCitedHref =
    '/works-cited?' + [...selected].map((id) => `id=${encodeURIComponent(id)}`).join('&');
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-auto" />
          Select all {rows.length}
        </label>
        <span>Tick a row, then shift-click another to take everything between.</span>
        <span className="ml-auto">
          <span className="text-accent">✓</span> citable · <span>○</span> no page
          numbers · blank: no file
        </span>
        {note ? <span className="text-accent">{note}</span> : null}
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border border-accent/40 bg-background px-3 py-2 text-sm">
          <span>{selected.size} selected</span>

          <label className="flex items-center gap-2">
            Purpose
            <select value={bulkPurpose} onChange={(e) => setBulkPurpose(e.target.value)} className="w-52">
              <option value={NO_CHANGE}>— no change —</option>
              {PURPOSES.map((p) => (
                <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            Standing
            <select value={bulkStanding} onChange={(e) => setBulkStanding(e.target.value)} className="w-64">
              <option value={NO_CHANGE}>— no change —</option>
              {STANDINGS.map((s) => (
                <option key={s} value={s}>{STANDING_LABEL[s]}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={apply}
            disabled={pending || !wouldChange}
            className="border border-accent px-3 py-1 text-sm text-accent hover:bg-accent hover:text-background disabled:opacity-50"
          >
            {pending ? 'Applying…' : 'Apply'}
          </button>

          <a href={worksCitedHref} className="text-sm text-accent hover:underline">
            Works cited
          </a>

          <button
            type="button"
            onClick={() => { setSelected(new Set()); anchorRef.current = null; }}
            className="text-muted hover:text-accent"
          >
            Clear
          </button>
        </div>
      ) : null}

      <ul className="divide-y divide-rule border-y border-rule">
        {rows.map((row) => (
          <li key={row.id} className={`py-3 ${selected.has(row.id) ? 'bg-accent/5' : ''}`}>
            <div className="flex items-baseline gap-3">
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                // onChange does not carry shiftKey, so the work happens in
                // onClick; this exists to keep React from warning.
                onChange={() => {}}
                onClick={(e) => toggle(row.id, e.shiftKey)}
                className="mt-1 w-auto shrink-0"
              />

              <div className="flex-1">
                <div className="flex items-baseline justify-between gap-4">
                  <Link href={`/works/${row.id}`} className="hover:text-accent">
                    {(() => {
                      const f = FILE_MARK[row.source_format] ?? FILE_MARK.none;
                      return f.mark ? (
                        <span
                          title={f.label}
                          className={f.dim ? 'text-muted' : 'text-accent'}
                        >
                          {f.mark}{' '}
                        </span>
                      ) : null;
                    })()}
                    {row.author ?? '—'}
                    {'. '}
                    {row.container_title ? (
                      <>
                        <span>“{row.title}”</span>
                        <span className="text-muted"> in </span>
                        <span className="italic text-muted">{row.container_title}</span>
                      </>
                    ) : (
                      <span className="italic">{row.title}</span>
                    )}
                    {row.year ? <span className="text-muted"> ({row.year})</span> : null}
                  </Link>

                  <span className="flex shrink-0 items-baseline gap-3 font-mono text-xs text-muted">
                    {row.kind !== 'monograph' ? <span>{row.kind.replace('_', ' ')}</span> : null}
                    <span
                      title={PURPOSE_LABEL[row.purpose]}
                      className={row.purpose === 'unassigned' ? 'text-accent' : ''}
                    >
                      {PURPOSE_CODE[row.purpose]}
                    </span>
                    {row.standing !== 'assigned' ? (
                      <span title={STANDING_LABEL[row.standing]} className="text-accent">
                        {row.standing === 'excluded' ? '✕' : '+'}
                      </span>
                    ) : null}
                    <span>{row.status}</span>
                  </span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
