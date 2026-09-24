// The readiness matrix: every item on an examinable list, with how far its
// preparation has come. Read by app/readiness/page.tsx.
//
// Two separate things per item, because they do not form one ladder:
//
//   the file     from fileStates (lib/gaps.ts), the rule the Gaps tab and
//                list_gaps use: no PDF, held, numbering to settle, loaded,
//                searchable.
//   preparation  four yes/no facts: a note, a quotation, a place in an axis,
//                a study aid (drafted or reviewed). A work can be in an axis
//                through a ficha with no quotation behind it, so none of the
//                four implies another.
//
// Only her graph counts: notes from the reviewed_notes view (migration 005),
// which leaves out rejected notes and every proposal still waiting for her.
// This is stricter than note_count on /lists and the workbench, which count
// pending proposals other than dossier claims. A proposal is not preparation
// until she has accepted it.
//
// A listed volume counts the notes, quotations and axes on the essays inside
// it as well as on itself: she reads the essays, and the list names the
// volume. A study aid is looked for the same way.

import { db } from '@/lib/db';
import { fileStates, type FileState } from '@/lib/gaps';

export type AidState = 'reviewed' | 'draft' | null;

export interface ReadinessItem {
  list_id: string;
  section_id: string | null;
  ordinal: number | null;
  id: string;
  author: string | null;
  editor: string | null;
  title: string;
  year: number | null;
  kind: string;
  has_notes: boolean;
  has_quotation: boolean;
  in_axis: boolean;
  study_aid: AidState;
  // Null for a film, which has no file to hold; the page says so.
  file: FileState | null;
}

export async function readinessItems(): Promise<ReadinessItem[]> {
  const sql = db();
  const rows = (await sql`
    with items as (
      select li.list_id, li.section_id, li.ordinal,
             el.sort as list_sort, ls.sort as section_sort,
             w.id, w.author, w.editor, w.title, w.year, w.kind
      from list_items li
      join exam_lists el on el.id = li.list_id and el.examinable
      join works w on w.id = li.work_id
      left join list_sections ls on ls.id = li.section_id
    ),
    -- The item and anything inside it.
    scope as (
      select distinct i.id as item_id, s.id as work_id
      from items i
      join works s on s.id = i.id or s.container_id = i.id
    ),
    touched as (
      select sc.item_id, n.id as note_id,
             nullif(btrim(coalesce(t.quote, '')), '') is not null as quoted
      from scope sc
      join (
        select note_id, work_id, quote from note_anchors
        union all
        select note_id, work_id, null as quote from note_works
      ) t on t.work_id = sc.work_id
      join reviewed_notes n on n.id = t.note_id
    )
    select i.list_id, i.section_id, i.ordinal, i.id, i.author, i.editor,
           i.title, i.year, i.kind,
           exists (select 1 from touched x where x.item_id = i.id) as has_notes,
           exists (select 1 from touched x where x.item_id = i.id and x.quoted) as has_quotation,
           exists (
             select 1 from scope sc
             join axis_works aw on aw.work_id = sc.work_id
             where sc.item_id = i.id and aw.reviewed
           ) as in_axis,
           (
             select case when count(*) = 0 then null
                         when bool_and(d.reviewed) then 'reviewed'
                         else 'draft' end
             from scope sc
             join dossier_sections d on d.work_id = sc.work_id
             where sc.item_id = i.id
           ) as study_aid
    from items i
    order by i.list_sort, i.section_sort nulls last, i.ordinal nulls last,
             coalesce(i.author, i.title)
  `) as Omit<ReadinessItem, 'file'>[];

  const states = await fileStates([...new Set(rows.map((r) => r.id))]);
  const byId = new Map(states.map((s) => [s.id, s.state]));

  return rows.map((r) => ({
    ...r,
    file: r.kind === 'film' ? null : byId.get(r.id) ?? 'no_pdf',
  }));
}
