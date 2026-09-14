import Link from 'next/link';

// The tab bar, used by both the left and the centre pane.
//
// The active tab was marked in accent (#7a2f1d) against muted (#6f6a62) for
// the rest. Those two differ in hue and barely in lightness — about 1.7:1
// against each other — so at 13px the bar read as five words in one colour.
// The active tab is now a box: white fill, a hairline on three sides, and its
// bottom edge sitting over the bar's rule so the rule breaks where the tab is.
// White already means "the thing you are looking at" in the left pane's row
// list, so this is the same signal at a different size.
//
// No hooks, so it renders inside the server centre pane and the client left
// pane alike.

export interface TabItem {
  id: string;
  label: string;
  href: string;
  badge?: number;
}

export function Tabs({
  items,
  activeId,
  label,
}: {
  items: TabItem[];
  activeId: string;
  label: string; // for screen readers: "Left pane", "Work"
}) {
  return (
    <nav aria-label={label} className="flex items-end gap-0.5 border-b border-rule">
      {items.map((t) => {
        const active = t.id === activeId;
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? '-mb-px rounded-t-sm border border-b-0 border-rule bg-white px-2.5 pb-1.5 pt-1 text-sm font-medium text-foreground'
                : 'px-2.5 pb-1.5 pt-1 text-sm text-muted hover:text-accent'
            }
          >
            {t.label}
            {t.badge ? <span className="pl-1 text-xs text-muted">{t.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
