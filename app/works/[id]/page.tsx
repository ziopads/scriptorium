import Link from 'next/link';
import { notFound } from 'next/navigation';

import { changeStatus } from '@/lib/actions';
import { requireAllowedUser } from '@/lib/auth/guard';
import { formatBibliography, formatNote, formatShortNote, plain } from '@/lib/citation';
import { getWorkWithContainer, listContents } from '@/lib/works';
import { PURPOSE_LABEL, STANDING_LABEL, STATUS_LABEL } from '@/lib/types';

export const dynamic = 'force-dynamic';

// The book page's Meta tab: citations, the record, and where she is with it.
// The header and tab bar are the layout's; notes are on the Notes tab.

const STATUSES = ['unread', 'reading', 'read'] as const;

const SOURCE_LABEL: Record<string, string> = {
  pdf_text: 'PDF with a text layer',
  pdf_ocr: 'scanned PDF, OCR applied',
  epub: 'EPUB — locatable, not citable',
  none: 'no file held',
};

function Field({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === '') return null;
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function WorkMetaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;

  const work = await getWorkWithContainer(id);
  if (!work) notFound();

  const contents = await listContents(id);

  const chicago = formatBibliography(work, work.container, 'chicago');
  const mla = formatBibliography(work, work.container, 'mla');
  const note = formatNote(work, work.container, null);
  const shortNote = formatShortNote(work, null);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-base">Citations</h2>

        {chicago.missing.length > 0 ? (
          <p className="text-xs text-accent">
            Incomplete — missing {chicago.missing.join(', ')}. Every form emits what is
            known and nothing more.
          </p>
        ) : null}

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted">Bibliography entry · Chicago</p>
          <p className="border-l-2 border-rule pl-3 text-sm">{plain(chicago.text)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted">Works cited · MLA</p>
          <p className="border-l-2 border-rule pl-3 text-sm">{plain(mla.text)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted">Footnote, first citation · Chicago</p>
          <p className="border-l-2 border-rule pl-3 text-sm">{plain(note.text)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted">Footnote, later citations · Chicago</p>
          <p className="border-l-2 border-rule pl-3 text-sm">
            {plain(shortNote.text).replace(/\.$/, '')}, <span className="text-muted">page</span>.
          </p>
        </div>
      </section>

      {contents.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-base">Essays in this volume</h2>
          <p className="text-xs text-muted">
            Each is examinable because the volume is listed, and each can carry its own
            notes and dossier.
          </p>
          <ul className="divide-y divide-rule border-y border-rule text-sm">
            {contents.map((essay) => (
              <li key={essay.id} className="py-2">
                <Link href={`/works/${essay.id}`} className="hover:text-accent">
                  {essay.author ? `${essay.author}. ` : null}
                  “{essay.title}”
                  {essay.first_page !== null ? (
                    <span className="text-muted">
                      {' '}
                      {essay.first_page}
                      {essay.last_page !== null ? `–${essay.last_page}` : null}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-base">Record</h2>
        <dl className="text-sm">
          <Field label="Purpose" value={PURPOSE_LABEL[work.purpose]} />
          <Field label="Standing" value={STANDING_LABEL[work.standing]} />
          <Field label="Translator" value={work.translator} />
          <Field label="Editor" value={work.author ? work.editor : null} />
          <Field label="Publisher" value={work.publisher} />
          <Field label="Place" value={work.place} />
          <Field label="Year" value={work.year} />
          <Field label="First published" value={work.original_year} />
          <Field label="Edition" value={work.edition} />
          <Field label="Volume" value={work.volume} />
          <Field label="Series" value={work.series} />
          <Field label="ISBN" value={work.isbn} />
          <Field label="Language" value={work.language} />
          <Field label="Source" value={SOURCE_LABEL[work.source_format]} />
          <Field label="Page offset" value={work.page_offset === 0 ? null : work.page_offset} />
          <Field label="Identifier" value={work.id} />
        </dl>

        {work.standing_note ? (
          <div className="border-l-2 border-accent pl-3 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted">On its standing</p>
            <p>{work.standing_note}</p>
          </div>
        ) : null}

        {work.notes_internal ? (
          <p className="border-l-2 border-rule pl-3 text-xs text-muted">{work.notes_internal}</p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-base">Reading</h2>
        <form action={changeStatus} className="flex items-center gap-2 text-sm">
          <input type="hidden" name="id" value={work.id} />
          <select name="status" defaultValue={work.status} className="w-40">
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          <button type="submit" className="text-accent hover:underline underline-offset-2">
            Save
          </button>
        </form>
      </section>
    </div>
  );
}
