// Which works resemble each other, from the text: each work as the average of
// its chunk vectors (front matter left out), with its language's average
// taken away. Read by the Nearest tab of a work's page and by the corpus map
// (app/map).
//
// WHY THE LANGUAGE AVERAGE IS REMOVED
//
//   voyage-4 is multilingual, but its vectors still carry the language: on 25
//   Sept 2026 a work's five nearest neighbours shared its language 83 per cent
//   of the time, against 51 per cent for any two works. Subtracting each
//   language's average vector took that to 63 per cent, and what remained read
//   as subject (the Nuevomexicano folktale collections sit together across
//   Spanish and English). A work's language is the majority language of its
//   chunks, so a translation counts as the language it is in; a work with no
//   language on any chunk is left out.
//
// Similarity here is a prompt for reading, not evidence: it says two books
// share vocabulary and themes, never why. Everything is computed on each
// request from chunks.embedding, so it follows the corpus without a pipeline
// step or a migration.

import { db } from '@/lib/db';

// The corrected vectors, as a common table expression shared by both queries.
const CENTRED = `
  with w as (
    select work_id, avg(embedding) as v, mode() within group (order by lang) as lang
    from chunks
    where embedding is not null and section_type is distinct from 'front'
    group by work_id
  ),
  m as (select lang, avg(v) as mv from w where lang is not null group by lang),
  c as (select w.work_id, w.lang, w.v - m.mv as v from w join m using (lang))
`;

export interface Neighbour {
  id: string;
  author: string | null;
  editor: string | null;
  title: string;
  year: number | null;
  lang: string | null;
  similarity: number;
}

export async function nearestWorks(
  workId: string,
  k = 5,
): Promise<{ lang: string | null; neighbours: Neighbour[] } | null> {
  const rows = (await db().query(
    `${CENTRED}
     select b.work_id as id, wk.author, wk.editor, wk.title, wk.year, b.lang,
            a.lang as own_lang, 1 - (a.v <=> b.v) as similarity
     from c a
     join c b on b.work_id <> a.work_id
     join works wk on wk.id = b.work_id
     where a.work_id = $1
     order by a.v <=> b.v
     limit $2`,
    [workId, k],
  )) as (Neighbour & { own_lang: string | null; similarity: number | string })[];
  if (rows.length === 0) return null;
  return {
    lang: rows[0].own_lang,
    neighbours: rows.map((r) => ({
      id: r.id,
      author: r.author,
      editor: r.editor,
      title: r.title,
      year: r.year,
      lang: r.lang,
      similarity: Number(r.similarity),
    })),
  };
}

export interface MapPoint {
  id: string;
  author: string | null;
  editor: string | null;
  title: string;
  year: number | null;
  lang: string | null;
  x: number; // 0..1
  y: number; // 0..1
  neighbours: { id: string; similarity: number }[];
}

// Classical multidimensional scaling: the similarities between every pair of
// works, as distances, placed in two dimensions so that the distances are kept
// as well as two dimensions allow. Power iteration for the two largest
// eigenvectors of the centred matrix, from a fixed start, so the map comes out
// the same way round every time for the same corpus. About a hundred works:
// no library needed.
function scale(n: number, dist: number[][]): [number, number][] {
  const sq = dist.map((row) => row.map((d) => d * d));
  const rowMean = sq.map((row) => row.reduce((s, v) => s + v, 0) / n);
  const all = rowMean.reduce((s, v) => s + v, 0) / n;
  const b = sq.map((row, i) => row.map((v, j) => -0.5 * (v - rowMean[i] - rowMean[j] + all)));

  const vectors: number[][] = [];
  const values: number[] = [];
  for (let e = 0; e < 2; e++) {
    let v = Array.from({ length: n }, (_, i) => ((i * 7919) % 97) / 97 + 0.01 * e);
    let lambda = 0;
    for (let it = 0; it < 500; it++) {
      const next = b.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
      // Deflate: keep the second vector orthogonal to the first.
      for (const u of vectors) {
        const dot = next.reduce((s, x, j) => s + x * u[j], 0);
        for (let j = 0; j < n; j++) next[j] -= dot * u[j];
      }
      const norm = Math.hypot(...next) || 1;
      lambda = norm;
      v = next.map((x) => x / norm);
    }
    // A fixed sign: the largest component positive.
    const big = v.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m), 0);
    if (big < 0) v = v.map((x) => -x);
    vectors.push(v);
    values.push(lambda);
  }
  return Array.from({ length: n }, (_, i) => [
    vectors[0][i] * Math.sqrt(values[0]),
    vectors[1][i] * Math.sqrt(values[1]),
  ]);
}

export async function corpusMap(k = 5): Promise<MapPoint[]> {
  const sql = db();
  const [rawNodes, rawPairs] = await Promise.all([
    sql.query(
      `${CENTRED}
       select c.work_id as id, wk.author, wk.editor, wk.title, wk.year, c.lang
       from c join works wk on wk.id = c.work_id
       order by c.work_id`,
    ),
    sql.query(
      `${CENTRED}
       select a.work_id as a, b.work_id as b, 1 - (a.v <=> b.v) as sim
       from c a join c b on a.work_id < b.work_id`,
    ),
  ]);
  const nodes = rawNodes as Omit<MapPoint, 'x' | 'y' | 'neighbours'>[];
  const pairs = rawPairs as { a: string; b: string; sim: number | string }[];

  const n = nodes.length;
  if (n < 3) return [];
  const index = new Map(nodes.map((p, i) => [p.id, i]));
  const sim = Array.from({ length: n }, () => new Array<number>(n).fill(1));
  for (const p of pairs) {
    const i = index.get(p.a);
    const j = index.get(p.b);
    if (i === undefined || j === undefined) continue;
    sim[i][j] = sim[j][i] = Number(p.sim);
  }
  const coords = scale(
    n,
    sim.map((row) => row.map((s) => Math.max(0, 1 - s))),
  );
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

  return nodes.map((p, i) => ({
    ...p,
    x: x1 > x0 ? (coords[i][0] - x0) / (x1 - x0) : 0.5,
    y: y1 > y0 ? (coords[i][1] - y0) / (y1 - y0) : 0.5,
    neighbours: sim[i]
      .map((s, j) => ({ id: nodes[j].id, similarity: s }))
      .filter((_, j) => j !== i)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k),
  }));
}
