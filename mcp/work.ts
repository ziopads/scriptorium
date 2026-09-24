// A work as the MCP tools see it, and whether its pages are citations.
// Ported from work_record() and citable() in pipeline/mcp_server.py.

import { db } from '@/lib/db';
import { isUnverified, pageVerified, type PageVerified } from '@/lib/page-verified';
import { numbering, pageNumbers } from '@/mcp/numbering';

// A failure the model should read and act on (a wrong id, a bad range), as
// distinct from a bug. server.ts turns it into an isError result.
export class ToolError extends Error {}

export type WorkRecord = {
  id: string;
  author: string | null;
  title: string;
  year: number | null;
  checked: boolean;
  problem: string | null;
  accepted: boolean;
  basis: string | null;
  internal_note: string | null;
  numbering: string;
  page_numbers: string;
  unverified: boolean;
  page_verified: PageVerified;
};

type Row = {
  id: string;
  author: string | null;
  title: string;
  year: number | null;
  offset_checked_at: unknown;
  offset_problem: string | null;
  notes_internal: string | null;
  pagination_accepted_at: unknown;
  pagination_basis: string | null;
};

export function toRecord(r: Row): WorkRecord {
  const checked = r.offset_checked_at !== null;
  const accepted = r.pagination_accepted_at !== null;
  const unverified = isUnverified(r.offset_problem, r.pagination_basis);
  return {
    id: r.id,
    author: r.author,
    title: r.title,
    year: r.year,
    checked,
    problem: r.offset_problem,
    accepted,
    basis: r.pagination_basis,
    internal_note: r.notes_internal,
    numbering: numbering(checked, r.offset_problem, accepted, r.pagination_basis),
    page_numbers: pageNumbers(checked, r.offset_problem, accepted, r.pagination_basis),
    unverified,
    page_verified: pageVerified(unverified, r.pagination_basis),
  };
}

export async function workRecord(workId: string): Promise<WorkRecord> {
  const sql = db();
  const rows = (await sql`
    select id, author, title, year, offset_checked_at, offset_problem, notes_internal,
           pagination_accepted_at, pagination_basis
    from works where id = ${workId}
  `) as Row[];
  if (rows[0]) return toRecord(rows[0]);

  const hits = (await sql`
    select id from works where id ilike ${'%' + workId + '%'} order by id limit 10
  `) as { id: string }[];
  const hint = hits.length ? ` Ids containing it: ${hits.map((h) => h.id).join(', ')}.` : ' Use find_works.';
  throw new ToolError(`'${workId}' is not a work id.${hint}`);
}

// Why this work's pages are not citations, or null if they are. An accepted
// work is citable whatever offset_problem says: acceptance is the decision,
// the problem is the evidence it was made on (docs/PAGE-NUMBERS.md §2).
export function citable(w: WorkRecord): string | null {
  if (w.problem && !w.accepted) return `page numbering unsettled: ${w.problem}`;
  if (!w.checked) return 'page numbering never checked';
  return null;
}
