'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { WorkbenchRow } from '@/lib/works';
import { attached, href, withAttached, type WorkbenchParams } from '@/lib/workbench-url';

// The left pane: a filterable list of works, notes, or axes. The 160 works are
// filtered in memory, so typing narrows the list instantly; the filter row is
// sticky under the tabs. Clicking a row selects it (the URL changes, the
// centre and right panes follow); pressing + on a work row attaches it to the
// note being written without changing the selection. Arrow keys move a
// highlight, Enter selects it.

export interface LeftAxis { id: number; title: string | null; ficha_count: number; reviewed: boolean }
export interface LeftNote { id: number; kind: string; title: string | null; body: string; reviewed: boolean; origin: string; attribution: string | null }
export interface LeftList { id: string; name: string; short: string; examinable: boolean }

const PANES = [
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'notes', label: 'Notes' },
  { id: 'axes', label: 'Axes' },
] as const;

export function LeftPane({
  params,
  rows,
  lists,
  axes,
  notes,
  counts,
}: {
  params: WorkbenchParams;
  rows: WorkbenchRow[];
  lists: LeftList[];
  axes: LeftAxis[];
  notes: LeftNote[];
  counts: { proposals: number; unclassified: number; unsupported: number; questions: number };
}) {
  const router = useRouter();
  const pane = params.pane ?? 'catalogue';
  const [q, setQ] = useState('');
  const [list, setList] = useState<string | null>(null);
  const [fileOnly, setFileOnly] = useState(false);
  const [active, setActive] = useState<number>(-1);
  const listRef = useRef<HTMLUListElement>(null);

  const ws = attached(params);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (list && r.list_id !== list) return false;
      if (fileOnly && !r.has_file) return false;
      if (!needle) return true;
      return (
        r.title.toLowerCase().includes(needle) ||
        (r.author ?? '').toLowerCase().includes(needle) ||
        (r.code ?? '').toLowerCase().includes(needle) ||
        r.id.includes(needle)
      );
    });
  }, [rows, q, list, fileOnly]);

  useEffect(() => { setActive(-1); }, [q, list, fileOnly, pane]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const el = listRef.current.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onKey(e: React.KeyboardEvent) {
    if (pane !== 'catalogue') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      router.push(href(params, { w: filtered[active].id, n: null, view: params.view === 'axes' || params.view === 'notes' ? params.view : null }));
    }
  }

  const examinableCount = rows.filter((r) => r.examinable).length;

  return (
    <div className="flex h-full flex-col" onKeyDown={onKey}>
      <nav className="flex gap-3 border-b border-rule pb-2 text-sm">
        {PANES.map((p) => (
          <Link
            key={p.id}
            href={href(params, { pane: p.id === 'catalogue' ? null : p.id })}
            className={pane === p.id ? 'text-accent' : 'text-muted hover:text-accent'}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      {pane === 'catalogue' ? (
        <>
          <div className="sticky top-0 z-10 space-y-2 border-b border-rule bg-background py-2">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="author, title, or code"
              aria-label="Filter works"
            />
            <div className="flex flex-wrap gap-1 text-xs">
              <button
                type="button"
                onClick={() => setList(null)}
                className={`border px-2 py-0.5 ${list === null ? 'border-accent text-accent' : 'border-rule text-muted hover:text-accent'}`}
              >
                All {rows.length}
              </button>
              {lists.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setList(list === l.id ? null : l.id)}
                  className={`border px-2 py-0.5 ${list === l.id ? 'border-accent text-accent' : 'border-rule text-muted hover:text-accent'}`}
                  title={l.name}
                >
                  {l.short}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFileOnly((v) => !v)}
                className={`border px-2 py-0.5 ${fileOnly ? 'border-accent text-accent' : 'border-rule text-muted hover:text-accent'}`}
              >
                has file
              </button>
            </div>
            <p className="text-[11px] text-muted">
              {filtered.length} shown · {examinableCount} examinable
            </p>
          </div>

          <ul ref={listRef} className="min-h-0 flex-1 divide-y divide-rule overflow-y-auto" tabIndex={0}>
            {filtered.map((r, i) => {
              const selected = params.w === r.id && !params.n && !params.a;
              const isAttached = ws.includes(r.id);
              return (
                <li
                  key={r.id}
                  className={`group flex items-start gap-2 py-1.5 pr-1 text-xs ${
                    selected ? 'bg-white' : i === active ? 'bg-white/60' : ''
                  }`}
                >
                  <Link
                    href={href(params, { w: r.id, n: null, a: params.a ?? null })}
                    className={`min-w-0 flex-1 ${selected ? 'text-accent' : 'hover:text-accent'}`}
                  >
                    <span className="block truncate">
                      {r.author ?? '—'}
                      {r.year !== null ? <span className="text-muted"> {r.year}</span> : null}
                    </span>
                    <span className="block truncate italic">{r.title}</span>
                    <span className="block text-[11px] text-muted">
                      {r.code ? `[${r.code}]` : r.standing === 'added' ? 'added' : r.list_id ?? '—'}
                      {r.has_file ? ' · file' : ''}
                      {r.note_count > 0 ? ` · ${r.note_count} ${r.note_count === 1 ? 'note' : 'notes'}` : ''}
                    </span>
                  </Link>
                  <Link
                    href={href(params, { ws: withAttached(params, isAttached ? ws.filter((x) => x !== r.id) : [...ws, r.id]) })}
                    className={`mt-0.5 shrink-0 px-1 text-base leading-none ${
                      isAttached ? 'text-accent' : 'text-muted opacity-0 hover:text-accent group-hover:opacity-100'
                    }`}
                    aria-label={isAttached ? 'Detach from note' : 'Attach to note'}
                    title={isAttached ? 'Attached to the note being written' : 'Attach to the note being written'}
                  >
                    {isAttached ? '✓' : '+'}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {pane === 'notes' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="space-y-0.5 border-b border-rule py-2 text-xs">
            <li><Link href="/notes?filter=proposals" className={counts.proposals ? 'text-accent hover:underline' : 'text-muted hover:text-accent'}>proposals from Claude ({counts.proposals})</Link></li>
            <li><Link href="/notes?filter=unclassified" className={counts.unclassified ? 'text-accent hover:underline' : 'text-muted hover:text-accent'}>whose claim? ({counts.unclassified})</Link></li>
            <li><Link href="/notes?filter=unsupported" className={counts.unsupported ? 'text-accent hover:underline' : 'text-muted hover:text-accent'}>no passage behind it ({counts.unsupported})</Link></li>
            <li><Link href="/notes?filter=questions" className="text-muted hover:text-accent">open questions ({counts.questions})</Link></li>
          </ul>
          <ul className="divide-y divide-rule">
            {notes.map((n) => (
              <li key={n.id} className={`py-1.5 text-xs ${params.n === String(n.id) ? 'bg-white' : ''}`}>
                <Link href={href(params, { n: String(n.id), a: null })} className={params.n === String(n.id) ? 'text-accent' : 'hover:text-accent'}>
                  {n.title ? <span className="block font-medium">{n.title}</span> : null}
                  <span className="block line-clamp-2">{n.body}</span>
                  <span className="block text-[11px] text-muted">
                    {n.kind !== 'note' ? `${n.kind} · ` : ''}
                    {n.origin === 'assistant' && !n.reviewed ? 'proposal' : n.attribution ?? 'whose claim?'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="py-2 text-[11px] text-muted">Most recent 40. <Link href="/notes" className="hover:text-accent">All notes →</Link></p>
        </div>
      ) : null}

      {pane === 'axes' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-rule">
            {axes.map((ax) => (
              <li key={ax.id} className={`py-1.5 text-xs ${params.a === String(ax.id) ? 'bg-white' : ''}`}>
                <Link href={href(params, { a: String(ax.id), n: null })} className={params.a === String(ax.id) ? 'text-accent' : 'hover:text-accent'}>
                  <span className="block">{ax.title}</span>
                  <span className="block text-[11px] text-muted">
                    {ax.ficha_count} {ax.ficha_count === 1 ? 'ficha' : 'fichas'}
                    {ax.reviewed ? '' : ' · proposal'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="py-2 text-[11px] text-muted"><Link href="/axes" className="hover:text-accent">New axis →</Link></p>
        </div>
      ) : null}
    </div>
  );
}
