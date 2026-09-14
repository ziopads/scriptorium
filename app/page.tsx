import Link from 'next/link';

import { CenterPane } from '@/components/workbench/center-pane';
import { LeftPane } from '@/components/workbench/left-pane';
import { RightPane } from '@/components/workbench/right-pane';
import { requireAllowedUser } from '@/lib/auth/guard';
import {
  getNote,
  listAllNotes,
  listAxes,
  listOpenQuestions,
  listUnattributedNotes,
  listUnreviewedNotes,
  listUnsupportedClaims,
} from '@/lib/notes';
import { listExamLists, listWorkbenchRows } from '@/lib/works';
import { href, pick } from '@/lib/workbench-url';

export const dynamic = 'force-dynamic';

// The workbench: the home view. Three panes, state in the URL.
//
//   left    a filterable list of works, notes, or axes
//   centre  the selected thing in full, with tabs
//   right   the note under review, the ficha composer, or the new-note form
//
// The reason it exists is that a note is written by pointing at things rather
// than typing identifiers: the selected work is attached, other rows are
// attached with +, and (once page text is exposed) a selected passage becomes
// the quotation. The old note form at the foot of each work page stays until
// this has been used for a while.

const SHORT: Record<string, string> = {
  theory: 'I',
  dissertation: 'II',
  teaching: 'III',
  'working-bibliography': 'Working',
  filmography: 'Film',
};

export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAllowedUser();
  const params = pick(await searchParams);

  // Reviewing a note: put its first work in the centre unless one is chosen.
  if (params.n && !params.w) {
    const id = Number.parseInt(params.n, 10);
    const note = Number.isNaN(id) ? null : await getNote(id);
    const first = note?.anchors[0]?.work_id ?? note?.works[0]?.work_id;
    if (first) params.w = first;
  }

  const [rows, lists, axes, recent, proposals, unclassified, unsupported, questions] =
    await Promise.all([
      listWorkbenchRows(),
      listExamLists(),
      listAxes(),
      listAllNotes(),
      listUnreviewedNotes(),
      listUnattributedNotes(),
      listUnsupportedClaims(),
      listOpenQuestions(),
    ]);

  const rightOpen = params.r !== '0';

  // Sized for a 13-inch MacBook Air (1440x900): the three panes fit at 1440
  // with the right pane at 22rem; hiding it gives the centre the room a page
  // of text needs. Height is the viewport less the header, footer, and main
  // padding, so each pane scrolls on its own.
  return (
    <div
      className={`grid h-[calc(100vh-7.75rem)] min-h-[28rem] gap-5 ${
        rightOpen ? 'grid-cols-[16rem_minmax(0,1fr)_22rem]' : 'grid-cols-[16rem_minmax(0,1fr)_1.25rem]'
      }`}
    >
      <aside className="min-h-0 border-r border-rule pr-4">
        <LeftPane
          params={params}
          rows={rows}
          lists={lists.map((l) => ({ id: l.id, name: l.name, short: SHORT[l.id] ?? l.name, examinable: l.examinable }))}
          axes={axes.map((a) => ({ id: a.id, title: a.title, ficha_count: a.ficha_count, reviewed: a.reviewed }))}
          notes={recent.slice(0, 40).map((n) => ({
            id: n.id, kind: n.kind, title: n.title, body: n.body,
            reviewed: n.reviewed, origin: n.origin, attribution: n.attribution,
          }))}
          counts={{
            proposals: proposals.length,
            unclassified: unclassified.length,
            unsupported: unsupported.length,
            questions: questions.length,
          }}
        />
      </aside>

      <section className="min-h-0 overflow-y-auto pr-2">
        <CenterPane params={params} />
      </section>

      {rightOpen ? (
        <aside className="relative min-h-0 overflow-y-auto border-l border-rule pl-4">
          <Link
            href={href(params, { r: '0' })}
            className="absolute right-0 top-0 text-xs text-muted hover:text-accent"
            title="Hide the note pane"
            aria-label="Hide the note pane"
          >
            hide ›
          </Link>
          <div className="pt-5">
            <RightPane params={params} rows={rows} />
          </div>
        </aside>
      ) : (
        <aside className="min-h-0 border-l border-rule">
          <Link
            href={href(params, { r: null })}
            className="block h-full w-full pl-1 text-xs text-muted hover:text-accent [writing-mode:vertical-rl]"
            title="Show the note pane"
            aria-label="Show the note pane"
          >
            ‹ {params.n ? 'note' : params.a ? 'new ficha' : 'new note'}
          </Link>
        </aside>
      )}
    </div>
  );
}
