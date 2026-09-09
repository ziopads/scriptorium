// Dates, in one place.
//
// The Neon driver parses Postgres timestamptz into a JavaScript Date rather
// than leaving it as a string, so anything that treats created_at as text fails
// at runtime while typechecking cleanly. These helpers accept either.
//
// Days are computed in her timezone, not the server's. Postgres stores UTC and
// Vercel runs in UTC, so taking the first ten characters of a timestamp would
// file a note written at 7pm in Boulder under the following day — precisely
// wrong for grouping that exists to help her return to an afternoon she
// remembers.

export const ZONE = 'America/Denver';

export type Timestamp = string | Date;

function asDate(value: Timestamp): Date {
  return value instanceof Date ? value : new Date(value);
}

// YYYY-MM-DD in her timezone. en-CA formats that way and sorts as a string.
export function day(value: Timestamp): string {
  return asDate(value).toLocaleDateString('en-CA', { timeZone: ZONE });
}

// "Tuesday, 8 September 2026" from a YYYY-MM-DD key. Parsed at midday UTC so
// no timezone shift can move it across a date boundary.
export function readableDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// For exports, where a locale string would be unsortable and ambiguous.
export function isoDay(value: Timestamp): string {
  return asDate(value).toISOString().slice(0, 10);
}
