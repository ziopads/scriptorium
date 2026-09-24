// get_study_aid, ported from pipeline/mcp_server.py: a work's dossier
// sections, each saying whether she has reviewed it. An unreviewed section is
// the assistant's draft, not her view.

import { db } from '@/lib/db';
import { workRecord } from '@/mcp/work';

type Row = { kind: string; body: string; reviewed: boolean; model: string | null; generated_at: unknown };

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export async function getStudyAid(workId: string) {
  await workRecord(workId);
  const rows = (await db()`
    select kind, body, reviewed, model, generated_at from dossier_sections
    where work_id = ${workId} order by kind
  `) as Row[];
  if (rows.length === 0) {
    return { work_id: workId, sections: [], note: 'no dossier loaded for this work' };
  }
  return {
    work_id: workId,
    sections: rows.map((r) => {
      let body: unknown = r.body;
      if (typeof r.body === 'string') {
        try {
          body = JSON.parse(r.body);
        } catch {
          body = r.body;
        }
      }
      return { kind: r.kind, reviewed: r.reviewed, model: r.model, generated_at: iso(r.generated_at), body };
    }),
  };
}
