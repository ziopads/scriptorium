import type { ReactNode } from 'react';
import Link from 'next/link';

import { AttributionFields } from '@/components/attribution-fields';
import { ResettingForm } from '@/components/resetting-form';
import { SubmitButton } from '@/components/submit-button';
import { addNote } from '@/lib/actions';

// The note form, in three settings.
//
//   work page   one fixed work, hidden
//   /notes      an optional catalogue id typed by hand
//   workbench   the works attached by clicking rows in the left pane, shown
//               as chips; the ids never appear in front of her
//
// Same fields either way, so the instructions describe one form. With a quote
// or a page the first attached work carries the anchor; the rest are
// whole-work relations.
//
// defaultQuote and defaultPage arrive from a passage selected in the Preview
// tab, carried in the URL. The key on those two fields is what makes that
// work: changing defaultValue on a mounted uncontrolled input does nothing, so
// the field has to be remounted. Keyed narrowly, on the quotation and the page
// alone, so a note body already typed survives the capture.
//
// ResettingForm and SubmitButton are here for the same reason as each other:
// after a save the form used to keep every value and the URL did not change,
// which looked exactly like a failure. The button now refuses a second press
// while the first is in flight, and the form empties when the action returns.

export interface AttachedWork {
  id: string;
  label: string;   // "Adorno, The Polemics of Possession"
  removeHref?: string;
}

export function NoteForm({
  workId,
  works,
  returnTo,
  compact = false,
  defaultQuote,
  defaultPage,
  clearQuoteHref,
  captureSlot,
}: {
  workId?: string;
  works?: AttachedWork[];
  returnTo?: string;
  compact?: boolean;
  defaultQuote?: string;
  defaultPage?: string;
  clearQuoteHref?: string;
  captureSlot?: ReactNode; // "Use selection", when a page is open beside this
}) {
  const attached = works ?? [];

  return (
    <ResettingForm action={addNote} className="space-y-4">
      {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}

      {workId ? (
        <input type="hidden" name="work_id" value={workId} />
      ) : works ? (
        <div className="space-y-1">
          <span className="text-sm">Works</span>
          <input type="hidden" name="work_ids" value={attached.map((w) => w.id).join(',')} />
          {attached.length === 0 ? (
            <p className="text-xs text-muted">
              None attached. Select a work in the list, or press + on a row to add it.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {attached.map((w, i) => (
                <li key={w.id} className="flex items-center gap-1 border border-rule px-2 py-0.5 text-xs">
                  {i === 0 && attached.length > 1 ? <span className="text-muted">quote in </span> : null}
                  <span>{w.label}</span>
                  {w.removeHref ? (
                    <Link href={w.removeHref} className="text-muted hover:text-accent" aria-label={`Remove ${w.label}`}>
                      ×
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
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
        <textarea name="body" rows={compact ? 5 : 4} required className="reading" />
        {compact ? null : (
          <span className="block text-xs text-muted">
            One claim per note. If this mixes what the author says with what you say,
            write two.
          </span>
        )}
      </label>

      <AttributionFields />

      <label className="block space-y-1">
        <span className="flex items-baseline gap-2 text-sm">
          Quotation
          {defaultQuote && clearQuoteHref ? (
            <Link href={clearQuoteHref} className="text-xs text-muted hover:text-accent">
              clear
            </Link>
          ) : null}
          {captureSlot}
        </span>
        <textarea
          key={`quote:${defaultQuote ?? ''}`}
          name="quote"
          rows={defaultQuote ? 5 : 3}
          className="reading"
          defaultValue={defaultQuote}
        />
        {compact ? null : (
          <span className="block text-xs text-muted">
            Verbatim, in the original language. This is what re-locates the note if the
            work is extracted later, so type it as printed. Leave it empty for a note
            about the whole work.
          </span>
        )}
      </label>

      <label className="block space-y-1">
        <span className="text-sm">Your translation</span>
        <textarea name="translation" rows={2} className="reading" />
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <label className="w-24 space-y-1">
          <span className="text-sm">Page</span>
          <input
            key={`page:${defaultPage ?? ''}`}
            type="number"
            name="printed_page"
            defaultValue={defaultPage}
          />
        </label>
        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-sm">Tags</span>
          <input type="text" name="tags" placeholder="comma, separated · lugar:abiquiu" />
        </label>
        <SubmitButton>Add note</SubmitButton>
      </div>

      {compact ? null : (
        <p className="text-xs text-muted">
          The page is the printed folio, not the file page. To add a passage from
          another work, save the note and then use Edit.
        </p>
      )}
    </ResettingForm>
  );
}
