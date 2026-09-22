import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { worksWithInternalNotes } from '@/lib/gaps';

export const dynamic = 'force-dynamic';

// The Gaps page's Internal notes tab: every work whose Internal note is set,
// with the note in full. The note is written on the work's edit page; this
// tab only lists them, so what is known about a file (a partial copy, an
// ebook's page counter, an introduction falling into front matter) can be
// seen in one place rather than one edit page at a time.
//
// Clearing a note on the edit page removes the work from this list.

export default async function GapsNotesPage() {
  await requireAllowedUser();
  const works = await worksWithInternalNotes();

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-sm text-muted">
        {works.length === 1 ? '1 work carries' : `${works.length} works carry`} an
        Internal note: something known about the file that no other tab computes. Write
        or clear the note on the work&rsquo;s edit page.
      </p>

      {works.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className="max-w-4xl divide-y divide-rule border-y border-rule">
          {works.map((w) => (
            <li key={w.id} className="space-y-1 py-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="shrink-0">{w.author ?? '\u2014'}</span>
                <Link href={`/works/${w.id}`} className="min-w-0 flex-1 italic hover:text-accent">
                  {w.title}
                </Link>
                {w.year ? <span className="text-xs text-muted">{w.year}</span> : null}
                <Link href={`/works/${w.id}/edit`} className="text-xs text-muted hover:text-accent">
                  Edit
                </Link>
              </div>
              <p className="whitespace-pre-wrap text-xs">{w.notes_internal}</p>
              {w.offset_problem ? (
                <p className="text-xs text-accent">Page numbering: {w.offset_problem}</p>
              ) : null}
              <p className="font-mono text-xs text-muted">{w.id}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
