'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The site's main navigation, marked the way the Gaps and book-page tabs are
// (components/workbench/tabs.tsx): the current section is a white box whose
// bottom edge sits on the header's rule, so the rule breaks where she is. A
// client component only because the current section is read from the URL.
//
// A section is current on its own address and everything under it (/works and
// /works/abc), except the Workbench at /, which is current only on / itself.

export interface NavItem {
  href: string;
  label: string;
}

export function MainNav({ items }: { items: NavItem[] }) {
  const path = usePathname() ?? '/';
  const current = (href: string) =>
    href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);

  return (
    <nav aria-label="Main" className="flex items-end gap-0.5">
      {items.map((item) => {
        const active = current(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? '-mb-px rounded-t-sm border border-b-0 border-rule bg-white px-2.5 pb-2 pt-1.5 text-sm font-medium text-foreground'
                : 'px-2.5 pb-2 pt-1.5 text-sm text-muted hover:text-accent'
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
