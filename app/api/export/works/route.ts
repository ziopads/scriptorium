import { getAllowedUser } from '@/lib/auth/guard';
import { formatBibliography, plain } from '@/lib/citation';
import { csvResponse, toCsv } from '@/lib/csv';
import { allMemberships, examinableIds, listWorks } from '@/lib/works';

export const dynamic = 'force-dynamic';

// Every work, every column, plus both citation forms and list membership. This
// is the backup: if the application disappeared, this file and the notes export
// are the work.
//
// getAllowedUser rather than requireAllowedUser, because requireAllowedUser
// redirects — a download endpoint answering with a redirect saves a file full of
// sign-in HTML instead of reporting an error.
export async function GET() {
  const user = await getAllowedUser();
  if (!user) return new Response('Not authorized', { status: 401 });

  const [works, memberships, examinable] = await Promise.all([
    listWorks(),
    allMemberships(),
    examinableIds(),
  ]);

  const byId = new Map(works.map((w) => [w.id, w]));
  const byWork = new Map<string, typeof memberships>();
  for (const m of memberships) {
    const existing = byWork.get(m.work_id);
    if (existing) existing.push(m);
    else byWork.set(m.work_id, [m]);
  }

  const rows = works.map((work) => {
    const container = work.container_id ? byId.get(work.container_id) ?? null : null;
    const lists = byWork.get(work.id) ?? [];
    const chicago = formatBibliography(work, container, 'chicago');
    const mla = formatBibliography(work, container, 'mla');

    return {
      ...work,
      container_title: container?.title ?? '',
      examinable: examinable.has(work.id) ? 'yes' : 'no',
      lists: lists.map((l) => l.list),
      sections: lists.map((l) => l.section ?? ''),
      chicago: plain(chicago.text),
      mla: plain(mla.text),
      missing_fields: chicago.missing,
    };
  });

  const columns = [
    'id', 'kind', 'author', 'title', 'subtitle', 'container_id', 'container_title',
    'first_page', 'last_page', 'translator', 'editor', 'publisher', 'place',
    'year', 'original_year', 'edition', 'volume', 'series', 'isbn', 'language',
    'url', 'doi', 'accessed',
    'examinable', 'lists', 'sections', 'purpose', 'standing', 'standing_note',
    'status', 'source_format', 'page_offset',
    'chicago', 'mla', 'missing_fields', 'notes_internal', 'updated_at',
  ];

  return csvResponse('scriptorium-works', toCsv(columns, rows));
}
