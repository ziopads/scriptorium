// The quotations anchored to a set of notes, in order. Ported from
// anchors_for() in pipeline/mcp_server.py, with each page carried the way the
// app shows it: page_label with the asterisk the note card draws, and
// page_verified as the notes export writes it (lib/page-verified.ts).

import { db } from '@/lib/db';
import { isUnverified, pageLabel, pageVerified, type PageVerified } from '@/lib/page-verified';

export type Quotation = {
  work_id: string;
  page: number | null;
  page_label: string | null;
  page_verified: PageVerified | '';
  quote: string | null;
};

type Row = {
  note_id: string; // bigint: the Neon HTTP driver returns it as a string
  work_id: string;
  printed_page: number | null;
  quote: string | null;
  offset_problem: string | null;
  pagination_basis: string | null;
};

export async function anchorsFor(noteIds: number[]): Promise<Map<number, Quotation[]>> {
  const out = new Map<number, Quotation[]>();
  if (noteIds.length === 0) return out;
  const rows = (await db()`
    select a.note_id, a.work_id, a.printed_page, a.quote, w.offset_problem, w.pagination_basis
    from note_anchors a join works w on w.id = a.work_id
    where a.note_id = any(${noteIds})
    order by a.note_id, a.ordinal
  `) as Row[];
  for (const r of rows) {
    const unverified = isUnverified(r.offset_problem, r.pagination_basis);
    const q: Quotation = {
      work_id: r.work_id,
      page: r.printed_page,
      page_label: r.printed_page === null ? null : pageLabel(r.printed_page, unverified),
      page_verified: r.printed_page === null ? '' : pageVerified(unverified, r.pagination_basis),
      quote: r.quote,
    };
    const list = out.get(Number(r.note_id)) ?? [];
    list.push(q);
    out.set(Number(r.note_id), list);
  }
  return out;
}
