// The motif strip: where in each book a theme or a word turns up. Read by
// app/search/page.tsx.
//
// One row per work with at least one hit, the row the length of the book
// from its first printed page to its last, a mark at each hit. Two modes
// (lib/search.ts): by word, every chunk carrying one of the forms, the mark
// darker for more occurrences; by meaning, the MEANING_K chunks closest to the
// question, darker for a closer match. Rows are grouped by the first exam list
// a work sits on, lists in their printed order, then works outside the lists,
// and within a group ordered by number of hits.
//
// A mark sits at its chunk's printed pages, so it can be off by the page or
// two a chunk spans. Page numbers carry the asterisk by the app's one rule
// (lib/page-verified.ts); a work whose numbering was never checked says so
// on its row, since its pages are not citations.

import { db } from '@/lib/db';
import { isUnverified, pageLabel } from '@/lib/page-verified';
import {
  WORD_LIMIT,
  fold,
  nearestChunks,
  wordChunks,
  wordForms,
  type ChunkRow,
  type WordRow,
} from '@/lib/search';

export type MotifMode = 'words' | 'meaning';

export const MEANING_K = 200;

export interface MotifMark {
  start: number;
  end: number;
  pages_label: string;
  weight: number; // 0..1, drawn as darkness
  detail: string; // "3 occurrences" or "similarity 0.52"
  excerpt: string;
}

export interface MotifRow {
  id: string;
  author: string | null;
  title: string;
  year: number | null;
  list_id: string | null;
  list_name: string | null;
  first: number;
  last: number;
  unverified: boolean;
  unchecked: boolean;
  hits: number; // occurrences (words) or passages (meaning)
  marks: MotifMark[];
}

export interface MotifResult {
  mode: MotifMode;
  forms: string[];
  rows: MotifRow[];
  passages: number;
  capped: boolean;
  error: string | null;
}

// A line of the chunk around the first match, or its opening.
function excerpt(text: string, forms: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (forms.length > 0) {
    const folded = fold(flat);
    const at = Math.min(
      ...forms.map((f) => folded.indexOf(f)).filter((i) => i >= 0),
      Number.POSITIVE_INFINITY,
    );
    if (Number.isFinite(at)) {
      const from = Math.max(0, at - 70);
      return `${from > 0 ? '…' : ''}${flat.slice(from, at + 110)}…`;
    }
  }
  return flat.length > 180 ? `${flat.slice(0, 180)}…` : flat;
}

type WorkMeta = {
  id: string;
  year: number | null;
  first: number | null;
  last: number | null;
  list_id: string | null;
  list_name: string | null;
  list_sort: number | null;
};

async function worksMeta(ids: string[]): Promise<Map<string, WorkMeta>> {
  if (ids.length === 0) return new Map();
  const rows = (await db()`
    select w.id, w.year, b.first, b.last, m.list_id, m.list_name, m.list_sort
    from works w
    left join lateral (
      select min(pp.printed_page) filter (where pp.printed_page >= 1) as first,
             max(pp.printed_page) as last
      from printed_pages pp where pp.work_id = w.id
    ) b on true
    left join lateral (
      select el.id as list_id, el.name as list_name, el.sort as list_sort
      from list_items li join exam_lists el on el.id = li.list_id
      where li.work_id = w.id or li.work_id = w.container_id
      order by el.sort limit 1
    ) m on true
    where w.id = any(${ids}::text[])
  `) as WorkMeta[];
  return new Map(rows.map((r) => [r.id, r]));
}

export async function motif(args: {
  mode: MotifMode;
  query: string;
  works: string[] | null;
}): Promise<MotifResult> {
  const { mode, query, works } = args;
  const empty = { mode, rows: [], passages: 0, capped: false };

  let chunks: (ChunkRow | WordRow)[] = [];
  let forms: string[] = [];
  if (mode === 'words') {
    const parsed = wordForms(query);
    forms = parsed.forms;
    if (forms.length === 0) return { ...empty, forms, error: 'Give a word, or several separated by commas.' };
    chunks = await wordChunks({ patterns: parsed.patterns, works, front: false });
  } else {
    if (!query.trim()) return { ...empty, forms, error: 'Give a theme or a question.' };
    try {
      chunks = await nearestChunks({ query, works, lang: null, k: MEANING_K, front: false });
    } catch (err) {
      return { ...empty, forms, error: `The question could not be embedded (${(err as Error).message}).` };
    }
  }

  const meta = await worksMeta([...new Set(chunks.map((c) => c.work_id))]);

  // Darkness: occurrences against the most in any one chunk, square-rooted so
  // one dense passage does not wash out the rest; or similarity stretched over
  // the range this search returned.
  const weigh =
    mode === 'words'
      ? (() => {
          const most = Math.max(1, ...chunks.map((c) => (c as WordRow).hits));
          return (c: ChunkRow | WordRow) => Math.sqrt((c as WordRow).hits / most);
        })()
      : (() => {
          const scores = chunks.map((c) => Number((c as ChunkRow).score));
          const lo = Math.min(...scores);
          const hi = Math.max(...scores);
          return (c: ChunkRow | WordRow) =>
            hi > lo ? (Number((c as ChunkRow).score) - lo) / (hi - lo) : 1;
        })();

  const byWork = new Map<string, MotifRow>();
  for (const c of chunks) {
    const m = meta.get(c.work_id);
    const unverified = isUnverified(c.offset_problem, c.pagination_basis);
    let row = byWork.get(c.work_id);
    if (!row) {
      row = {
        id: c.work_id,
        author: c.author,
        title: c.title,
        year: m?.year ?? null,
        list_id: m?.list_id ?? null,
        list_name: m?.list_name ?? null,
        first: m?.first ?? c.start_page,
        last: m?.last ?? c.end_page,
        unverified,
        unchecked: c.offset_checked_at === null && c.pagination_accepted_at === null,
        hits: 0,
        marks: [],
      };
      byWork.set(c.work_id, row);
    }
    const a = pageLabel(c.start_page, unverified);
    const b = pageLabel(c.end_page, unverified);
    row.hits += mode === 'words' ? (c as WordRow).hits : 1;
    row.marks.push({
      start: c.start_page,
      end: c.end_page,
      pages_label: c.start_page === c.end_page ? a : `${a}–${b}`,
      weight: weigh(c),
      detail:
        mode === 'words'
          ? `${(c as WordRow).hits} ${(c as WordRow).hits === 1 ? 'occurrence' : 'occurrences'}`
          : `similarity ${Number((c as ChunkRow).score).toFixed(3)}`,
      excerpt: excerpt(c.text, forms),
    });
  }

  const sortOf = (r: MotifRow) => meta.get(r.id)?.list_sort ?? Number.MAX_SAFE_INTEGER;
  const rows = [...byWork.values()].sort(
    (x, y) => sortOf(x) - sortOf(y) || y.hits - x.hits || (x.author ?? x.title).localeCompare(y.author ?? y.title, 'es'),
  );
  for (const r of rows) r.marks.sort((p, q) => p.start - q.start);

  return {
    mode,
    forms,
    rows,
    passages: chunks.length,
    capped: mode === 'words' && chunks.length >= WORD_LIMIT,
    error: null,
  };
}
