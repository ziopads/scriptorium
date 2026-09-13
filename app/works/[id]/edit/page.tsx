import Link from 'next/link';
import { notFound } from 'next/navigation';

import { saveWork } from '@/lib/actions';
import { requireAllowedUser } from '@/lib/auth/guard';
import { getWork } from '@/lib/works';
import {
  KIND_LABEL,
  PURPOSE_LABEL,
  STANDING_LABEL,
  type Purpose,
  type Standing,
  type WorkKind,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUSES = ['unread', 'reading', 'read'] as const;
const FORMATS = ['none', 'pdf_text', 'pdf_ocr', 'epub'] as const;
const KINDS: WorkKind[] = [
  'monograph', 'edited_volume', 'essay', 'chapter', 'poem', 'film',
  'dictionary', 'anthology',
];
const PURPOSES: Purpose[] = ['comps', 'both', 'dissertation', 'unassigned'];
const STANDINGS: Standing[] = ['assigned', 'added', 'excluded'];

function Row({
  name, label, value, hint, type = 'text',
}: {
  name: string;
  label: string;
  value: string | number | null;
  hint?: string;
  type?: 'text' | 'number' | 'date';
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm">{label}</span>
      <input type={type} name={name} defaultValue={value ?? ''} />
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

// Radio rather than a menu. Mutually exclusive values, and always-visible
// options say what the categories are without being opened. A checkbox group
// would permit "comps" and "unassigned" at once, which is meaningless.
function RadioSet<T extends string>({
  name, values, labels, current,
}: {
  name: string;
  values: readonly T[];
  labels: Record<T, string>;
  current: T;
}) {
  return (
    <div className="space-y-1">
      {values.map((value) => (
        <label key={value} className="flex items-baseline gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={value}
            defaultChecked={value === current}
            className="w-auto"
          />
          {labels[value]}
        </label>
      ))}
    </div>
  );
}

export default async function EditWorkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;

  const work = await getWork(id);
  if (!work) notFound();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl">Edit</h1>
        <p className="text-sm text-muted italic">{work.title}</p>
      </header>

      <form action={saveWork} className="space-y-6">
        <input type="hidden" name="id" value={work.id} />

        <fieldset className="space-y-4">
          <legend className="text-base mb-2">Bibliography</legend>
          <p className="text-xs text-muted">
            Leave a field empty when the value is unknown. An empty field is stored as
            unknown and surfaces on the Gaps page; a plausible-looking guess does not.
            Which citation style the department wants is a formatting decision — the
            record holds what every style needs.
          </p>

          <Row name="title" label="Title" value={work.title} />
          <Row name="subtitle" label="Subtitle" value={work.subtitle} />
          <Row
            name="author"
            label="Author"
            value={work.author}
            hint="Inverted: Anzaldúa, Gloria. For a film, the director."
          />
          <Row name="translator" label="Translator" value={work.translator} />
          <Row name="editor" label="Editor" value={work.editor} />
          <Row name="publisher" label="Publisher" value={work.publisher} />
          <Row name="place" label="Place" value={work.place} />
          <Row name="year" label="Year of this edition" value={work.year} type="number" />
          <Row
            name="original_year"
            label="First published"
            value={work.original_year}
            type="number"
            hint="1919 for “Lo ominoso”. Both styles print it when it differs."
          />
          <Row name="edition" label="Edition" value={work.edition} />
          <Row name="volume" label="Volume" value={work.volume} hint="vol. 17 · 2 vols." />
          <Row name="series" label="Series" value={work.series} />
          <Row
            name="isbn"
            label="ISBN"
            value={work.isbn}
            hint="The edition she is citing. Pagination is edition-specific."
          />
          <Row name="url" label="URL" value={work.url} />
          <Row name="doi" label="DOI" value={work.doi} />
          <Row
            name="accessed"
            label="Accessed"
            value={work.accessed}
            type="date"
            hint="Required for a web source in both styles."
          />
          <Row
            name="language"
            label="Language"
            value={work.language}
            hint="es, en, or en,es for a facing-page volume"
          />
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base mb-2">What kind of thing it is</legend>
          <p className="text-xs text-muted">
            An essay names the volume it sits in. Its citation then draws the title and
            page range from here and the imprint from the container.
          </p>

          <label className="block space-y-1">
            <span className="text-sm">Kind</span>
            <select name="kind" defaultValue={work.kind}>
              {KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </label>

          <Row
            name="container_id"
            label="Contained in"
            value={work.container_id}
            hint="Identifier of the volume, e.g. lacan-escritos-1"
          />
          <div className="flex gap-3">
            <Row name="first_page" label="First page in volume" value={work.first_page} type="number" />
            <Row name="last_page" label="Last page" value={work.last_page} type="number" />
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base mb-2">Standing</legend>
          <p className="text-xs text-muted">
            What the work is for, and how it came to be on the list. Recorded separately
            so a work excluded by an advisor can still be central to the dissertation,
            and so the difference between the assigned list and hers stays visible.
          </p>

          <div className="space-y-1">
            <span className="text-sm">Purpose</span>
            <RadioSet name="purpose" values={PURPOSES} labels={PURPOSE_LABEL} current={work.purpose} />
          </div>

          <div className="space-y-1">
            <span className="text-sm">How it got here</span>
            <RadioSet name="standing" values={STANDINGS} labels={STANDING_LABEL} current={work.standing} />
          </div>

          <label className="block space-y-1">
            <span className="text-sm">On that determination</span>
            <textarea name="standing_note" rows={3} defaultValue={work.standing_note ?? ''} />
            <span className="block text-xs text-muted">
              Why a work belongs, or why an exclusion is wrong. Yours to argue with.
            </span>
          </label>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base mb-2">File</legend>

          <label className="block space-y-1">
            <span className="text-sm">Source format</span>
            <select name="source_format" defaultValue={work.source_format}>
              {FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>

          <Row name="source_path" label="Source path" value={work.source_path} />
          <Row
            name="page_offset"
            label="Page offset"
            value={work.page_offset}
            type="number"
            hint="printed page = file page + offset"
          />

          <label className="block space-y-1">
            <span className="text-sm">Status</span>
            <select name="status" defaultValue={work.status}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm">Internal note</span>
            <textarea name="notes_internal" rows={3} defaultValue={work.notes_internal ?? ''} />
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
          <Link href={`/works/${work.id}`} className="text-sm text-muted hover:text-accent">
            Cancel
          </Link>
          <span className="ml-auto font-mono text-xs text-muted">{work.id}</span>
        </div>
      </form>
    </div>
  );
}
