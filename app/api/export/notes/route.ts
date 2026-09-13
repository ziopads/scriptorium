import { getAllowedUser } from '@/lib/auth/guard';
import { formatNote, plain } from '@/lib/citation';
import { csvResponse, toCsv } from '@/lib/csv';
import { listAllNotes } from '@/lib/notes';
import { listWorks } from '@/lib/works';

export const dynamic = 'force-dynamic';

// One row per anchor, not per note. A note with two anchors is a connection, and
// flattening it to a single row would hide the second half of the thought — the
// thing the connection exists to record.
//
// origin and reviewed are columns rather than a footnote. An export that does
// not say which sentences she wrote is worse than no export, because the
// ambiguity travels with the file.
export async function GET() {
  const user = await getAllowedUser();
  if (!user) return new Response('Not authorized', { status: 401 });

  const [notes, works] = await Promise.all([listAllNotes(), listWorks()]);
  const byId = new Map(works.map((w) => [w.id, w]));

  const rows = notes.flatMap((note) => {
    const provenance =
      note.origin === 'human'
        ? 'written by hand'
        : note.reviewed
          ? 'assistant draft, reviewed'
          : 'assistant draft, UNREVIEWED';

    const others = note.anchors.map((a) => a.work_title);

    return note.anchors.map((anchor) => {
      const work = byId.get(anchor.work_id);
      const container = work?.container_id ? byId.get(work.container_id) ?? null : null;

      return {
        note_id: note.id,
        anchor: anchor.ordinal,
        anchors_in_note: note.anchors.length,
        connection: note.anchors.length > 1 ? 'yes' : '',
        also_anchored_to: others.filter((t) => t !== anchor.work_title),
        work_id: anchor.work_id,
        work_author: anchor.work_author,
        work_title: anchor.work_title,
        printed_page: anchor.printed_page,
        quote: anchor.quote,
        body: note.body,
        tags: note.tags,
        citation: work ? plain(formatNote(work, container, anchor.printed_page).text) : '',
        provenance,
        created_at: note.created_at,
        updated_at: note.updated_at,
      };
    });
  });

  const columns = [
    'note_id', 'anchor', 'anchors_in_note', 'connection', 'also_anchored_to',
    'work_id', 'work_author', 'work_title', 'printed_page', 'quote', 'body',
    'tags', 'citation', 'provenance', 'created_at', 'updated_at',
  ];

  return csvResponse('scriptorium-notes', toCsv(columns, rows));
}
