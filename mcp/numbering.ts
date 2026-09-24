// How far a work's page numbers can be trusted, as the MCP tools report it.
//
// THREE COPIES OF ONE RULE, which must agree:
//   pipeline/mcp_server.py   numbering(), page_numbers()   the local server
//   mcp/numbering.ts          this file                     the remote server
//   lib/works.ts              unverifiedPages()             the app's asterisk
// The rule is docs/PAGE-NUMBERS.md §3: a work is marked when offset_problem is
// set and pagination_basis is anything but hand_set, a null basis counting as
// marked. Acceptance takes precedence over offset_problem for citability, and
// changes the wording, not the mark. The mark itself, and page_verified, are
// in lib/page-verified.ts, shared with the notes export.

export function numbering(
  checked: boolean,
  problem: string | null,
  accepted: boolean,
  basis: string | null,
): string {
  if (problem && accepted) {
    return basis === 'hand_set' ? 'accepted (hand set)' : 'accepted (no printed numbers)';
  }
  if (problem) return `problem: ${problem}`;
  return checked ? 'checked' : 'unchecked';
}

export function pageNumbers(
  checked: boolean,
  problem: string | null,
  accepted: boolean,
  basis: string | null,
): string {
  if (problem && basis !== 'hand_set') {
    return accepted
      ? "unverified: the file's own page, not the edition's"
      : 'unverified: numbering unsettled';
  }
  if (basis === 'hand_set') return 'hand set';
  return checked ? 'verified' : 'unchecked';
}
