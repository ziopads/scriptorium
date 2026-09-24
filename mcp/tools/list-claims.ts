// list_claims, ported from pipeline/mcp_server.py: the dossier claims about a
// work that she has accepted, each with its verified quotations. Claims
// awaiting review and those she rejected are left out.

import { db } from '@/lib/db';
import { anchorsFor } from '@/mcp/anchors';
import { workRecord } from '@/mcp/work';

// bigint id: the Neon HTTP driver returns it as a string; returned as a number, as the Python does.
type Row = { id: string; body: string; tags: string[] | null };

export async function listClaims(workId: string) {
  await workRecord(workId);
  const rows = (await db()`
    select n.id, n.body, n.tags from notes n
    where 'dossier' = any(n.tags) and n.reviewed and n.rejected_at is null
      and exists (select 1 from note_anchors a where a.note_id = n.id and a.work_id = ${workId})
    order by n.id
  `) as Row[];
  const anchors = await anchorsFor(rows.map((r) => Number(r.id)));
  return {
    work_id: workId,
    claims: rows.map((r) => ({
      id: Number(r.id),
      claim: r.body,
      tags: r.tags,
      quotations: anchors.get(Number(r.id)) ?? [],
    })),
  };
}
