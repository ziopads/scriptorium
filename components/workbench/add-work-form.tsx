import { ResettingForm } from '@/components/resetting-form';
import { SubmitButton } from '@/components/submit-button';
import { addStubWork } from '@/lib/actions';
import { KIND_LABEL, type WorkKind } from '@/lib/types';

// Adding a work without leaving the workbench.
//
// Two cases, one form. A book she has just seen cited and wants for the
// dissertation, which needs nothing but a title. And a tale or essay inside
// something she is reading, which needs a container and a page range — the
// only way a tale in Rael ever becomes citable, since the collection holds
// hundreds and perhaps a dozen will be written about.
//
// Collapsed by default: the right pane is already a tall column and this is
// occasional. Open, it defaults the container and the first page from whatever
// is on screen in the Preview tab, so the common case is a title and Save.
//
// The work is created with standing 'added' and no imprint, and attached to
// the note being written in the same action. /gaps is where the publisher and
// place get filled in later.

const KINDS: WorkKind[] = ['monograph', 'essay', 'chapter', 'poem', 'edited_volume', 'anthology', 'film'];

export function AddWorkForm({
  returnTo,
  containerId,
  containerLabel,
  page,
}: {
  returnTo: string;
  containerId?: string;   // the work open in the centre, when it holds pages
  containerLabel?: string;
  page?: string;          // the printed folio she is reading
}) {
  return (
    <details className="border-t border-rule pt-2">
      <summary className="cursor-pointer text-xs text-muted hover:text-accent">
        Add a work
      </summary>

      <ResettingForm action={addStubWork} className="space-y-3 pt-3">
        <input type="hidden" name="return_to" value={returnTo} />

        <label className="block space-y-1">
          <span className="text-xs text-muted">Title</span>
          <input type="text" name="title" required />
        </label>

        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 space-y-1">
            <span className="text-xs text-muted">Author</span>
            <input type="text" name="author" placeholder="Surname, Given" />
          </label>
          <label className="w-20 space-y-1">
            <span className="text-xs text-muted">Year</span>
            <input type="number" name="year" />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-muted">Kind</span>
          <select name="kind" defaultValue={containerId ? 'essay' : 'monograph'}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>

        {containerId ? (
          <div className="space-y-2 border-l-2 border-rule pl-3">
            <label className="flex items-baseline gap-2 text-xs text-muted">
              <input type="checkbox" name="container_id" value={containerId} defaultChecked className="w-auto" />
              <span>
                Inside <span className="italic">{containerLabel}</span>
              </span>
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <label className="w-24 space-y-1">
                <span className="text-xs text-muted">First page</span>
                <input type="number" name="first_page" defaultValue={page} />
              </label>
              <label className="w-24 space-y-1">
                <span className="text-xs text-muted">Last page</span>
                <input type="number" name="last_page" />
              </label>
            </div>
          </div>
        ) : null}

        <div className="flex items-baseline gap-3">
          <SubmitButton>Add and attach</SubmitButton>
          <span className="text-xs text-muted">
            Added by her, no imprint yet — fill it in at{' '}
            <span className="font-mono">/gaps</span>.
          </span>
        </div>
      </ResettingForm>
    </details>
  );
}
