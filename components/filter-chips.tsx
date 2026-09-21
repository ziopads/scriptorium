import Link from 'next/link';

// A row of sub-tabs under a tab: each a link that sets a query parameter, so
// the choice is in the URL and survives scrolling, reloading and the back
// button. Used by the Gaps tabs (Files, Analysis, Page numbers) and the book
// page's Claims tab, which is where the style began.

export interface Chip {
  id: string;
  label: string;
  count: number;
  href: string;
}

export function FilterChips({
  chips,
  active,
  label,
}: {
  chips: Chip[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 text-sm">
      {chips.map((c) => (
        <Link
          key={c.id}
          href={c.href}
          aria-current={c.id === active ? 'page' : undefined}
          className={
            c.id === active
              ? 'border border-accent px-2.5 py-1 text-accent'
              : 'border border-rule px-2.5 py-1 text-muted hover:text-accent'
          }
        >
          {c.label} <span className="text-xs">{c.count}</span>
        </Link>
      ))}
    </nav>
  );
}
