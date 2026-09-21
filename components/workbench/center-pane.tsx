import Link from 'next/link';

import { NoteCard } from '@/components/note-card';
import { DossierView } from '@/components/workbench/dossier-view';
import { PageView } from '@/components/workbench/page-view';
import { Tabs } from '@/components/workbench/tabs';
import { formatBibliography, formatNote, plain } from '@/lib/citation';
import { getDossier } from '@/lib/dossier';
import { getAxisTree, listAxesForWork, listNotesForWork } from '@/lib/notes';
import { getPage, offsetLooksWrong, pageBounds } from '@/lib/pages';
import { listSections, sectionAt } from '@/lib/sections';
import { getWorkWithContainer, listContents, membershipsFor } from '@/lib/works';
import { href, type WorkbenchParams } from '@/lib/workbench-url';
import { KIND_LABEL, PURPOSE_LABEL, STANDING_LABEL } from '@/lib/types';

// The centre pane: whatever is selected on the left, in full. A work has tabs
// (Meta, Contents, Preview, Dossier, Notes, Axes); an axis shows its tree.
// Dossier shows what pipeline/dossier.py loaded, for the works it has run on.

const VIEWS = [
  { id: 'meta', label: 'Meta' },
  { id: 'toc', label: 'Contents' },
  { id: 'preview', label: 'Preview' },
  { id: 'dossier', label: 'Dossier' },
  { id: 'notes', label: 'Notes' },
  { id: 'axes', label: 'Axes' },
] as const;

const SOURCE_LABEL: Record<string, string> = {
  pdf_text: 'PDF with a text layer',
  pdf_ocr: 'scanned PDF, OCR applied',
  epub: 'EPUB — locatable, not citable',
  none: 'no file held',
};

// Only five works have been through the pipeline, so most of the catalogue
// reaches the first branch. source_format on the work says a file is held,
// which is a different claim from pages having been loaded.
async function loadPreview(workId: string, p: string | undefined) {
  const bounds = await pageBounds(workId);
  if (!bounds) return null;
  const asked = Number.parseInt(p ?? '', 10);
  const wanted = Number.isNaN(asked)
    ? bounds.first
    : Math.min(Math.max(asked, bounds.first), bounds.last);
  const [page, offsetWrong] = await Promise.all([
    getPage(workId, wanted),
    offsetLooksWrong(workId),
  ]);
  return page ? { bounds, page, offsetWrong } : null;
}

function Field({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === '') return null;
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export async function CenterPane({ params }: { params: WorkbenchParams }) {
  // `a=new` is the right pane composing an axis that does not exist yet. The
  // centre keeps showing whatever work is selected rather than reporting a
  // missing axis.
  if (params.a && params.a !== 'new') {
    const id = Number.parseInt(params.a, 10);
    const tree = Number.isNaN(id) ? null : await getAxisTree(id);
    if (!tree) return <p className="text-sm text-muted">No such axis.</p>;
    const { axis, fichas, synthesis, exam_move } = tree;
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <p className="text-xs text-muted">
            Axis · <Link href={`/axes/${axis.id}`} className="hover:text-accent">open page</Link>
          </p>
          <h2 className="reading text-xl leading-snug">{axis.title}</h2>
        </header>
        <section className="space-y-1">
          <h3 className="text-sm">Thesis</h3>
          <ul className="border-y border-rule"><NoteCard note={axis} compact /></ul>
        </section>
        <section className="space-y-1">
          <h3 className="text-sm">Fichas</h3>
          {fichas.length === 0 ? <p className="text-sm text-muted">None yet. Write one on the right.</p> : (
            <ol className="divide-y divide-rule border-y border-rule">
              {fichas.map((f) => <NoteCard key={f.id} note={f} compact />)}
            </ol>
          )}
        </section>
        {synthesis ? (
          <section className="space-y-1">
            <h3 className="text-sm">How they connect</h3>
            <ul className="border-y border-rule"><NoteCard note={synthesis} compact /></ul>
          </section>
        ) : null}
        {exam_move ? (
          <section className="space-y-1">
            <h3 className="text-sm">Exam move</h3>
            <ul className="border-y border-rule"><NoteCard note={exam_move} compact /></ul>
          </section>
        ) : null}
      </div>
    );
  }

  if (!params.w) {
    return (
      <div className="space-y-3 text-sm text-muted">
        <p>Select a work on the left to see its record, its notes, and the axes it belongs to.</p>
        <p>
          Write a note on the right: the selected work is attached; press + on other
          rows to attach more.{' '}
          <Link href="/como" className="text-accent hover:underline">How this works</Link>.
        </p>
      </div>
    );
  }

  const work = await getWorkWithContainer(params.w);
  if (!work) return <p className="text-sm text-muted">No such work.</p>;

  const view = params.view ?? 'meta';
  const [memberships, notes, axes, contents] = await Promise.all([
    membershipsFor(work.id),
    listNotesForWork(work.id),
    listAxesForWork(work.id),
    listContents(work.id),
  ]);

  const preview = view === 'preview' ? await loadPreview(work.id, params.p) : null;
  const sections = view === 'toc' ? await listSections(work.id) : [];
  const inSection = preview ? await sectionAt(work.id, preview.page.printed_page) : null;
  const dossier = view === 'dossier' ? await getDossier(work.id) : null;

  const chicago = formatBibliography(work, work.container, 'chicago');
  const note = formatNote(work, work.container, null);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        {work.container ? (
          <p className="text-xs text-muted">
            in <Link href={href(params, { w: work.container.id })} className="italic hover:text-accent">{work.container.title}</Link>
          </p>
        ) : null}
        <h2 className="reading text-xl italic leading-snug">{work.title}</h2>
        <p className="text-sm text-muted">
          {work.author ?? work.editor ?? 'Author unknown'}
          {work.year !== null ? ` · ${work.year}` : ''}
          {work.kind !== 'monograph' ? ` · ${KIND_LABEL[work.kind]}` : ''}
        </p>
        <p className="flex flex-wrap gap-x-3 text-xs">
          {memberships.map((m) => (
            <span key={m.id} className="text-muted">
              {m.name}{m.section_letter ? ` · ${m.section_letter}. ${m.section_title}` : ''}
            </span>
          ))}
          <Link href={`/works/${work.id}`} className="ml-auto text-muted hover:text-accent">open page</Link>
        </p>
      </header>

      <Tabs
        label="Work"
        activeId={view}
        items={VIEWS.map((v) => ({
          id: v.id,
          label: v.label,
          href: href(params, { view: v.id === 'meta' ? null : v.id }),
          badge:
            v.id === 'notes' ? notes.length : v.id === 'axes' ? axes.length : undefined,
        }))}
      />

      {view === 'meta' ? (
        <div className="space-y-4 text-sm">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted">Chicago</p>
            <p className="reading-sm border-l-2 border-rule pl-3">{plain(chicago.text)}</p>
            <p className="text-xs uppercase tracking-wide text-muted pt-1">Note</p>
            <p className="reading-sm border-l-2 border-rule pl-3">{plain(note.text)}</p>
          </div>
          <dl>
            <Field label="Purpose" value={PURPOSE_LABEL[work.purpose]} />
            <Field label="Standing" value={STANDING_LABEL[work.standing]} />
            <Field label="Publisher" value={work.publisher} />
            <Field label="Place" value={work.place} />
            <Field label="First published" value={work.original_year} />
            <Field label="Translator" value={work.translator} />
            <Field label="Editor" value={work.author ? work.editor : null} />
            <Field label="Language" value={work.language} />
            <Field label="Source" value={SOURCE_LABEL[work.source_format]} />
            <Field label="Status" value={work.status} />
          </dl>
          {work.standing_note ? (
            <p className="border-l-2 border-accent pl-3 text-sm">{work.standing_note}</p>
          ) : null}
          {contents.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted">Contents</p>
              <ul className="divide-y divide-rule border-y border-rule">
                {contents.map((e) => (
                  <li key={e.id} className="py-1.5">
                    <Link href={href(params, { w: e.id })} className="hover:text-accent">
                      {e.author ? `${e.author}. ` : ''}“{e.title}”
                      {e.first_page !== null ? <span className="text-muted"> {e.first_page}{e.last_page !== null ? `–${e.last_page}` : ''}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {view === 'toc' ? (
        sections.length === 0 ? (
          <p className="text-sm text-muted">
            No chapter map for this work. The extractor found neither an embedded
            outline nor running heads it could trust, which for a scanned
            collection is the honest answer.
          </p>
        ) : (
          <div className="space-y-2">
            <ul className="divide-y divide-rule border-y border-rule text-sm">
              {sections.map((s) => (
                <li key={s.ordinal} className="py-1.5">
                  <Link
                    href={href(params, { view: 'preview', p: String(s.first_page) })}
                    className="flex items-baseline gap-3 hover:text-accent"
                    style={{ paddingLeft: `${(s.level - 1) * 1.25}rem` }}
                  >
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 font-mono text-xs text-muted">
                      {s.first_page}
                      {s.last_page !== null && s.last_page !== s.first_page
                        ? `–${s.last_page}`
                        : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              {sections[0].source === 'outline'
                ? 'From the file’s own table of contents.'
                : sections[0].source === 'running heads'
                  ? 'Inferred from the running heads — the head standing on each chapter’s pages. Check it against the printed contents.'
                  : 'Entered by hand.'}
            </p>
          </div>
        )
      ) : null}

      {view === 'preview' ? (
        preview ? (
          <>
            {inSection ? (
              <p className="text-xs text-muted">
                <Link href={href(params, { view: 'toc' })} className="hover:text-accent">
                  {inSection.title}
                </Link>
              </p>
            ) : null}
            <PageView
              params={params}
              page={preview.page}
              bounds={preview.bounds}
              language={work.language}
              offsetWrong={preview.offsetWrong}
            />
          </>
        ) : (
          <div className="space-y-2 text-sm text-muted">
            {work.source_format === 'none' ? (
              <p>No file is held for this work, so there is no page text to show.</p>
            ) : (
              <p>
                A file is held for this work, but its pages have not been extracted and
                loaded yet. Five books have been through the pipeline so far.
              </p>
            )}
          </div>
        )
      ) : null}

      {view === 'dossier' ? (
        dossier ? (
          <DossierView dossier={dossier} params={params} language={work.language} />
        ) : (
          <p className="text-sm text-muted">No dossier yet for this work.</p>
        )
      ) : null}

      {view === 'notes' ? (
        notes.length === 0 ? (
          <p className="text-sm text-muted">No notes touch this work yet.</p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {notes.map((n) => <NoteCard key={n.id} note={n} workId={work.id} />)}
          </ul>
        )
      ) : null}

      {view === 'axes' ? (
        axes.length === 0 ? (
          <p className="text-sm text-muted">No axis binds this work yet.</p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule text-sm">
            {axes.map((ax) => (
              <li key={ax.axis_id} className="py-2">
                <Link href={href(params, { a: String(ax.axis_id), n: null })} className="hover:text-accent">
                  {ax.axis_title}
                </Link>
                <span className="text-xs text-muted">
                  {' '}· {ax.role === 'ficha' ? 'ficha' : ax.role === 'yield' ? 'named in the synthesis' : ax.role}
                  {ax.reviewed ? '' : ' · proposal'}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
