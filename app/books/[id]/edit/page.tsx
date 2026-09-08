import Link from 'next/link';
import { notFound } from 'next/navigation';

import { saveBook } from '@/lib/actions';
import { getBook } from '@/lib/books';

const STATUSES = ['unread', 'reading', 'read'] as const;
const FORMATS = ['none', 'pdf_text', 'pdf_ocr', 'epub'] as const;

function Row({
  name,
  label,
  value,
  hint,
  type = 'text',
}: {
  name: string;
  label: string;
  value: string | number | null;
  hint?: string;
  type?: 'text' | 'number';
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm">{label}</span>
      <input type={type} name={name} defaultValue={value ?? ''} />
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export default async function EditBookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const book = await getBook(id);
  if (!book) notFound();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl">Edit</h1>
        <p className="text-sm text-muted italic">{book.title}</p>
      </header>

      <form action={saveBook} className="space-y-6">
        <input type="hidden" name="id" value={book.id} />

        <fieldset className="space-y-4">
          <legend className="text-base mb-2">Bibliography</legend>
          <p className="text-xs text-muted">
            Leave a field empty when the value is unknown. An empty field is stored
            as unknown and surfaces on the Gaps page; a plausible-looking guess does
            not.
          </p>

          <Row name="title" label="Title" value={book.title} />
          <Row name="subtitle" label="Subtitle" value={book.subtitle} />
          <Row
            name="author"
            label="Author"
            value={book.author}
            hint="Inverted: Anzaldúa, Gloria"
          />
          <Row name="translator" label="Translator" value={book.translator} />
          <Row name="editor" label="Editor" value={book.editor} />
          <Row name="publisher" label="Publisher" value={book.publisher} />
          <Row name="place" label="Place" value={book.place} />
          <Row name="year" label="Year" value={book.year} type="number" />
          <Row name="edition" label="Edition" value={book.edition} />
          <Row
            name="language"
            label="Language"
            value={book.language}
            hint="es, en, or en,es for a facing-page volume"
          />
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base mb-2">File</legend>

          <label className="block space-y-1">
            <span className="text-sm">Source format</span>
            <select name="source_format" defaultValue={book.source_format}>
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <Row name="source_path" label="Source path" value={book.source_path} />
          <Row
            name="page_offset"
            label="Page offset"
            value={book.page_offset}
            type="number"
            hint="printed page = file page + offset. Check one folio against its file page."
          />

          <label className="block space-y-1">
            <span className="text-sm">Status</span>
            <select name="status" defaultValue={book.status}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm">Internal note</span>
            <textarea name="notes_internal" rows={3} defaultValue={book.notes_internal ?? ''} />
            <span className="block text-xs text-muted">
              Transcription decisions, bad scans, missing pages. Not part of any citation.
            </span>
          </label>
        </fieldset>

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
          >
            Save
          </button>
          <Link href={`/books/${book.id}`} className="text-sm text-muted hover:text-accent">
            Cancel
          </Link>
          <span className="ml-auto font-mono text-xs text-muted">{book.id}</span>
        </div>
      </form>
    </div>
  );
}
