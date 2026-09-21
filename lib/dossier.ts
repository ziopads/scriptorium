// Reads for a work's dossier, written by pipeline/dossier.py into
// dossier_sections (migration 004).
//
// Four kinds, each body JSON in the text column:
//
//   summary    { paragraphs: [CitedText] }
//   argument   { key_arguments: [KeyArgument], groups, claims: { id: Claim } }
//   key_terms  { terms: [KeyTerm] }
//   themes     { themes: [{ theme, bridges: [CitedText] }] }
//
// The study aid is the summary, the key arguments, the key terms and the
// themes. The claims are the full record behind it. Every quotation, in the
// aid or the record, was found in the book's own page text, and its page is
// the printed page where it was found.

import { db } from '@/lib/db';

export interface DossierQuote {
  text: string;     // the book's text at the match
  page: number;     // printed page where it starts
  pages: string;    // '45', or '45–46' across a page break
  match: string;    // 'exact', or 'close (96%)' for an OCR slip
  claim?: string;   // in the aid: the claim it was taken from
}

export interface DossierClaim {
  claim: string;
  topic: string;
  example: string;
  unit: string;
  quotes: DossierQuote[];
  check: { verdict: 'supported' | 'partial'; reason: string };
  // Capitalised words and numbers in the wording that the book's text does
  // not contain: a date or name the model may have brought from elsewhere.
  unfound?: string[];
}

export interface CitedText {
  text: string;
  claims: string[];
  unfound?: string[];
}

export interface KeyArgument {
  title: string;
  text: string;
  example: string;
  claims: string[];
  quotes: DossierQuote[];
  unfound?: string[];
}

export interface KeyTerm {
  term: string;
  definition: string;
  claims: string[];
  quote: DossierQuote;
  unfound?: string[];
}

export interface Dossier {
  model: string | null;
  generated_at: string | null;
  reviewed: boolean;
  summary: CitedText[];
  keyArguments: KeyArgument[];
  terms: KeyTerm[];
  themes: { theme: string; bridges: CitedText[] }[];
  groups: { topic: string; claims: string[] }[];
  claims: Record<string, DossierClaim>;
}

function parse<T>(body: string | undefined, fallback: T): T {
  if (!body) return fallback;
  try {
    return JSON.parse(body) as T;
  } catch {
    return fallback;
  }
}

// Null unless the argument section exists: it carries the claims every page
// in the other sections comes from.
export async function getDossier(workId: string): Promise<Dossier | null> {
  const sql = db();
  const rows = (await sql`
    select kind, body, reviewed, model, generated_at
    from dossier_sections
    where work_id = ${workId} and kind in ('summary', 'argument', 'key_terms', 'themes')
  `) as {
    kind: string;
    body: string;
    reviewed: boolean;
    model: string | null;
    generated_at: string | Date | null;
  }[];

  const byKind = new Map(rows.map((r) => [r.kind, r]));
  const argument = byKind.get('argument');
  if (!argument) return null;

  const arg = parse<{
    key_arguments?: KeyArgument[];
    groups?: Dossier['groups'];
    claims?: Dossier['claims'];
  }>(argument.body, {});
  const summary = parse<{ paragraphs?: CitedText[] }>(byKind.get('summary')?.body, {});
  const terms = parse<{ terms?: KeyTerm[] }>(byKind.get('key_terms')?.body, {});
  const themes = parse<{ themes?: Dossier['themes'] }>(byKind.get('themes')?.body, {});

  const generated = argument.generated_at;
  return {
    model: argument.model,
    generated_at:
      generated === null ? null : generated instanceof Date ? generated.toISOString() : generated,
    reviewed: rows.every((r) => r.reviewed),
    summary: summary.paragraphs ?? [],
    keyArguments: arg.key_arguments ?? [],
    terms: terms.terms ?? [],
    themes: themes.themes ?? [],
    groups: arg.groups ?? [],
    claims: arg.claims ?? {},
  };
}

// The printed pages a set of claims rests on, in order, for citing a
// paragraph of the summary or a bridge.
export function pagesOf(dossier: Dossier, ids: string[]): number[] {
  const pages = new Set<number>();
  for (const id of ids) {
    for (const q of dossier.claims[id]?.quotes ?? []) pages.add(q.page);
  }
  return [...pages].sort((a, b) => a - b);
}
