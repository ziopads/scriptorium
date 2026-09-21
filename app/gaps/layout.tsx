import type { ReactNode } from 'react';

import { GapsTabs } from '@/components/gaps-tabs';
import { requireAllowedUser } from '@/lib/auth/guard';
import { analysisStates, fileStates, uncheckedOffsets } from '@/lib/gaps';
import { incompleteWorks, worksWithOffsetProblems } from '@/lib/works';

export const dynamic = 'force-dynamic';

// What the catalogue still lacks, one tab per kind of gap. Each tab's badge
// counts what is outstanding there: records missing a citation field, books
// not yet searchable, books with pages but no study aid, and page numbering
// unsettled or unchecked.

export default async function GapsLayout({ children }: { children: ReactNode }) {
  await requireAllowedUser();

  const [entries, files, analysis, problems, unchecked] = await Promise.all([
    incompleteWorks(),
    fileStates(),
    analysisStates(),
    worksWithOffsetProblems(),
    uncheckedOffsets(),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl">Gaps</h1>
        <p className="text-sm text-muted">
          What the catalogue still lacks, computed from the database each time the page
          opens.
        </p>
      </header>

      <GapsTabs
        counts={{
          citations: entries.length,
          files: files.filter((f) => f.state !== 'searchable').length,
          analysis: analysis.filter((a) => !a.has_aid).length,
          pages: problems.length + unchecked.length,
        }}
      />

      <div>{children}</div>
    </div>
  );
}
