// list_notes, ported from pipeline/mcp_server.py: her notes, filtered by a
// work, a tag or text. Rejected proposals and unreviewed dossier claims are
// left out, as in the app. origin and reviewed say whose writing a note is;
// an unreviewed assistant note is a pending proposal, not her writing.
//
// The filters are optional, and the Neon HTTP driver takes tagged templates,
// so each is written as "(param is null or condition)" in one static query
// rather than assembled from strings.

import { db } from '@/lib/db';
import { anchorsFor } from '@/mcp/anchors';
import { ToolError, workRecord } from '@/mcp/work';

export const MAX_NOTES_LISTED = 50;

type Row = {
  id: number;
  kind: string;
  title: string | null;
  body: string | null;
  attribution: string | null;
  attributed_to: string | null;
  origin: string;
  reviewed: boolean;
  tags: string[] | null;
};

export async function listNotes(args: { work_id?: string | null; tag?: string | null; contains?: string | null }) {
  const work = args.work_id || null;
  const tag = args.tag || null;
  const q = args.contains ? `%${args.contains}%` : null;
  if (!work && !tag && !q) throw new ToolError('filter by work_id, tag or contains');
  if (work) await workRecord(work);

  const rows = (await db()`
    select n.id, n.kind, n.title, n.body, n.attribution, n.attributed_to, n.origin, n.reviewed, n.tags
    from notes n
    where n.rejected_at is null
      and not ('dossier' = any(n.tags) and n.reviewed = false)
      and (${work}::text is null
           or exists (select 1 from note_anchors a where a.note_id = n.id and a.work_id = ${work}::text)
           or exists (select 1 from note_works nw where nw.note_id = n.id and nw.work_id = ${work}::text))
      and (${tag}::text is null or ${tag}::text = any(n.tags))
      and (${q}::text is null or n.body ilike ${q}::text or n.title ilike ${q}::text)
    order by n.id desc
    limit ${MAX_NOTES_LISTED}
  `) as Row[];
  const anchors = await anchorsFor(rows.map((r) => r.id));
  return {
    notes: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      attribution: r.attribution,
      attributed_to: r.attributed_to,
      origin: r.origin,
      reviewed: r.reviewed,
      tags: r.tags,
      quotations: anchors.get(r.id) ?? [],
    })),
  };
}
