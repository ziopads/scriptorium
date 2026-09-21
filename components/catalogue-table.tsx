'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { Stars } from '@/components/stars';
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
  priority: number | null;
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
// Distinct again from NO_CHANGE: clearing a rating is a real instruction, and
// null is the value it writes.
const CLEAR_RATING = '__clear__';

const PURPOSES: Purpose[] = ['comps', 'both', 'dissertation', 'unassigned'];
const STANDINGS: Standing[] = ['assigned', 'added', 'excluded'];

// The selection is kept in session storage, so it survives a search, the filter
// links above the table (which reload the page), a reload, and a visit to a
// work page. It lasts until cleared, applied, or the tab is closed.
const SELECTION_KEY = 'scriptorium:catalogue-selection';

// Lowercased, accents removed: "anzaldua" finds Anzaldúa.
function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function CatalogueTable({ rows }: { rows: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPurpose, setBulkPurpose] = useState<string>(NO_CHANGE);
  const [bulkStanding, setBulkStanding] = useState<string>(NO_CHANGE);
  const [bulkRating, setBulkRating] = useState<string>(NO_CHANGE);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Ratings changed here since the page was rendered, so the filter and the
  // sort follow a click immediately rather than waiting for a refetch.
  const [rated, setRated] = useState<Map<string, number | null>>(new Map());
  const [minStars, setMinStars] = useState<number | null>(null);
  const [unratedOnly, setUnratedOnly] = useState(false);
  const [byRating, setByRating] = useState(false);
  const [query, setQuery] = useState('');
  const [showSelected, setShowSelected] = useState(false);

  // Read the saved selection once, after the first render: session storage does
  // not exist on the server, and reading it during render would make the server
  // and browser disagree. Writing waits for the read, so an empty first render
  // cannot overwrite what was saved.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SELECTION_KEY);
      if (raw) setSelected(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Unreadable or unavailable storage: start with nothing selected.
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      if (selected.size > 0) {
        sessionStorage.setItem(SELECTION_KEY, JSON.stringify([...selected]));
      } else {
        sessionStorage.removeItem(SELECTION_KEY);
      }
    } catch {
      // The selection still works for this page; it just will not persist.
    }
  }, [selected, restored]);

  function priorityOf(row: Row): number | null {
    return rated.has(row.id) ? rated.get(row.id)! : row.priority;
  }

  // What is on screen. Shift-click ranges and select-all follow this rather
  // than the full list, so a range never reaches a row she cannot see.
  const visible = useMemo(() => {
    const needle = fold(query.trim());
    const kept = rows.filter((r) => {
      if (showSelected && !selected.has(r.id)) return false;
      if (
        needle &&
        !fold(`${r.author ?? ''} ${r.title} ${r.container_title ?? ''} ${r.id}`).includes(needle)
      ) {
        return false;
      }
      const p = rated.has(r.id) ? rated.get(r.id)! : r.priority;
      if (unratedOnly) return p === null;
      if (minStars !== null) return p !== null && p >= minStars;
      return true;
    });
    if (!byRating) return kept;
    return [...kept].sort((a, b) => {
      const pa = (rated.has(a.id) ? rated.get(a.id)! : a.priority) ?? -1;
      const pb = (rated.has(b.id) ? rated.get(b.id)! : b.priority) ?? -1;
      return pb - pa;
    });
  }, [rows, rated, minStars, unratedOnly, byRating, query, showSelected, selected]);

  // Selected works not on screen, so Apply never changes a book she cannot
  // account for: those hidden by the search or the rating filters, and those
  // outside the list or filter the page was loaded with.
  const visibleIds = new Set(visible.map((r) => r.id));
  const rowIds = new Set(rows.map((r) => r.id));
  const hiddenHere = [...selected].filter((id) => rowIds.has(id) && !visibleIds.has(id)).length;
  const elsewhere = [...selected].filter((id) => !rowIds.has(id)).length;

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
        const a = visible.findIndex((r) => r.id === anchor);
        const b = visible.findIndex((r) => r.id === id);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) {
            if (turningOn) next.add(visible[i].id);
            else next.delete(visible[i].id);
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
      const all = visible.length > 0 && visible.every((r) => prev.has(r.id));
      return all ? new Set<string>() : new Set(visible.map((r) => r.id));
    });
    anchorRef.current = null;
  }

  const wouldChange =
    bulkPurpose !== NO_CHANGE || bulkStanding !== NO_CHANGE || bulkRating !== NO_CHANGE;

  function apply() {
    const ids = [...selected];
    if (!ids.length || !wouldChange) return;

    startTransition(async () => {
      const { updated } = await characterizeSelection(ids, {
        purpose: bulkPurpose === NO_CHANGE ? undefined : (bulkPurpose as Purpose),
        standing: bulkStanding === NO_CHANGE ? undefined : (bulkStanding as Standing),
        ...(bulkRating === NO_CHANGE
          ? {}
          : { priority: bulkRating === CLEAR_RATING ? null : Number(bulkRating) }),
      });

      if (bulkRating !== NO_CHANGE) {
        const value = bulkRating === CLEAR_RATING ? null : Number(bulkRating);
        setRated((prev) => {
          const next = new Map(prev);
          for (const id of ids) next.set(id, value);
          return next;
        });
      }

      setNote(`${updated} updated`);
      setSelected(new Set());
      setShowSelected(false);
      setBulkPurpose(NO_CHANGE);
      setBulkStanding(NO_CHANGE);
      setBulkRating(NO_CHANGE);
      anchorRef.current = null;
    });
  }

  const worksCitedHref =
    '/works-cited?' + [...selected].map((id) => `id=${encodeURIComponent(id)}`).join('&');
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by author, title or identifier"
        aria-label="Search the catalogue"
        className="w-full text-sm"
      />

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-auto" />
          Select all {visible.length}
        </label>
        <span>Tick a row, then shift-click another to take everything between.</span>
        <span className="ml-auto">
          <span className="text-accent">✓</span> citable · <span>○</span> no page
          numbers · blank: no file
        </span>
        {note ? <span className="text-accent">{note}</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="pr-1 text-muted">Rated</span>
        {[5, 4, 3].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              setUnratedOnly(false);
              setMinStars(minStars === n ? null : n);
            }}
            className={`border px-2 py-0.5 ${
              minStars === n ? 'border-accent text-accent' : 'border-rule text-muted hover:text-accent'
            }`}
          >
            {'★'.repeat(n)}
            {n < 5 ? '+' : ''}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setMinStars(null);
            setUnratedOnly((v) => !v);
          }}
          className={`border px-2 py-0.5 ${
            unratedOnly ? 'border-accent text-accent' : 'border-rule text-muted hover:text-accent'
          }`}
          title="The works she has not characterised yet — the list to work down"
        >
          not yet rated
        </button>
        <button
          type="button"
          onClick={() => setByRating((v) => !v)}
          className={`border px-2 py-0.5 ${
            byRating ? 'border-accent text-accent' : 'border-rule text-muted hover:text-accent'
          }`}
        >
          sort by rating
        </button>
        {minStars !== null || unratedOnly || byRating || query ? (
          <button
            type="button"
            onClick={() => {
              setMinStars(null);
              setUnratedOnly(false);
              setByRating(false);
              setQuery('');
            }}
            className="px-2 py-0.5 text-muted hover:text-accent"
          >
            clear
          </button>
        ) : null}
        <span className="ml-auto text-muted">
          {visible.length} of {rows.length}
        </span>
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border border-accent/40 bg-background px-3 py-2 text-sm">
          <span>
            {selected.size} selected
            {hiddenHere > 0 ? (
              <span className="text-accent"> · {hiddenHere} hidden by the search or filters</span>
            ) : null}
            {elsewhere > 0 ? (
              <span className="text-accent">
                {' '}· {elsewhere} outside this list or filter (open All lists to see them)
              </span>
            ) : null}
          </span>

          <button
            type="button"
            onClick={() => setShowSelected((v) => !v)}
            className={`text-sm ${showSelected ? 'text-accent' : 'text-muted hover:text-accent'}`}
          >
            {showSelected ? 'Show all' : 'Show selected'}
          </button>

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

          <label className="flex items-center gap-2">
            Rating
            <select value={bulkRating} onChange={(e) => setBulkRating(e.target.value)} className="w-40">
              <option value={NO_CHANGE}>— no change —</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={String(n)}>{'★'.repeat(n)}</option>
              ))}
              <option value={CLEAR_RATING}>clear the rating</option>
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
              setShowSelected(false);
              anchorRef.current = null;
            }}
            className="text-muted hover:text-accent"
          >
            Clear
          </button>
        </div>
      ) : null}

      <ul className="divide-y divide-rule border-y border-rule">
        {visible.map((row) => (
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
                    <Stars
                      id={row.id}
                      value={priorityOf(row)}
                      onChanged={(v) =>
                        setRated((prev) => new Map(prev).set(row.id, v))
                      }
                    />
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
