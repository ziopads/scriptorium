'use client';

import { useSelectedLayoutSegment } from 'next/navigation';

import { Tabs } from '@/components/workbench/tabs';

// The book page's tab bar, the same seven tabs as a work in the workbench.
// Each tab is its own address under /works/<id>, so a tab can be linked to and
// the back button works; the header above them is drawn once by the layout.
//
// A client component only because the active tab is the URL segment below
// the layout, which the browser knows and the layout does not. The edit form,
// at /works/<id>/edit, lights no tab.

const TABS = [
  { id: 'meta', label: 'Meta' },
  { id: 'contents', label: 'Contents' },
  { id: 'preview', label: 'Preview' },
  { id: 'dossier', label: 'Dossier' },
  { id: 'claims', label: 'Claims' },
  { id: 'notes', label: 'Notes' },
  { id: 'axes', label: 'Axes' },
] as const;

export function WorkTabs({
  id,
  counts,
}: {
  id: string;
  counts: { claims: number; notes: number; axes: number };
}) {
  const segment = useSelectedLayoutSegment();
  const active = segment ?? 'meta';

  return (
    <Tabs
      label="Book"
      activeId={active}
      items={TABS.map((t) => ({
        id: t.id,
        label: t.label,
        href: t.id === 'meta' ? `/works/${id}` : `/works/${id}/${t.id}`,
        badge:
          t.id === 'claims' ? counts.claims
            : t.id === 'notes' ? counts.notes
              : t.id === 'axes' ? counts.axes
                : undefined,
      }))}
    />
  );
}
