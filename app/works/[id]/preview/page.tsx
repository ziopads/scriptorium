import { notFound } from 'next/navigation';

import { PageView } from '@/components/workbench/page-view';
import { requireAllowedUser } from '@/lib/auth/guard';
import { loadPreview } from '@/lib/pages';
import { sectionAt } from '@/lib/sections';
import { getWork } from '@/lib/works';

export const dynamic = 'force-dynamic';

// The book page's Preview tab: one page at a time, the same viewer as the
// workbench's, turning pages at /works/<id>/preview?p=N. Capturing a passage
// into a note stays in the workbench, where the note form is; the viewer links
// there from the page in front of her.

export default async function WorkPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;
  const { p } = await searchParams;

  const work = await getWork(id);
  if (!work) notFound();

  const preview = await loadPreview(id, p);
  if (!preview) {
    return (
      <p className="text-sm text-muted">
        {work.source_format === 'none'
          ? 'No file is held for this work, so there is no page text to show.'
          : 'A file is held for this work, but its pages have not been extracted and loaded yet.'}
      </p>
    );
  }

  const inSection = await sectionAt(id, preview.page.printed_page);

  return (
    <div className="space-y-2">
      {inSection ? <p className="text-xs text-muted">{inSection.title}</p> : null}
      <PageView
        params={{ w: id }}
        page={preview.page}
        bounds={preview.bounds}
        language={work.language}
        offsetWrong={preview.offsetWrong}
        basePath={`/works/${id}/preview`}
      />
    </div>
  );
}
