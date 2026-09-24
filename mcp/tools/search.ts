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
//
// With project (0.7.0): only that project's works (mcp/project.ts), narrowed
// further by work_ids if both are given. The result then names the project's
// works that search cannot reach (no embedded passages), so a survey of one
// essay's ground can say what it could not see.

import { db } from '@/lib/db';
import { embedQuery } from '@/lib/embed';
import { isUnverified, pageLabel, pageVerified } from '@/lib/page-verified';
import { nearestChunksTo } from '@/lib/search';
import { numbering, pageNumbers } from '@/mcp/numbering';
import { projectMembership, projectRecord } from '@/mcp/project';
import { gapCount } from '@/mcp/tools/list-gaps';
import { ToolError, workRecord } from '@/mcp/work';

export const MAX_SEARCH_RESULTS = 30;

// The query itself is nearestChunksTo() in lib/search.ts, shared with the
// search page.

export async function search(args: {
  query: string;
  work_ids?: string[] | null;
  lang?: string | null;
  k?: number | null;
  include_front_matter?: boolean | null;
  project?: number | null;
}) {
  const lang = args.lang ?? null;
  if (lang !== null && lang !== 'english' && lang !== 'spanish') {
    throw new ToolError("lang is 'english', 'spanish' or omitted");
  }
  const k = Math.max(1, Math.min(args.k ?? 8, MAX_SEARCH_RESULTS));
  const named = args.work_ids && args.work_ids.length ? args.work_ids : null;
  const front = Boolean(args.include_front_matter);
  for (const id of named ?? []) await workRecord(id);

  let works = named;
  let scope: { id: number; name: string; works: number; not_searchable: unknown[] } | null = null;
  if (args.project !== undefined && args.project !== null) {
    const project = await projectRecord(args.project);
    const members = [...(await projectMembership(project.id)).keys()];
    works = named ? named.filter((id) => members.includes(id)) : members;
    if (works.length === 0) {
      throw new ToolError(
        named
          ? `none of work_ids is in project ${project.id}`
          : `project ${project.id} has no works yet`,
      );
    }
    const unreachable = (await db()`
      select w.id, w.author, w.title from works w
      where w.id = any(${works}::text[])
        and not exists (select 1 from chunks c where c.work_id = w.id and c.embedding is not null)
      order by coalesce(w.author, w.title)
    `) as { id: string; author: string | null; title: string }[];
    scope = { id: project.id, name: project.name, works: works.length, not_searchable: unreachable };
  }

  let vector: number[];
  try {
    vector = await embedQuery(args.query);
  } catch (err) {
    throw new ToolError(`the query could not be embedded (${(err as Error).message})`);
  }

  const [rows, coverage] = await Promise.all([
    nearestChunksTo(vector, { works, lang, k, front }),
    works ? null : coverageCounts(),
  ]);

  return {
    query: args.query,
    ...(scope ? { project: scope } : {}),
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
