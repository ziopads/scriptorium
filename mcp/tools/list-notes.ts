// list_notes, ported from pipeline/mcp_server.py: her notes, filtered by a
// work, a tag or text. Rejected proposals and unreviewed dossier claims are
// left out, as in the app. origin and reviewed say whose writing a note is;
// an unreviewed assistant note is a pending proposal, not her writing.
//
// The filters are optional, and the Neon HTTP driver takes tagged templates,
// so each is written as "(param is null or condition)" in one static query
// rather than assembled from strings.
//
// project (0.7.0) filters to the project's notes: its member notes and the
// parts of its member axes (mcp/project.ts), and can be the only filter.
//
// origin (0.8.0) narrows to the notes she typed ('human') or the ones the
// draft_note tool wrote ('assistant'; editing one in the app keeps its origin).
// It can be the only filter, so "all of her own notes" is one call. One row
// past the limit is fetched so the result can say truncated rather than end
// silently at the fiftieth note.

import { db } from '@/lib/db';
import { anchorsFor } from '@/mcp/anchors';
import { projectRecord } from '@/mcp/project';
import { ToolError, workRecord } from '@/mcp/work';

export const MAX_NOTES_LISTED = 50;

type Row = {
  id: string; // bigint: the Neon HTTP driver returns it as a string; returned as a number, as the Python does
  kind: string;
  title: string | null;
  body: string | null;
  attribution: string | null;
  attributed_to: string | null;
  origin: string;
  reviewed: boolean;
  tags: string[] | null;
};

export async function listNotes(args: {
  work_id?: string | null;
  tag?: string | null;
  contains?: string | null;
  project?: number | null;
  origin?: 'human' | 'assistant' | null;
}) {
  const work = args.work_id || null;
  const tag = args.tag || null;
  const q = args.contains ? `%${args.contains}%` : null;
  const project = args.project ?? null;
  const origin = args.origin || null;
  if (origin && origin !== 'human' && origin !== 'assistant') {
    throw new ToolError("origin is 'human' or 'assistant'");
  }
  if (!work && !tag && !q && project === null && !origin) {
    throw new ToolError('filter by work_id, tag, contains, project or origin');
  }
  if (work) await workRecord(work);
  if (project !== null) await projectRecord(project);

  const fetched = (await db()`
    select n.id, n.kind, n.title, n.body, n.attribution, n.attributed_to, n.origin, n.reviewed, n.tags
    from notes n
    where n.rejected_at is null
      and not ('dossier' = any(n.tags) and n.reviewed = false)
      and (${work}::text is null
           or exists (select 1 from note_anchors a where a.note_id = n.id and a.work_id = ${work}::text)
           or exists (select 1 from note_works nw where nw.note_id = n.id and nw.work_id = ${work}::text))
      and (${tag}::text is null or ${tag}::text = any(n.tags))
      and (${origin}::text is null or n.origin = ${origin}::text)
      and (${q}::text is null or n.body ilike ${q}::text or n.title ilike ${q}::text)
      and (${project}::int is null or n.id in (
           select pn.note_id from project_notes pn where pn.project_id = ${project}::int
           union
           select c.id from notes c
           join project_notes pn on pn.note_id = c.parent_id
           where pn.project_id = ${project}::int))
    order by n.id desc
    limit ${MAX_NOTES_LISTED + 1}
  `) as Row[];
  const truncated = fetched.length > MAX_NOTES_LISTED;
  const rows = fetched.slice(0, MAX_NOTES_LISTED);
  const anchors = await anchorsFor(rows.map((r) => Number(r.id)));
  return {
    truncated,
    ...(truncated
      ? {
          more: `Only the ${MAX_NOTES_LISTED} most recent matching notes are listed; older ones are not. ` +
            'Narrow the filter (a work_id, a project, a tag) to reach them, and say so if you cannot.',
        }
      : {}),
    notes: rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      title: r.title,
      body: r.body,
      attribution: r.attribution,
      attributed_to: r.attributed_to,
      origin: r.origin,
      reviewed: r.reviewed,
      tags: r.tags,
      quotations: anchors.get(Number(r.id)) ?? [],
    })),
  };
}
