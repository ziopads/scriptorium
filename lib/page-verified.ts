// One rule for how far a page number can be trusted, and the two forms it
// takes when a page number leaves the app: the asterisk after the number, and
// the page_verified value. Used by the notes export and the remote MCP server,
// so a quotation reads the same on screen, in the CSV and to Claude
// (docs/PAGE-NUMBERS.md §3).
//
// unverifiedPages() in lib/works.ts is the same rule in SQL, for the screen:
//   offset_problem is not null and pagination_basis is distinct from 'hand_set'
// components/page-number.tsx draws the asterisk; pageLabel is its text form.
// pipeline/mcp_server.py carries a Python copy for the local server.

export type PageVerified = 'yes' | 'hand set' | 'no';

export function isUnverified(offsetProblem: string | null, basis: string | null): boolean {
  return offsetProblem !== null && basis !== 'hand_set';
}

export function pageVerified(unverified: boolean, basis: string | null): PageVerified {
  if (unverified) return 'no';
  if (basis === 'hand_set') return 'hand set';
  return 'yes';
}

export function pageLabel(page: number, unverified: boolean): string {
  return unverified ? `${page}*` : `${page}`;
}
