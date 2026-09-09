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
} from '@/lib/types';

// The catalogue, with range selection and a bulk bar.
//
// This is the one client component in the application. Shift-click needs
// browser state, and eighty-five rows of one-at-a-time ticking is a real cost.
// The mutation stays a Server Action — only the selecting happens here.
//
// The selection drives both jobs: characterize the ticked books, or build a
// works cited from them. One set of checkboxes rather than two columns.

export interface Row {
  id: string;
  author: string | null;
  title: string;
  year: number | null;
  status: string;
  purpose: Purpose;
  standing: Standing;
  has_file: boolean;
  missing: string[];
}

// Distinct from any real value, so "leave alone" cannot be confused with a
// choice. Vivarium learned this the hard way: a single "none" default meant one
// stray Apply wiped a field across the whole catalogue.
const NO_CHANGE = '__nochange__';

const PURPOSES: Purpose[] = ['comps', 'both', 'dissertation', 'unassigned'];
const STANDINGS: Standing[] = ['assigned', 'added', 'excluded'];

export function CatalogueTable({ rows }: { rows: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPurpose, setBulkPurpose] = useState<string>(NO_CHANGE);
  const [bulkStanding, setBulkStanding] = useState<string>(NO_CHANGE);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The anchor for shift-click. A ref rather than state: it is read during a
  // click, never rendered, and putting it in state would rerender every row on
  // each tick.
  const anchorRef = useRef<string | null>(null);

  function toggle(id: string, shift: boolean) {
    // Read the anchor BEFORE setSelected. The updater does not run until React
    // re-renders, by which time the assignment at the end of this function has
    // already overwritten the ref — which makes every shift-click a range from
    // the clicked row to itself.
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
        standing:
          bulkStanding === NO_CHANGE ? undefined : (bulkStanding as Standing),
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
      <div className="flex flex-wrap items-baseline gap-3 text-xs text-muted">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="w-auto"
          />
          Select all {rows.length}
        </label>
        <span>Tick a row, then shift-click another to take everything between.</span>
        {note ? <span className="text-accent">{note}</span> : null}
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border border-accent/40 bg-background px-3 py-2 text-sm">
          <span>{selected.size} selected</span>

          <label className="flex items-center gap-2">
            Purpose
            <select
              value={bulkPurpose}
              onChange={(e) => setBulkPurpose(e.target.value)}
              className="w-52"
            >
              <option value={NO_CHANGE}>— no change —</option>
              {PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {PURPOSE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            Standing
            <select
              value={bulkStanding}
              onChange={(e) => setBulkStanding(e.target.value)}
              className="w-64"
            >
              <option value={NO_CHANGE}>— no change —</option>
              {STANDINGS.map((s) => (
                <option key={s} value={s}>
                  {STANDING_LABEL[s]}
                </option>
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
            onClick={() => {
              setSelected(new Set());
              anchorRef.current = null;
            }}
            className="text-muted hover:text-accent"
          >
            Clear
          </button>
        </div>
      ) : null}

      <ul className="divide-y divide-rule border-y border-rule">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`py-3 ${selected.has(row.id) ? 'bg-accent/5' : ''}`}
          >
            <div className="flex items-baseline gap-3">
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                // onChange does not carry shiftKey, so the work happens in
                // onClick and this exists only to keep React from warning about
                // an uncontrolled input.
                onChange={() => {}}
                onClick={(e) => toggle(row.id, e.shiftKey)}
                className="mt-1 w-auto shrink-0"
              />

              <div className="flex-1">
                <div className="flex items-baseline justify-between gap-4">
                  <Link href={`/books/${row.id}`} className="hover:text-accent">
                    {row.has_file ? <span className="text-accent">✓ </span> : null}
                    {row.author ?? '—'}
                    {'. '}
                    <span className="italic">{row.title}</span>
                    {row.year ? <span className="text-muted"> ({row.year})</span> : null}
                  </Link>

                  <span className="flex shrink-0 items-baseline gap-3 font-mono text-xs text-muted">
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

                {row.missing.length > 0 ? (
                  <p className="mt-1 text-xs text-accent">
                    missing: {row.missing.join(', ')}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
