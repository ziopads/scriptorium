// The axis map: her axes and the works they bind, as two kinds of node
// (docs/NOTES-AND-CONNECTIONS.md; the hypergraph note on /about). Read by
// app/axes/page.tsx, drawn by components/axis-map.tsx.
//
// The edges come from the axis_works view (migration 005): which works an
// axis binds, through which part. Only reviewed parts count, as in the
// readiness matrix: a ficha still waiting for her is not yet part of her
// argument. One edge per axis and work; it is solid when a ficha names the
// work and dashed when the work is only named in the synthesis.
//
// THE LAYOUT
//
//   Fixed, not force-directed, so the map is the same every time and prints.
//   The axes run across the top in her order (ordinal, then creation). A work
//   bound by one axis hangs in that axis's column, on a spine with a tick to
//   each. A work bound by two or more is drawn once, in a band between the
//   axes and the columns, at the mean of its axes' centres, with a curve to
//   each: those are the bridges between arguments. Her order is kept even when
//   a bridge spans the page, because the axes are numbered and a reordered map
//   would contradict the list beneath it.
//
// Everything here is arithmetic on the rows; the component only draws it.

import { db } from '@/lib/db';

export const COLUMN = 160;
const MARGIN = 16;
const BOX_TOP = 8;
const LINE = 15;
const TITLE_CHARS = 21;
const TITLE_LINES = 3;
const ROW = 20;
const BRIDGE_GAP = 132;

export interface MapAxis {
  id: number;
  title: string;
  lines: string[];
  x: number; // left of the column
  cx: number; // centre of the box
}

export interface MapWork {
  id: string;
  label: string;
  full: string;
  axes: number[];
  shared: boolean;
  x: number;
  y: number;
}

export interface MapEdge {
  axis: number;
  work: string;
  ficha: boolean;
}

export interface AxisMapLayout {
  width: number;
  height: number;
  boxBottom: number;
  axes: MapAxis[];
  works: MapWork[];
  edges: MapEdge[];
  spines: { axis: number; x: number; y1: number; y2: number }[];
}

function wrap(title: string): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > TITLE_CHARS && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > TITLE_LINES) {
    const kept = lines.slice(0, TITLE_LINES);
    kept[TITLE_LINES - 1] = `${kept[TITLE_LINES - 1].slice(0, TITLE_CHARS - 1)}…`;
    return kept;
  }
  return lines;
}

function workLabel(author: string | null, editor: string | null, title: string, year: number | null) {
  // The surname is shortened, never the year: two works by one author are told
  // apart by it.
  const full = (author ?? editor)?.split(',')[0].trim() ?? title;
  const who = full.length > 15 ? `${full.slice(0, 14)}…` : full;
  return year !== null ? `${who} ${year}` : who;
}

export async function axisMap(): Promise<AxisMapLayout> {
  const sql = db();
  const [axisRows, edgeRows] = await Promise.all([
    sql`
      select id, coalesce(title, 'Untitled axis') as title
      from notes
      where kind = 'axis' and rejected_at is null
      order by ordinal nulls last, created_at
    `,
    sql`
      select aw.axis_id, aw.work_id, bool_or(aw.part_kind = 'ficha') as ficha,
             w.author, w.editor, w.title, w.year
      from axis_works aw
      join works w on w.id = aw.work_id
      where aw.reviewed
      group by aw.axis_id, aw.work_id, w.author, w.editor, w.title, w.year
    `,
  ]);

  const axisList = (axisRows as { id: string | number; title: string }[]).map((a) => ({
    id: Number(a.id),
    title: a.title,
  }));
  const edges = (
    edgeRows as {
      axis_id: string | number;
      work_id: string;
      ficha: boolean;
      author: string | null;
      editor: string | null;
      title: string;
      year: number | null;
    }[]
  ).map((e) => ({ ...e, axis_id: Number(e.axis_id) }));

  return layoutAxisMap(axisList, edges);
}

export interface AxisRow {
  id: number;
  title: string;
}

export interface EdgeRow {
  axis_id: number;
  work_id: string;
  ficha: boolean;
  author: string | null;
  editor: string | null;
  title: string;
  year: number | null;
}

// The layout itself, apart from the query, so it can be drawn from any rows.
export function layoutAxisMap(axisList: AxisRow[], edges: EdgeRow[]): AxisMapLayout {
  const titleLines = axisList.map((a) => wrap(a.title));
  const boxHeight = Math.max(1, ...titleLines.map((l) => l.length)) * LINE + 12;
  const boxBottom = BOX_TOP + boxHeight;

  const axes: MapAxis[] = axisList.map((a, i) => {
    const x = MARGIN + i * COLUMN;
    return { id: a.id, title: a.title, lines: titleLines[i], x, cx: x + COLUMN / 2 };
  });
  const byAxis = new Map(axes.map((a) => [a.id, a]));

  // One entry per work, with every axis that binds it.
  const workInfo = new Map<string, { label: string; full: string; axes: number[] }>();
  for (const e of edges) {
    if (!byAxis.has(e.axis_id)) continue;
    const who = e.author ?? e.editor;
    const entry = workInfo.get(e.work_id) ?? {
      label: workLabel(e.author, e.editor, e.title, e.year),
      full: `${who ? `${who}, ` : ''}${e.title}${e.year !== null ? ` (${e.year})` : ''}`,
      axes: [],
    };
    entry.axes.push(e.axis_id);
    workInfo.set(e.work_id, entry);
  }

  // Bridges: placed at the mean of their axes' centres, in rows so that no two
  // labels in a row come closer than BRIDGE_GAP.
  const bridgeTop = boxBottom + 44;
  const bridges = [...workInfo.entries()]
    .filter(([, w]) => w.axes.length > 1)
    .map(([id, w]) => ({
      id,
      ...w,
      x: w.axes.reduce((sum, a) => sum + byAxis.get(a)!.cx, 0) / w.axes.length,
    }))
    .sort((a, b) => a.x - b.x || a.label.localeCompare(b.label));
  const rowEnds: number[] = [];
  const works: MapWork[] = [];
  for (const b of bridges) {
    let row = rowEnds.findIndex((end) => b.x - end >= BRIDGE_GAP);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(b.x);
    } else {
      rowEnds[row] = b.x;
    }
    works.push({ id: b.id, label: b.label, full: b.full, axes: b.axes, shared: true, x: b.x, y: bridgeTop + row * ROW });
  }

  // Works of one axis: listed down its column, sorted by label.
  const columnTop = bridgeTop + Math.max(0, rowEnds.length - 1) * ROW + (rowEnds.length ? 28 : 0);
  const spines: AxisMapLayout['spines'] = [];
  let bottom = columnTop;
  for (const axis of axes) {
    const own = [...workInfo.entries()]
      .filter(([, w]) => w.axes.length === 1 && w.axes[0] === axis.id)
      .sort((a, b) => a[1].label.localeCompare(b[1].label, 'es'));
    own.forEach(([id, w], i) => {
      works.push({
        id,
        label: w.label,
        full: w.full,
        axes: w.axes,
        shared: false,
        x: axis.x + 22,
        y: columnTop + i * ROW,
      });
    });
    if (own.length > 0) {
      const last = columnTop + (own.length - 1) * ROW;
      spines.push({ axis: axis.id, x: axis.x + 12, y1: boxBottom, y2: last });
      bottom = Math.max(bottom, last);
    }
  }

  return {
    width: MARGIN * 2 + Math.max(1, axes.length) * COLUMN,
    height: bottom + 24,
    boxBottom,
    axes,
    works,
    edges: edges
      .filter((e) => byAxis.has(e.axis_id))
      .map((e) => ({ axis: e.axis_id, work: e.work_id, ficha: e.ficha })),
    spines,
  };
}
