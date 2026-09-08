// The Neon connection.
//
// @neondatabase/serverless speaks to Postgres over HTTP, which is what makes it
// usable from a serverless function where a long-lived TCP pool has nowhere to
// live. Two consequences worth holding in mind:
//
//   1. Every tagged-template call is its own round trip. Two queries in a page
//      are two trips, so prefer one query with a join over two convenient ones.
//   2. There is no implicit transaction across separate calls. Anything that
//      must be atomic — rebuilding one book's chunks, for instance — needs the
//      driver's transaction helper or the unpooled connection.
//
// DATABASE_URL is the pooled string (the -pooler host). DATABASE_URL_UNPOOLED
// exists in .env.local for the cases that need a real session.

import { neon } from '@neondatabase/serverless';

type Sql = ReturnType<typeof neon>;

let cached: Sql | null = null;

// Resolved on first use rather than at module load, so that importing this file
// during a build without environment variables present does not throw.
export function db(): Sql {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. It belongs in .env.local, which neon link writes.',
    );
  }

  cached = neon(url);
  return cached;
}

// Neon's driver returns a union type — `any[][] | Record<string, any>[] |
// FullQueryResults<boolean>` — because its array-mode and full-results options
// are generic and unresolved at the call site. Casting the whole result to a row
// array is allowed; indexing the union before casting is not. So every query
// function in lib/ casts once, on the way out, before touching a row:
//
//     const rows = (await sql`select ...`) as Book[];
//     return rows[0] ?? null;
export type Row = Record<string, unknown>;
