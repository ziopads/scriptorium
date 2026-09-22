'use client';

import { useSelectedLayoutSegment } from 'next/navigation';

import { Tabs } from '@/components/workbench/tabs';

// The Gaps page's tab bar: one tab per kind of gap, each at its own address
// under /gaps. A client component only because the active tab is the URL
// segment, as on the book page (components/work-tabs.tsx).

const TABS = [
  { id: 'citations', label: 'Citations', href: '/gaps' },
  { id: 'files', label: 'Files', href: '/gaps/files' },
  { id: 'analysis', label: 'Analysis', href: '/gaps/analysis' },
  { id: 'pages', label: 'Page numbers', href: '/gaps/pages' },
  { id: 'notes', label: 'Internal notes', href: '/gaps/notes' },
] as const;

export function GapsTabs({
  counts,
}: {
  counts: {
    citations: number;
    files: number;
    analysis: number;
    pages: number;
    notes: number;
  };
}) {
  const segment = useSelectedLayoutSegment();
  const active = segment ?? 'citations';

  return (
    <Tabs
      label="Gaps"
      activeId={active}
      items={TABS.map((t) => ({
        id: t.id,
        label: t.label,
        href: t.href,
        badge: counts[t.id] || undefined,
      }))}
    />
  );
}
