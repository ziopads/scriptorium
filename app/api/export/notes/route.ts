import { getAllowedUser } from '@/lib/auth/guard';
import { formatNote, plain } from '@/lib/citation';
import { csvResponse, toCsv } from '@/lib/csv';
import { listAllNotes, getAxisTree } from '@/lib/notes';
import { listWorks, unverifiedPages } from '@/lib/works';
import type { NoteWithRelations, Work } from '@/lib/types';

export const dynamic = 'force-dynamic';

// One row per relation between a note and a work, not per note. A note that
// touches two works is a connection, and flattening it to one row would hide
// the second half of the thought. A note that touches no work still gets one
// row, with the work columns empty.
//
// origin, reviewed and attribution are columns rather than a footnote. An
// export that does not say which sentences she wrote, and whose claim each
// one asserts, is worse than no export, because the ambiguity travels with
// the file. Rejected proposals are not exported.
//
// Axes are flattened: each part becomes rows of its own with the axis title in
// the axis column, so the file reads as her mapa did.
//
// A page number leaves the app here, on its way into her drafts, so it carries
// the same mark it carries on screen (docs/PAGE-NUMBERS.md §3): an asterisk
// after the page inside the citation, and a page_verified column to filter on.
// The rule is unverifiedPages(), the one the app uses. page_verified is 'no'
// for a marked work, 'hand set' for a numbering reviewed by hand, 'yes'
// otherwise — which means only that the app does not mark it; a work loaded
// but never checked reads 'yes' too. Empty on rows with no page.
export async function GET() {
  const user = await getAllowedUser();
  if (!user) return new Response('Not authorized', { status: 401 });

  const [top, works, unverified] = await Promise.all([
    listAllNotes(),
    listWorks(),
    unverifiedPages(),
  ]);
  const byId = new Map(works.map((w) => [w.id, w]));

  // Expand axes into their parts.
  const notes: { note: NoteWithRelations; axis: string | null; part: string }[] = [];
  for (const note of top) {
    if (note.kind !== 'axis') {
      notes.push({ note, axis: null, part: note.kind });
      continue;
    }
    const tree = await getAxisTree(note.id);
    if (!tree) continue;
    notes.push({ note: tree.axis, axis: note.title, part: 'thesis' });
    for (const f of tree.fichas) notes.push({ note: f, axis: note.title, part: 'ficha' });
    if (tree.synthesis) notes.push({ note: tree.synthesis, axis: note.title, part: 'synthesis' });
    if (tree.exam_move) notes.push({ note: tree.exam_move, axis: note.title, part: 'exam_move' });
  }

  const rows = notes.flatMap(({ note, axis, part }) => {
    const provenance =
      note.origin === 'human'
        ? 'written by hand'
        : note.reviewed
          ? 'found by Claude, confirmed by her'
          : 'assistant proposal, UNREVIEWED';

    const whose =
      note.attribution === null
        ? 'UNCLASSIFIED'
        : note.attribution === 'other'
          ? `other: ${note.attributed_to ?? '?'}`
          : note.attribution;

    const touched = [
      ...note.anchors.map((a) => ({
        relation: 'passage',
        role: '',
        work_id: a.work_id,
        work_author: a.work_author,
        work_title: a.work_title,
        printed_page: a.printed_page,
        quote: a.quote,
        translation: a.translation,
      })),
      ...note.works.map((w) => ({
        relation: 'work',
        role: w.role,
        work_id: w.work_id,
        work_author: w.work_author,
        work_title: w.work_title,
        printed_page: null as number | null,
        quote: null as string | null,
        translation: null as string | null,
      })),
    ];
    if (touched.length === 0) {
      touched.push({
        relation: '', role: '', work_id: '', work_author: null, work_title: '',
        printed_page: null, quote: null, translation: null,
      });
    }

    const also = [...new Set(touched.map((t) => t.work_title).filter(Boolean))];

    return touched.map((t) => {
      const work = t.work_id ? byId.get(t.work_id) : undefined;
      const container = work?.container_id ? byId.get(work.container_id) ?? null : null;

      return {
        note_id: note.id,
        kind: part,
        axis: axis ?? '',
        title: note.title ?? '',
        relation: t.relation,
        role: t.role,
        relations_in_note: touched.filter((x) => x.work_id).length,
        also_touching: also.filter((x) => x !== t.work_title),
        work_id: t.work_id,
        work_author: t.work_author,
        work_title: t.work_title,
        printed_page: t.printed_page,
        page_verified: pageVerified(work, t.printed_page, unverified),
        quote: t.quote,
        translation: t.translation,
        body: note.body,
        whose_claim: whose,
        tags: note.tags,
        citation: work
          ? markPage(
              plain(formatNote(work, container, t.printed_page).text),
              t.printed_page,
              unverified.has(work.id),
            )
          : '',
        provenance,
        created_at: note.created_at,
        updated_at: note.updated_at,
      };
    });
  });

  const columns = [
    'note_id', 'kind', 'axis', 'title', 'relation', 'role', 'relations_in_note',
    'also_touching', 'work_id', 'work_author', 'work_title', 'printed_page',
    'page_verified',
    'quote', 'translation', 'body', 'whose_claim', 'tags', 'citation',
    'provenance', 'created_at', 'updated_at',
  ];

  return csvResponse('scriptorium-notes', toCsv(columns, rows));
}

function pageVerified(
  work: Work | undefined,
  page: number | null,
  unverified: Set<string>,
): string {
  if (!work || page === null) return '';
  if (unverified.has(work.id)) return 'no';
  if (work.pagination_basis === 'hand_set') return 'hand set';
  return 'yes';
}

// formatNote ends a citation with ", {page}." (lib/citation.ts). The mark goes
// after the number, as on screen. It is added after plain(), which strips every
// asterisk. If the ending is not there the citation is left alone rather than
// guessed at.
function markPage(citation: string, page: number | null, mark: boolean): string {
  if (!mark || page === null) return citation;
  const ending = `, ${page}.`;
  if (!citation.endsWith(ending)) return citation;
  return `${citation.slice(0, -ending.length)}, ${page}*.`;
}
