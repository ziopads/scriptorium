// search, ported from pipeline/mcp_server.py (which runs search.py's query).
//
// Nearest chunks by cosine distance to the embedded query. A query in one
// language finds text in the other: voyage-4 is multilingual, which is what
// the retrieval design rests on. Optional filters by work and language; front
// matter excluded unless asked for. The HNSW index is off for space
// (docs/PIPELINE.md §4), so this is a sequential scan: slower, same results.
//
// Pages leave as they leave the app: pages_label carries the asterisk when the
// work's numbering is unverified, page_verified as the notes export writes it.
//
// A search over the whole corpus (no work_ids) also reports coverage: how many
// works search can reach, and how many examinable works it cannot, with
// list_gaps (mcp/tools/list-gaps.ts) to name them. Only the counts travel with
// every search; the list would repeat on every call of a survey.

import { db } from '@/lib/db';
import { embedQuery } from '@/lib/embed';
import { isUnverified, pageLabel, pageVerified } from '@/lib/page-verified';
import { numbering, pageNumbers } from '@/mcp/numbering';
import { gapCount } from '@/mcp/tools/list-gaps';
import { ToolError, workRecord } from '@/mcp/work';

export const MAX_SEARCH_RESULTS = 30;

type Row = {
  work_id: string;
  author: string | null;
  title: string;
  start_page: number;
  end_page: number;
  lang: string | null;
  score: number | string;
  text: string;
  offset_checked_at: unknown;
  offset_problem: string | null;
  pagination_accepted_at: unknown;
  pagination_basis: string | null;
};

export async function search(args: {
  query: string;
  work_ids?: string[] | null;
  lang?: string | null;
  k?: number | null;
  include_front_matter?: boolean | null;
}) {
  const lang = args.lang ?? null;
  if (lang !== null && lang !== 'english' && lang !== 'spanish') {
    throw new ToolError("lang is 'english', 'spanish' or omitted");
  }
  const k = Math.max(1, Math.min(args.k ?? 8, MAX_SEARCH_RESULTS));
  const works = args.work_ids && args.work_ids.length ? args.work_ids : null;
  const front = Boolean(args.include_front_matter);
  for (const id of works ?? []) await workRecord(id);

  let vector: number[];
  try {
    vector = await embedQuery(args.query);
  } catch (err) {
    throw new ToolError(`the query could not be embedded (${(err as Error).message})`);
  }
  const vec = JSON.stringify(vector);

  const [raw, coverage] = await Promise.all([
    db()`
    select c.work_id, w.author, w.title, c.start_page, c.end_page, c.lang,
           1 - (c.embedding <=> ${vec}::vector) as score, c.text,
           w.offset_checked_at, w.offset_problem, w.pagination_accepted_at, w.pagination_basis
    from chunks c join works w on w.id = c.work_id
    where c.embedding is not null
      and (${front}::boolean or c.section_type is distinct from 'front')
      and (${works}::text[] is null or c.work_id = any(${works}::text[]))
      and (${lang}::text is null or c.lang = ${lang}::text)
    order by c.embedding <=> ${vec}::vector
    limit ${k}
  `,
    works ? null : coverageCounts(),
  ]);
  const rows = raw as Row[];

  return {
    query: args.query,
    ...(coverage ? { coverage } : {}),
    results: rows.map((r) => {
      const checked = r.offset_checked_at !== null;
      const accepted = r.pagination_accepted_at !== null;
      const unverified = isUnverified(r.offset_problem, r.pagination_basis);
      const a = pageLabel(r.start_page, unverified);
      const b = pageLabel(r.end_page, unverified);
      return {
        work_id: r.work_id,
        author: r.author,
        title: r.title,
        pages: r.start_page === r.end_page ? String(r.start_page) : `${r.start_page}–${r.end_page}`,
        pages_label: r.start_page === r.end_page ? a : `${a}–${b}`,
        page_verified: pageVerified(unverified, r.pagination_basis),
        lang: r.lang,
        score: Math.round(Number(r.score) * 1000) / 1000,
        numbering: numbering(checked, r.offset_problem, accepted, r.pagination_basis),
        page_numbers: pageNumbers(checked, r.offset_problem, accepted, r.pagination_basis),
        text: r.text,
      };
    }),
  };
}

// How many works search can reach (any work with embedded passages, her
// dissertation additions included), and how many examinable works it cannot.
async function coverageCounts() {
  const [raw, gaps] = await Promise.all([
    db()`
      select count(*)::int as n from works w
      where exists (select 1 from chunks c where c.work_id = w.id and c.embedding is not null)
    `,
    gapCount(),
  ]);
  const searchable = raw as { n: number }[];
  return { searchable_works: searchable[0].n, examinable_not_searchable: gaps, see: 'list_gaps' };
}
