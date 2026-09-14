import { AttributionFields } from '@/components/attribution-fields';
import { addNote } from '@/lib/actions';

// The note form. On a work page the work is fixed and hidden; on /notes it is
// an optional catalogue id, so a note about nothing on the list can be written.
// Same fields either way, so the instructions describe one form.

export function NoteForm({ workId }: { workId?: string }) {
  return (
    <form action={addNote} className="space-y-4">
      {workId ? (
        <input type="hidden" name="work_id" value={workId} />
      ) : (
        <label className="block space-y-1">
          <span className="text-sm">Work</span>
          <input type="text" name="work_id" placeholder="catalogue id, e.g. adorno-polemics-possession-2007 — or leave empty" />
          <span className="block text-xs text-muted">
            The identifier is shown on the work’s page under Record. Leave empty for a
            note about nothing on the list.
          </span>
        </label>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="kind" value="note" defaultChecked /> Note
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="kind" value="question" /> Question
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-sm">Note</span>
        <textarea name="body" rows={4} required />
        <span className="block text-xs text-muted">
          One claim per note. If this mixes what the author says with what you say,
          write two.
        </span>
      </label>

      <AttributionFields />

      <label className="block space-y-1">
        <span className="text-sm">Quotation</span>
        <textarea name="quote" rows={2} />
        <span className="block text-xs text-muted">
          Verbatim, in the original language. This is what re-locates the note if the
          work is extracted later, so type it as printed. Leave it empty for a note
          about the whole work.
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-sm">Your translation</span>
        <textarea name="translation" rows={2} />
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <label className="w-28 space-y-1">
          <span className="text-sm">Page</span>
          <input type="number" name="printed_page" />
        </label>
        <label className="min-w-56 flex-1 space-y-1">
          <span className="text-sm">Tags</span>
          <input type="text" name="tags" placeholder="comma, separated · lugar:abiquiu" />
        </label>
        <button
          type="submit"
          className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
        >
          Add note
        </button>
      </div>

      <p className="text-xs text-muted">
        The page is the printed folio, not the file page. To add a passage from
        another work, save the note and then use Edit.
      </p>
    </form>
  );
}
