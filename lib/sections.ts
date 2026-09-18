// Chapters and parts of a work, for the Contents tab and for scoping search.
//
// Derived from the extract and rebuildable (migration 009), so nothing here is
// citable and nothing points at it. first_page is the printed folio, resolved
// at load time, which is what the Preview tab navigates by.

import { db } from '@/lib/db';

export interface Section {
  ordinal: number;
  level: number;
  title: string;
  first_page: number;
  last_page: number | null;
  source: string;
}

export async function listSections(workId: string): Promise<Section[]> {
  const sql = db();
  const rows = await sql`
    select ordinal, level, title, first_page, last_page, source
    from sections
    where work_id = ${workId}
    order by ordinal
  `;
  return rows as Section[];
}

// Which section a page falls in — for the Preview header, and later for
// reporting a search hit by chapter rather than by page alone.
export async function sectionAt(workId: string, printedPage: number): Promise<Section | null> {
  const sql = db();
  const rows = (await sql`
    select ordinal, level, title, first_page, last_page, source
    from sections
    where work_id = ${workId}
      and first_page <= ${printedPage}
      and (last_page is null or last_page >= ${printedPage})
    order by first_page desc
    limit 1
  `) as Section[];
  return rows[0] ?? null;
}
