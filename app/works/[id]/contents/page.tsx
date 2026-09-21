import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { listSections } from '@/lib/sections';

export const dynamic = 'force-dynamic';

// The book page's Contents tab: the chapter map from the sections table, each
// entry opening the book page's Preview at its first page. The same data as
// the workbench's Contents tab.

export default async function WorkContentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;
  const sections = await listSections(id);

  if (sections.length === 0) {
    return (
      <p className="text-sm text-muted">
        No chapter map for this work. The extractor found neither an embedded outline
        nor running heads it could trust; a map can be entered by hand from the
        printed table of contents.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="max-w-3xl divide-y divide-rule border-y border-rule text-sm">
        {sections.map((s) => (
          <li key={s.ordinal} className="py-1.5">
            <Link
              href={`/works/${id}/preview?p=${s.first_page}`}
              className="flex items-baseline gap-3 hover:text-accent"
              style={{ paddingLeft: `${(s.level - 1) * 1.25}rem` }}
            >
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              <span className="shrink-0 font-mono text-xs text-muted">
                {s.first_page}
                {s.last_page !== null && s.last_page !== s.first_page ? `–${s.last_page}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        {sections[0].source === 'outline'
          ? 'From the file’s own table of contents.'
          : sections[0].source === 'running heads'
            ? 'Inferred from the running heads. Check it against the printed contents.'
            : 'Entered by hand.'}
      </p>
    </div>
  );
}
