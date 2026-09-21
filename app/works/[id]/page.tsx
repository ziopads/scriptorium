import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NoteCard } from '@/components/note-card';
import { NoteForm } from '@/components/note-form';
import { Stars } from '@/components/stars';
import { changeStatus } from '@/lib/actions';
import { requireAllowedUser } from '@/lib/auth/guard';
import { formatBibliography, formatNote, plain } from '@/lib/citation';
import { listNotesForWork } from '@/lib/notes';
import {
  examinableIds,
  getWorkWithContainer,
  listContents,
  membershipsFor,
} from '@/lib/works';
import { KIND_LABEL, PURPOSE_LABEL, STANDING_LABEL } from '@/lib/types';

export const dynamic = 'force-dynamic';

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

export default async function WorkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;

  const work = await getWorkWithContainer(id);
  if (!work) notFound();

  const [memberships, notes, contents, examinable] = await Promise.all([
    membershipsFor(id),
    listNotesForWork(id),
    listContents(id),
    examinableIds(),
  ]);

  const chicago = formatBibliography(work, work.container, 'chicago');
  const mla = formatBibliography(work, work.container, 'mla');
  const note = formatNote(work, work.container, null);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        {work.container ? (
          <p className="text-xs text-muted">
            in{' '}
            <Link href={`/works/${work.container.id}`} className="italic hover:text-accent">
              {work.container.title}
            </Link>
          </p>
        ) : null}

        <h1 className="text-2xl italic">{work.title}</h1>
        {work.subtitle ? <p className="text-lg italic text-muted">{work.subtitle}</p> : null}
        <p className="text-sm text-muted">
          {work.author ?? work.editor ?? 'Author unknown'}
          {work.kind !== 'monograph' ? ` · ${KIND_LABEL[work.kind]}` : null}
          {examinable.has(work.id) ? null : ' · not examinable'}
        </p>

        <div className="flex items-baseline gap-2 text-sm">
          <span className="text-muted">Rating</span>
          <Stars id={work.id} value={work.priority} />
        </div>

        <div className="flex flex-wrap items-baseline gap-3 pt-2 text-sm">
          {memberships.map((m) => (
            <Link
              key={m.id}
              href={`/works?list=${m.id}`}
              className="text-accent hover:underline underline-offset-2"
            >
              {m.name}
              {m.section_title ? (
                <span className="text-muted"> · {m.section_letter}. {m.section_title}</span>
              ) : null}
              {m.section_kind === 'supplementary' ? (
                <span className="text-muted"> (supplementary)</span>
              ) : null}
            </Link>
          ))}
          {work.has_pages ? (
            <Link
              href={`/?w=${encodeURIComponent(work.id)}`}
              className="ml-auto text-accent hover:underline underline-offset-2"
              title="Open the text in the workbench"
            >
              Read
            </Link>
          ) : null}
          <a
            href="#notes"
            className={`${work.has_pages ? '' : 'ml-auto '}text-accent hover:underline underline-offset-2`}
          >
            Add a note
          </a>
          <Link href={`/works/${work.id}/edit`} className="text-muted hover:text-accent">
            Edit
          </Link>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-base">Citation</h2>

        {chicago.missing.length > 0 ? (
          <p className="text-xs text-accent">
            Incomplete — missing {chicago.missing.join(', ')}. Both forms emit what is
            known and nothing more.
          </p>
        ) : null}

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted">Chicago</p>
          <p className="border-l-2 border-rule pl-3 text-sm">{plain(chicago.text)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted">MLA</p>
          <p className="border-l-2 border-rule pl-3 text-sm">{plain(mla.text)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted">Chicago note</p>
          <p className="border-l-2 border-rule pl-3 text-sm">{plain(note.text)}</p>
        </div>
      </section>

      {contents.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-base">Contents</h2>
          <p className="text-xs text-muted">
            Essays in this volume. Each is examinable because the volume is listed, and
            each can carry its own notes, card, and dossier.
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
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button type="submit" className="text-accent hover:underline underline-offset-2">
            Save
          </button>
        </form>
      </section>

      <section id="notes" className="space-y-4">
        <h2 className="text-base">Notes</h2>

        {notes.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {notes.map((n) => (
              <NoteCard key={n.id} note={n} workId={work.id} />
            ))}
          </ul>
        )}

        <div className="border-t border-rule pt-4">
          <h3 className="mb-3 text-sm">New note on this work</h3>
          <NoteForm workId={work.id} />
        </div>
      </section>
    </div>
  );
}
