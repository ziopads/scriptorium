// Search over the chunks, two ways. Shared by the search page (app/search)
// and, for the semantic query, the remote MCP server's search tool
// (mcp/tools/search.ts), so the two cannot drift.
//
//   nearestChunks  by meaning: the chunks closest to the embedded query, in
//                  either language, ranked, at most k. Absence of a result
//                  means only that other passages were closer.
//   wordChunks     by word: every chunk whose folded text contains one of the
//                  forms given, with how many times. Complete: absence of a
//                  result means the word is not in the text.
//
// Both read chunks.text_search or chunks.embedding, which only searchable
// works have, and leave front matter out unless asked.

import { db } from '@/lib/db';
import { embedQuery } from '@/lib/embed';

export type ChunkRow = {
  work_id: string;
  author: string | null;
  title: string;
  start_page: number;
  end_page: number;
  lang: string | null;
  score: number | string;
  text: string;
  offset_checked_at: unknown;
  offset_problem: string | null;
  pagination_accepted_at: unknown;
  pagination_basis: string | null;
};

// The query is embedded by lib/embed.ts (voyage-4, 1024, input type query).
// The two steps are separate so a caller can tell an embedding failure from a
// database one: the MCP tool words the first for the model.
export async function nearestChunks(args: {
  query: string;
  works: string[] | null;
  lang: string | null;
  k: number;
  front: boolean;
}): Promise<ChunkRow[]> {
  return nearestChunksTo(await embedQuery(args.query), args);
}

export async function nearestChunksTo(
  vector: number[],
  args: { works: string[] | null; lang: string | null; k: number; front: boolean },
): Promise<ChunkRow[]> {
  const vec = JSON.stringify(vector);
  const { works, lang, k, front } = args;
  return (await db()`
    select c.work_id, w.author, w.title, c.start_page, c.end_page, c.lang,
           1 - (c.embedding <=> ${vec}::vector) as score, c.text,
           w.offset_checked_at, w.offset_problem, w.pagination_accepted_at, w.pagination_basis
    from chunks c join works w on w.id = c.work_id
    where c.embedding is not null
      and (${front}::boolean or c.section_type is distinct from 'front')
      and (${works}::text[] is null or c.work_id = any(${works}::text[]))
      and (${lang}::text is null or c.lang = ${lang}::text)
    order by c.embedding <=> ${vec}::vector
    limit ${k}
  `) as ChunkRow[];
}

// chunk.py's fold(): NFKD, combining marks dropped, lowercased. What
// chunks.text_search holds, so an unaccented form matches accented text.
export function fold(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

// The forms she typed, comma-separated, each folded and matched at the start
// of a word: "lechuza" finds lechuza and lechuzas, "owl" finds owl and owls
// but not bowl. A form of two words matches them in sequence. Anything but
// letters, digits and spaces is dropped, so no form can be read as a pattern.
export function wordForms(input: string): { forms: string[]; patterns: string[] } {
  const forms = [
    ...new Set(
      input
        .split(',')
        .map((f) => fold(f).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim())
        .filter((f) => f.length >= 2),
    ),
  ];
  // Postgres advanced regular expressions: \m is the start of a word.
  const patterns = forms.map((f) => `\\m${f.split(' ').join('\\s+')}`);
  return { forms, patterns };
}

export type WordRow = Omit<ChunkRow, 'score'> & { hits: number };

export const WORD_LIMIT = 3000;

// Every chunk carrying one of the forms, in page order, with the number of
// occurrences. Stops at WORD_LIMIT chunks; the caller says so when it does.
export async function wordChunks(args: {
  patterns: string[];
  works: string[] | null;
  front: boolean;
}): Promise<WordRow[]> {
  const { patterns, works, front } = args;
  if (patterns.length === 0) return [];
  return (await db()`
    select c.work_id, w.author, w.title, c.start_page, c.end_page, c.lang, c.text,
           w.offset_checked_at, w.offset_problem, w.pagination_accepted_at, w.pagination_basis,
           (select sum(regexp_count(c.text_search, p)) from unnest(${patterns}::text[]) p)::int as hits
    from chunks c join works w on w.id = c.work_id
    where c.text_search ~ any(${patterns}::text[])
      and (${front}::boolean or c.section_type is distinct from 'front')
      and (${works}::text[] is null or c.work_id = any(${works}::text[]))
    order by c.work_id, c.start_page
    limit ${WORD_LIMIT}
  `) as WordRow[];
}
