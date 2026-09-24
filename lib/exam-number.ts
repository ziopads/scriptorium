// The exam number as she uses it: list numeral, section letter, ordinal
// (I.E.2), and I.Supl.3 for a supplementary item so that every item has a
// number of its own. Derived, never stored (migration 004).
//
// Used by the reading list (app/lists/page.tsx) and the readiness matrix
// (app/readiness/page.tsx). The workbench derives the same code in SQL, in
// listWorkbenchRows (lib/works.ts), as "Supl. I" with a space; change one,
// look at the other.

const NUMERAL: Record<string, string> = { theory: 'I', dissertation: 'II', teaching: 'III' };

export function examNumber(
  listId: string,
  section: { letter: string | null; kind: string } | undefined,
  ordinal: number | null,
): string | null {
  const numeral = NUMERAL[listId];
  if (!numeral) return null;
  const n = ordinal ?? '?';
  if (section?.kind === 'supplementary') return `${numeral}.Supl.${n}`;
  return `${numeral}.${section?.letter ?? '?'}.${n}`;
}
