'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Tabs } from '@/components/workbench/tabs';
import type { WorkbenchRow } from '@/lib/works';
import { attached, href, withAttached, type WorkbenchParams } from '@/lib/workbench-url';

// The left pane: a filterable list of works, notes, or axes. The 160 works are
// filtered in memory, so typing narrows the list instantly; the filter row is
// sticky under the tabs. Clicking a row selects it (the URL changes, the
// centre and right panes follow); pressing + on a work row attaches it to the
// note being written without changing the selection. Arrow keys move a
// highlight, Enter selects it.
//
// A green bar down a row's left edge means its citation is complete: author,
// publisher, place and year, by the rule in lib/citation.ts. "cited" shows
// only those.

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
  const [starred, setStarred] = useState(false);
  const [noPdf, setNoPdf] = useState(false);
  const [cited, setCited] = useState(false);
  const [active, setActive] = useState<number>(-1);
  const listRef = useRef<HTMLUListElement>(null);

  // Where she was in each book, so that leaving a work and coming back does
  // not lose her place.
  //
  // The page lives in the URL as `p`, and href() carries every key forward, so
  // selecting a different book used to apply the old book's page to the new
  // one — page 300 of Adorno becoming page 300 of Herrera, which has 140. The
  // page belongs to the work, not to the session, so the link clears `p` for a
  // book she has not opened and restores it for one she has.
  //
  // Session storage rather than the URL, which would have to carry every
  // book's page at once, and rather than the database, which would make a
  // scroll position durable across devices for no gain.
  const [lastPage, setLastPage] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem('scriptorium:pages');
      if (saved) setLastPage(JSON.parse(saved));
    } catch {
      // Private browsing, or storage disabled. Losing the place is survivable.
    }
  }, []);

  useEffect(() => {
    if (!params.w || !params.p) return;
    setLastPage((prev) => {
      if (prev[params.w!] === params.p) return prev;
      const next = { ...prev, [params.w!]: params.p! };
      try {
        window.sessionStorage.setItem('scriptorium:pages', JSON.stringify(next));
      } catch {
        // as above
      }
      return next;
    });
  }, [params.w, params.p]);

  const ws = attached(params);

  // The selected work is attached to the note implicitly, in the right pane:
  //
  //   const ids = ws.length > 0 ? ws : params.w ? [params.w] : [];
  //
  // So building the + link from the raw ws dropped it. Pressing + on a second
  // book wrote ws=<that book>, ws stopped being empty, the implicit fallback
  // stopped applying, and the work she was reading vanished from the note she
  // was writing about it. Attaching starts from the effective list instead.
  //
  // Order matters: NoteForm treats the first attachment as the one carrying
  // the quotation anchor and labels it "quote in …", so the selected work has
  // to stay at the head.
  const effective = ws.length > 0 ? ws : params.w ? [params.w] : [];

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (list && r.list_id !== list) return false;
      if (fileOnly && !r.has_file) return false;
      if (starred && (r.priority ?? 0) < 4) return false;
      if (noPdf && r.has_file) return false;
      if (cited && !r.citation_complete) return false;
      if (!needle) return true;
      return (
        r.title.toLowerCase().includes(needle) ||
        (r.author ?? '').toLowerCase().includes(needle) ||
        (r.code ?? '').toLowerCase().includes(needle) ||
        r.id.includes(needle)
      );
    });
  }, [rows, q, list, fileOnly, starred, noPdf, cited]);

  useEffect(() => { setActive(-1); }, [q, list, fileOnly, starred, noPdf, cited, pane]);

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
      router.push(href(params, {
        w: filtered[active].id,
        p: lastPage[filtered[active].id] ?? null,
        n: null,
        view: params.view === 'axes' || params.view === 'notes' ? params.view : null,
      }));
    }
  }

  const examinableCount = rows.filter((r) => r.examinable).length;

  return (
    <div className="flex h-full flex-col" onKeyDown={onKey}>
      <Tabs
        label="Left pane"
        activeId={pane}
        items={PANES.map((p) => ({
          id: p.id,
          label: p.label,
          href: href(params, { pane: p.id === 'catalogue' ? null : p.id }),
        }))}
      />

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
              <button
                type="button"
                onClick={() => setStarred((v) => !v)}
                className={`border px-2 py-0.5 ${starred ? 'border-accent text-accent' : 'border-rule text-muted hover:text-accent'}`}
                title="Rated four stars or more — the works she is leaning on"
              >
                ★★★★+
              </button>
              <button
                type="button"
                onClick={() => setNoPdf((v) => !v)}
                className={`border px-2 py-0.5 ${noPdf ? 'border-accent text-accent' : 'border-rule text-muted hover:text-accent'}`}
                title="No file recorded for the work"
              >
                no pdf
              </button>
              <button
                type="button"
                onClick={() => setCited((v) => !v)}
                className={`flex items-center gap-1 border px-2 py-0.5 ${cited ? 'border-accent text-accent' : 'border-rule text-muted hover:text-accent'}`}
                title="Citation complete: author, publisher, place and year all recorded"
              >
                <span aria-hidden="true" className="inline-block h-3 w-0.5 bg-green-700" />
                cited {rows.filter((r) => r.citation_complete).length}
              </button>
            </div>
            <p className="text-[11px] text-muted">
              {filtered.length} shown · {examinableCount} examinable
            </p>
          </div>

          <ul ref={listRef} className="min-h-0 flex-1 divide-y divide-rule overflow-y-auto" tabIndex={0}>
            {filtered.map((r, i) => {
              const selected = params.w === r.id && !params.n && !params.a;
              const isAttached = effective.includes(r.id);
              return (
                <li
                  key={r.id}
                  title={r.citation_complete ? 'Citation complete' : undefined}
                  className={`group flex items-start gap-2 border-l-2 py-1.5 pl-1.5 pr-1 text-xs ${
                    r.citation_complete ? 'border-green-700' : 'border-transparent'
                  } ${selected ? 'bg-white' : i === active ? 'bg-white/60' : ''}`}
                >
                  <Link
                    href={href(params, {
                      w: r.id,
                      p: r.id === params.w ? params.p ?? null : lastPage[r.id] ?? null,
                      n: null,
                      a: params.a ?? null,
                    })}
                    className={`min-w-0 flex-1 ${selected ? 'text-accent' : 'hover:text-accent'}`}
                  >
                    <span className="block truncate">
                      {r.priority ? (
                        <span className="text-accent" title={`${r.priority} of 5`}>
                          {'★'.repeat(r.priority)}{' '}
                        </span>
                      ) : null}
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
                    href={href(params, {
                      ws: withAttached(
                        params,
                        isAttached
                          ? effective.filter((x) => x !== r.id)
                          : [...effective, r.id],
                      ),
                    })}
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
          <p className="py-2 text-[11px] text-muted">
            <Link href={href(params, { a: 'new', n: null })} className="hover:text-accent">
              New axis →
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}
