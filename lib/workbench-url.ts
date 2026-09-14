// The workbench keeps its state in the URL so every view is linkable and the
// back button works. One helper builds the next URL from the current params
// and a patch; a null value removes a key.
//
//   w     selected work id
//   n     selected note id (the right pane shows it for review)
//   a     selected axis id (the right pane becomes the ficha composer)
//   ws    comma-separated works attached to the note being written
//   pane  left pane tab: catalogue | notes | axes
//   view  centre tab: meta | preview | dossier | notes | axes
//   p     preview page, as the printed folio
//   quote a passage captured in the preview, already normalized, which the
//         note form takes as the quotation's default
//   r     right pane: 0 hides it, giving the centre the room
//
// quote rather than q because q reads as a search, and the left pane's filter
// is the other thing that would want that letter.

export type WorkbenchParams = Record<string, string | undefined>;

export const WB_KEYS = ['w', 'n', 'a', 'ws', 'pane', 'view', 'p', 'quote', 'r'] as const;

export function pick(searchParams: Record<string, string | string[] | undefined>): WorkbenchParams {
  const out: WorkbenchParams = {};
  for (const k of WB_KEYS) {
    const v = searchParams[k];
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  return out;
}

export function href(current: WorkbenchParams, patch: Record<string, string | null | undefined>): string {
  const next: Record<string, string> = {};
  for (const k of WB_KEYS) {
    const v = k in patch ? patch[k] : current[k];
    if (v) next[k] = v;
  }
  const qs = new URLSearchParams(next).toString();
  return qs ? `/?${qs}` : '/';
}

export function attached(current: WorkbenchParams): string[] {
  return current.ws ? current.ws.split(',').filter(Boolean) : [];
}

export function withAttached(current: WorkbenchParams, ids: string[]): string | null {
  const unique = [...new Set(ids)];
  return unique.length ? unique.join(',') : null;
}
