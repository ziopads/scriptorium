import { NoteCard } from '@/components/note-card';
import { NoteForm } from '@/components/note-form';
import { requireAllowedUser } from '@/lib/auth/guard';
import { listNotesForWork } from '@/lib/notes';

export const dynamic = 'force-dynamic';

// The book page's Notes tab: every note that touches the book, through a
// passage or as a whole, and the form for a new one. Dossier claims appear
// here once she has accepted them.

export default async function WorkNotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;
  const notes = await listNotesForWork(id);

  return (
    <div className="space-y-4">
      {notes.length === 0 ? (
        <p className="text-sm text-muted">No notes touch this work yet.</p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} workId={id} />
          ))}
        </ul>
      )}

      <div className="border-t border-rule pt-4">
        <h3 className="mb-3 text-sm">New note on this work</h3>
        <NoteForm workId={id} />
      </div>
    </div>
  );
}
