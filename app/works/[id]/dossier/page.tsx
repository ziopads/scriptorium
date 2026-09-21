import { notFound } from 'next/navigation';

import { DossierView } from '@/components/workbench/dossier-view';
import { requireAllowedUser } from '@/lib/auth/guard';
import { getDossier } from '@/lib/dossier';
import { getWork } from '@/lib/works';

export const dynamic = 'force-dynamic';

// The book page's Dossier tab: the study aid, with every page opening the book
// page's own Preview.

export default async function WorkDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;

  const [work, dossier] = await Promise.all([getWork(id), getDossier(id)]);
  if (!work) notFound();

  if (!dossier) {
    return <p className="text-sm text-muted">No dossier yet for this work.</p>;
  }

  return (
    <div className="max-w-3xl">
      <DossierView
        dossier={dossier}
        pageHref={(page) => `/works/${id}/preview?p=${page}`}
        workId={id}
        language={work.language}
      />
    </div>
  );
}
