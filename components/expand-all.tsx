'use client';

// Opens or closes every <details> on the page carrying data-group={group}.
// The sections themselves stay plain <details>, which open and close without
// any client code; only this pair of buttons needs the browser.

export function ExpandAll({ group }: { group: string }) {
  function set(open: boolean) {
    document
      .querySelectorAll<HTMLDetailsElement>(`details[data-group="${group}"]`)
      .forEach((d) => {
        d.open = open;
      });
  }

  return (
    <span className="flex gap-3 text-xs">
      <button type="button" onClick={() => set(true)} className="text-accent hover:underline underline-offset-2">
        Expand all
      </button>
      <button type="button" onClick={() => set(false)} className="text-accent hover:underline underline-offset-2">
        Collapse all
      </button>
    </span>
  );
}
