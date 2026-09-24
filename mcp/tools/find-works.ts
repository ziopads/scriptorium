// find_works, ported from pipeline/mcp_server.py. Same query, same matching
// (accents and case ignored, on id, author and title), same fields, same cap —
// except internal_note, which is left out while the remote server is protected
// by its URL alone (deploy 1). It returns once the server sits behind OAuth.

import { db } from '@/lib/db';
import { numbering, pageNumbers } from '@/mcp/numbering';

export const MAX_WORKS_LISTED = 25;

type Row = {
  id: string;
  author: string | null;
  title: string | null;
  year: number | null;
  offset_checked_at: string | null;
  offset_problem: string | null;
  pagination_accepted_at: string | null;
  pagination_basis: string | null;
  has_pages: boolean;
  searchable: boolean;
};

// Python's fold(): NFKD, drop combining marks, casefold.
export function fold(value: string | null): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

export async function findWorks(query: string) {
  const needle = fold(query).trim();
  if (!needle) throw new Error('give part of an author, title or id');

  const sql = db();
  const rows = (await sql`
    select w.id, w.author, w.title, w.year, w.offset_checked_at, w.offset_problem,
           w.pagination_accepted_at, w.pagination_basis,
           exists (select 1 from pages p where p.work_id = w.id) as has_pages,
           exists (select 1 from chunks c where c.work_id = w.id
                   and c.embedding is not null) as searchable
    from works w order by w.author nulls last, w.title
  `) as Row[];

  const works = rows
    .filter(
      (r) =>
        fold(r.id).includes(needle) ||
        fold(r.author).includes(needle) ||
        fold(r.title).includes(needle),
    )
    .map((r) => {
      const checked = r.offset_checked_at !== null;
      const accepted = r.pagination_accepted_at !== null;
      return {
        id: r.id,
        author: r.author,
        title: r.title,
        year: r.year,
        numbering: numbering(checked, r.offset_problem, accepted, r.pagination_basis),
        page_numbers: pageNumbers(checked, r.offset_problem, accepted, r.pagination_basis),
        has_pages: r.has_pages,
        searchable: r.searchable,
      };
    });

  return { count: works.length, works: works.slice(0, MAX_WORKS_LISTED) };
}
