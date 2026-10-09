// System health: what is used and what is left, read fresh on every request.
//
// Three sources answer live. Postgres reports the database's own size and the
// corpus counts. Neon's API reports what Neon itself measures for the project
// (compute time, storage, the billing period) — the figures it enforces its
// limits on, which pg_database_size alone does not include. Voyage is checked
// by embedding a two-word query, the same call every meaning search makes.
//
// Vercel, Voyage's usage totals and Claude subscriptions publish no usage API
// a page can read, so the page links to each dashboard instead of guessing.
//
// Every check catches its own failure: a page about failures must still render
// when one of the things it checks has failed.

import { db } from '@/lib/db';
import { embedQuery } from '@/lib/embed';

const NEON_API = 'https://console.neon.tech/api/v2';
const TIMEOUT_MS = 10_000;

export interface Result<T> {
  value?: T;
  error?: string;
  ms: number;
}

async function timed<T>(run: () => Promise<T>): Promise<Result<T>> {
  const started = Date.now();
  try {
    const value = await run();
    return { value, ms: Date.now() - started };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
  }
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// Postgres

export interface TableSize {
  name: string;
  bytes: number;
  rows: number;
}

export interface DatabaseFigures {
  bytes: number;
  tables: TableSize[];
  works: number;
  worksWithPages: number;
  worksBlocked: number;
  chunks: number;
  chunksUnembedded: number;
  dossierSections: number;
  proposals: number;
}

export function databaseFigures(): Promise<Result<DatabaseFigures>> {
  return timed(async () => {
    const sql = db();
    const [counts] = (await sql`
      select
        pg_database_size(current_database()) as bytes,
        (select count(*) from works) as works,
        (select count(distinct work_id) from pages) as works_with_pages,
        (select count(*) from works
           where offset_problem is not null and pagination_accepted_at is null) as works_blocked,
        (select count(*) from chunks) as chunks,
        (select count(*) from chunks where embedding is null) as chunks_unembedded,
        (select count(*) from dossier_sections) as dossier_sections,
        (select count(*) from notes
           where origin = 'assistant' and not reviewed and rejected_at is null) as proposals
    `) as Record<string, unknown>[];
    const tables = (await sql`
      select n.nspname || '.' || c.relname as name,
             pg_total_relation_size(c.oid) as bytes,
             greatest(c.reltuples, 0) as rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('public', 'neon_auth')
      order by pg_total_relation_size(c.oid) desc
      limit 10
    `) as Record<string, unknown>[];
    return {
      bytes: num(counts.bytes) ?? 0,
      tables: tables.map((t) => ({
        name: String(t.name),
        bytes: num(t.bytes) ?? 0,
        rows: num(t.rows) ?? 0,
      })),
      works: num(counts.works) ?? 0,
      worksWithPages: num(counts.works_with_pages) ?? 0,
      worksBlocked: num(counts.works_blocked) ?? 0,
      chunks: num(counts.chunks) ?? 0,
      chunksUnembedded: num(counts.chunks_unembedded) ?? 0,
      dossierSections: num(counts.dossier_sections) ?? 0,
      proposals: num(counts.proposals) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Neon's API
//
// Needs NEON_API_KEY (Neon console → account settings → API keys) and
// NEON_PROJECT_ID. Field names are read defensively: a missing field is shown
// as not reported rather than as zero, and the usage-related fields Neon
// returned are kept raw so the page can show exactly what came back.

export interface NeonBranch {
  name: string;
  isDefault: boolean;
  logicalBytes: number | null;
  state: string | null;
}

export interface NeonFigures {
  projectId: string;
  periodStart: string | null;
  periodEnd: string | null;
  computeSeconds: number | null;
  activeSeconds: number | null;
  computeQuotaSeconds: number | null;
  storageLimitBytes: number | null;
  syntheticStorageBytes: number | null;
  branches: NeonBranch[];
  raw: Record<string, unknown>;
}

async function neonGet(path: string, key: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${NEON_API}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Neon API ${path}: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const USAGE_FIELD = /time|cpu|storage|size|written|transfer|consumption|quota|limit|period|plan/i;

export function neonFigures(): Promise<Result<NeonFigures>> | null {
  const key = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!key || !projectId) return null;

  return timed(async () => {
    const [p, b] = await Promise.all([
      neonGet(`/projects/${projectId}`, key),
      neonGet(`/projects/${projectId}/branches`, key),
    ]);
    const project = (p.project ?? {}) as Record<string, unknown>;
    const settings = (project.settings ?? {}) as Record<string, unknown>;
    const quota = (settings.quota ?? {}) as Record<string, unknown>;
    const branches = ((b.branches ?? []) as Record<string, unknown>[]).map((br) => ({
      name: String(br.name ?? br.id ?? '?'),
      isDefault: Boolean(br.default ?? br.primary),
      logicalBytes: num(br.logical_size),
      state: br.current_state ? String(br.current_state) : null,
    }));

    const raw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(project)) {
      if (USAGE_FIELD.test(k) && (v === null || typeof v !== 'object')) raw[k] = v;
    }
    for (const [k, v] of Object.entries(quota)) raw[`settings.quota.${k}`] = v;

    return {
      projectId,
      periodStart: project.consumption_period_start ? String(project.consumption_period_start) : null,
      periodEnd: project.consumption_period_end ? String(project.consumption_period_end) : null,
      computeSeconds: num(project.compute_time_seconds),
      activeSeconds: num(project.active_time_seconds ?? project.active_time),
      computeQuotaSeconds: num(quota.compute_time_seconds),
      storageLimitBytes:
        num(quota.logical_size_bytes) ??
        num(project.branch_logical_size_limit_bytes) ??
        (num(project.branch_logical_size_limit) !== null
          ? (num(project.branch_logical_size_limit) as number) * 1024 * 1024
          : null),
      syntheticStorageBytes: num(project.synthetic_storage_size),
      branches,
      raw,
    };
  });
}

// ---------------------------------------------------------------------------
// Voyage: one real query embedding, timed. A 429 here is a rate limit.

export function voyageCheck(): Promise<Result<number>> {
  return timed(async () => (await embedQuery('health check')).length);
}
