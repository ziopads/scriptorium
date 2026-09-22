'use server';

// Server Actions. Mutations live next to the forms that call them: no endpoint
// to secure separately, and lib/ stays server-only because db() reads the
// connection string.
//
// Every text field is normalised so an empty input becomes null. Blank beats a
// guess, and a record with publisher = '' passes an `if (!publisher)` check
// while looking filled in the database.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAllowedUser } from '@/lib/auth/guard';
import {
  addToList,
  characterizeWorks,
  getWork,
  removeFromList,
  setPriority,
  setPaginationAccepted,
  setStandingNote,
  setStatus,
  updateImprint,
  upsertWork,
} from '@/lib/works';
import {
  addLink,
  addTags,
  approveNote,
  createNote,
  deleteNote,
  demoteFicha,
  nextAnchorOrdinal,
  promoteToFicha,
  rejectNote,
  removeAnchor,
  removeLink,
  removeTags,
  removeWork,
  restoreNote,
  setAnchor,
  setWork,
  updateNote,
} from '@/lib/notes';
import type {
  Attribution,
  NoteKind,
  NoteRole,
  Purpose,
  Standing,
  Work,
  WorkInput,
  WorkKind,
} from '@/lib/types';

function text(form: FormData, key: string): string | null {
  const raw = form.get(key);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function number(form: FormData, key: string): number | null {
  const value = text(form, key);
  if (value === null) return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

// Tags arrive as one comma-separated field. Folded to lowercase and
// deduplicated here so the index does not collect three spellings of one word.
function tags(form: FormData): string[] {
  const raw = text(form, 'tags');
  if (!raw) return [];
  const seen = new Set<string>();
  for (const tag of raw.split(',')) {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

// Work ids arrive as one comma-separated field of catalogue ids, the same way
// the connect form already takes them. Deduplicated, order kept.
function workIds(form: FormData, key: string): string[] {
  const raw = text(form, key);
  if (!raw) return [];
  const seen = new Set<string>();
  for (const id of raw.split(',')) {
    const trimmed = id.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

// The attribution radios have no default, so an unanswered form sends nothing
// and the note is stored as unclassified rather than guessed at.
function attribution(form: FormData): Attribution | null {
  const value = text(form, 'attribution');
  return value === 'author' || value === 'own' || value === 'other' ? value : null;
}

// A stable catalogue id from what she typed: surname, first words of the
// title, year. ASCII-folded and permanent, following the pipeline's scheme.
function slugFor(author: string | null, title: string, year: number | null): string {
  const fold = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
  const surname = author ? fold(author.split(',')[0]).split(' ').pop() ?? '' : '';
  const stop = new Set(['the', 'a', 'an', 'el', 'la', 'los', 'las', 'de', 'del', 'of', 'and', 'y']);
  const words = fold(title).split(' ').filter((w) => w && !stop.has(w)).slice(0, 3);
  return [surname, ...words, year ?? ''].filter(Boolean).join('-');
}

// ---------------------------------------------------------------------------
// Works
// ---------------------------------------------------------------------------

export async function saveWork(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  const title = text(form, 'title');
  if (!id) throw new Error('saveWork called without an id.');
  if (!title) throw new Error('A work must have a title.');

  const input: WorkInput = {
    id,
    title,
    subtitle: text(form, 'subtitle'),
    author: text(form, 'author'),
    translator: text(form, 'translator'),
    editor: text(form, 'editor'),
    publisher: text(form, 'publisher'),
    place: text(form, 'place'),
    year: number(form, 'year'),
    edition: text(form, 'edition'),
    language: text(form, 'language'),

    kind: (text(form, 'kind') ?? 'monograph') as WorkKind,
    container_id: text(form, 'container_id'),
    first_page: number(form, 'first_page'),
    last_page: number(form, 'last_page'),

    isbn: text(form, 'isbn'),
    volume: text(form, 'volume'),
    series: text(form, 'series'),
    original_year: number(form, 'original_year'),
    url: text(form, 'url'),
    doi: text(form, 'doi'),
    accessed: text(form, 'accessed'),

    status: (text(form, 'status') ?? 'unread') as Work['status'],
    purpose: (text(form, 'purpose') ?? 'unassigned') as Purpose,
    standing: (text(form, 'standing') ?? 'assigned') as Standing,
    standing_note: text(form, 'standing_note'),
    source_format: (text(form, 'source_format') ?? 'none') as Work['source_format'],
    source_path: text(form, 'source_path'),
    page_offset: number(form, 'page_offset') ?? 0,
    notes_internal: text(form, 'notes_internal'),
  };

  await upsertWork(input);

  revalidatePath('/works');
  revalidatePath(`/works/${id}`);
  revalidatePath('/gaps');
  redirect(`/works/${id}`);
}

// An ISBN as typed or pasted, checked by its check digit and stored in the
// 13-digit form, as pipeline/isbns.py stores it. A number that fails its check
// digit is refused rather than saved: a wrong ISBN names the wrong edition,
// and edition decides pagination.
function isbn(form: FormData): string | null {
  const raw = text(form, 'isbn');
  if (raw === null) return null;
  const digits = raw.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (digits.length === 13 && /^\d{13}$/.test(digits)) {
    const sum = [...digits].reduce((s, c, i) => s + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
    if (sum % 10 === 0) return digits;
  } else if (digits.length === 10 && /^\d{9}[\dX]$/.test(digits)) {
    const sum = [...digits].reduce(
      (s, c, i) => s + (c === 'X' ? 10 : Number(c)) * (10 - i),
      0,
    );
    if (sum % 11 === 0) {
      const body = `978${digits.slice(0, 9)}`;
      const check = [...body].reduce((s, c, i) => s + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
      return body + String((10 - (check % 10)) % 10);
    }
  }
  throw new Error(`${raw} is not a valid ISBN: its check digit does not match.`);
}

export async function saveImprint(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  if (!id) throw new Error('saveImprint called without an id.');

  await updateImprint(id, {
    author: text(form, 'author'),
    publisher: text(form, 'publisher'),
    place: text(form, 'place'),
    year: number(form, 'year'),
    isbn: isbn(form),
  });

  revalidatePath('/gaps');
  revalidatePath('/works');
  revalidatePath(`/works/${id}`);
}

export async function changeStatus(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  const status = text(form, 'status') as Work['status'] | null;
  if (!id || !status) throw new Error('changeStatus needs an id and a status.');

  await setStatus(id, status);
  revalidatePath('/works');
  revalidatePath(`/works/${id}`);
}

export async function saveStandingNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  if (!id) throw new Error('saveStandingNote called without an id.');

  await setStandingNote(id, text(form, 'standing_note'));
  revalidatePath(`/works/${id}`);
}

// Accept a file whose page numbering offsets.py could not settle, or withdraw
// that acceptance (migration 016). The flag offsets.py wrote stays where it is;
// what changes is that the loaders stop holding the work back, and every page
// number the app shows for the work is marked unverified.
export async function setPagination(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  if (!id) throw new Error('setPagination called without an id.');

  await setPaginationAccepted(id, text(form, 'accepted') === 'yes');

  revalidatePath('/gaps');
  revalidatePath('/works');
  revalidatePath(`/works/${id}`);
}

export async function joinList(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  const listId = text(form, 'list_id');
  if (!id || !listId) throw new Error('joinList needs an id and a list_id.');

  await addToList(listId, id, text(form, 'section_id'), text(form, 'rationale'));
  revalidatePath('/');
  revalidatePath(`/works/${id}`);
}

export async function leaveList(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  const listId = text(form, 'list_id');
  if (!id || !listId) throw new Error('leaveList needs an id and a list_id.');

  await removeFromList(listId, id);
  revalidatePath('/');
  revalidatePath(`/works/${id}`);
}

// Called from the catalogue's client table rather than a form, because
// shift-click range selection needs browser state. Undefined means leave alone:
// a bulk bar whose "no change" is indistinguishable from a real value will
// eventually rewrite the catalogue on one stray click.
export async function characterizeSelection(
  ids: string[],
  fields: { purpose?: Purpose; standing?: Standing; priority?: number | null },
): Promise<{ updated: number }> {
  await requireAllowedUser();

  const updated = await characterizeWorks(ids, fields);

  revalidatePath('/works');
  revalidatePath('/');
  for (const id of ids) revalidatePath(`/works/${id}`);

  return { updated };
}

// One work rated from its row. Called from the catalogue's client table, like
// characterizeSelection, because rating a list is a run of single clicks and a
// form submit per star would be intolerable.
export async function rateWork(id: string, priority: number | null): Promise<void> {
  await requireAllowedUser();

  if (priority !== null && (priority < 1 || priority > 5)) {
    throw new Error('A rating is 1 to 5, or null to clear it.');
  }

  await setPriority(id, priority);

  revalidatePath('/works');
  revalidatePath('/');
  revalidatePath(`/works/${id}`);
}

// Attach a newly created work to the note being written, on the way back to
// the workbench. Without this she would create the work, land on its
// catalogue page, and have to find her way back and attach it by hand — which
// is the three-screen path this form exists to remove.
function withAttachedWork(path: string, id: string): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  const ws = params.get('ws');
  const ids = [...new Set([...(ws ? ws.split(',').filter(Boolean) : []), id])];
  params.set('ws', ids.join(','));
  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
}

// A stub: id, title, and whatever else she has, marked as added by her and
// left for /gaps to backfill. Refuses an id that exists, because upsertWork
// would otherwise overwrite a full record with blanks.
//
// container_id, first_page and last_page make this the way a tale inside a
// collection becomes citable: reading Rael at page 47, she names the tale and
// it is created as a child with its range, rather than the collection having
// to be split into hundreds of rows nobody asked for.
export async function addStubWork(form: FormData): Promise<void> {
  await requireAllowedUser();

  const title = text(form, 'title');
  if (!title) throw new Error('A work must have a title.');

  const author = text(form, 'author');
  const year = number(form, 'year');
  const id = text(form, 'id') ?? slugFor(author, title, year);
  if (!id) throw new Error('Could not derive an id; give one.');

  if (await getWork(id)) {
    throw new Error(`A work with id ${id} already exists.`);
  }

  const containerId = text(form, 'container_id');
  if (containerId && !(await getWork(containerId))) {
    throw new Error(`No work with id ${containerId} to hold this one.`);
  }

  await upsertWork({
    id,
    title,
    author,
    year,
    kind: (text(form, 'kind') ?? 'monograph') as WorkKind,
    container_id: containerId,
    first_page: containerId ? number(form, 'first_page') : null,
    last_page: containerId ? number(form, 'last_page') : null,
    standing: 'added',
    purpose: 'unassigned',
    notes_internal: text(form, 'notes_internal'),
  });

  revalidatePath('/works');
  revalidatePath('/gaps');
  revalidatePath('/');

  const back = text(form, 'return_to');
  if (back && back.startsWith('/')) redirect(withAttachedWork(back, id));
  redirect(`/works/${id}`);
}

// Show her the note she just wrote. Without this the workbench redirects to
// the URL it is already on, the pane redraws as an empty form, and nothing
// says the save happened — which is how three identical notes arrived 456 and
// 247 milliseconds apart on 14 September. With n set, the right pane switches
// to the note under review: the anchor, the attribution and the quotation are
// all in front of her, and there is nothing left to press twice.
function showingNote(path: string, id: number): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('n', String(id));
  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
}

function showingAxis(path: string, id: number): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('a', String(id));
  params.delete('n');
  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

// From a work page or the workbench. The works come as one work_id (the work
// page) or a comma-separated work_ids (the workbench, where clicking rows
// attaches works). With a quote or a page the FIRST work gets an anchor; every
// other work is a whole-work relation. With neither, all are whole-work. From
// /notes the work is optional: a note about nothing on the list (Leal's
// periodisation, a definition) is allowed to stand alone.
export async function addNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const single = text(form, 'work_id');
  const many = workIds(form, 'work_ids');
  const ids = [...new Set([...(single ? [single] : []), ...many])];
  const body = text(form, 'body');
  if (!body) throw new Error('A note needs a body.');
  for (const id of ids) {
    if (!(await getWork(id))) {
      throw new Error(`No work with id ${id}. Check the identifier on its catalogue page.`);
    }
  }

  const kindRaw = text(form, 'kind');
  const kind: NoteKind = kindRaw === 'question' ? 'question' : 'note';
  const printedPage = number(form, 'printed_page');
  const quote = text(form, 'quote');
  const attr = attribution(form);
  const passage = printedPage !== null || quote !== null;
  const [first, ...rest] = ids;

  const note = await createNote({
    kind,
    body,
    attribution: attr,
    attributed_to: attr === 'other' ? text(form, 'attributed_to') : null,
    tags: tags(form),
    anchors: first && passage
      ? [{ work_id: first, printed_page: printedPage, quote, translation: text(form, 'translation') }]
      : [],
    works: (first && passage ? rest : ids).map((work_id) => ({ work_id, role: 'about' as const })),
  });

  for (const id of ids) revalidatePath(`/works/${id}`);
  revalidatePath('/notes');
  revalidatePath('/');
  const back = text(form, 'return_to');
  if (back && back.startsWith('/')) redirect(showingNote(back, note.id));
  if (ids.length === 0) redirect('/notes');
}

// Tags applied to a selection, from the notes list. Called from a client
// component rather than a form, like characterizeSelection, because shift-click
// range selection needs browser state.
//
// Folded to lowercase and deduplicated the same way the note form does it, so
// a tag added in bulk cannot become a second spelling of one that exists.
export async function tagSelection(
  ids: number[],
  add: string[],
  remove: string[],
): Promise<{ updated: number }> {
  await requireAllowedUser();

  const fold = (list: string[]) => [
    ...new Set(list.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  ];

  const added = await addTags(ids, fold(add));
  const removed = await removeTags(ids, fold(remove));

  revalidatePath('/notes');
  revalidatePath('/works', 'layout');
  revalidatePath('/');

  return { updated: Math.max(added, removed) };
}

export async function editNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = number(form, 'id');
  const body = text(form, 'body');
  if (id === null) throw new Error('editNote called without an id.');
  if (!body) throw new Error('A note needs a body.');

  const attr = attribution(form);
  await updateNote(id, {
    title: text(form, 'title'),
    body,
    attribution: attr,
    attributed_to: attr === 'other' ? text(form, 'attributed_to') : null,
    tags: tags(form),
  });

  // The note may be anchored to several works; revalidating the whole catalogue
  // is cheaper than resolving which.
  revalidatePath('/works', 'layout');
  revalidatePath('/notes');
  revalidatePath('/axes', 'layout');
}

export async function acceptNote(form: FormData): Promise<void> {
  await requireAllowedUser();
  const id = number(form, 'id');
  if (id === null) throw new Error('acceptNote called without an id.');
  await approveNote(id);
  revalidatePath('/works', 'layout');
  revalidatePath('/notes');
  revalidatePath('/');
}

export async function declineNote(form: FormData): Promise<void> {
  await requireAllowedUser();
  const id = number(form, 'id');
  if (id === null) throw new Error('declineNote called without an id.');
  await rejectNote(id);
  revalidatePath('/works', 'layout');
  revalidatePath('/notes');
  revalidatePath('/');
}

export async function reconsiderNote(form: FormData): Promise<void> {
  await requireAllowedUser();
  const id = number(form, 'id');
  if (id === null) throw new Error('reconsiderNote called without an id.');
  await restoreNote(id);
  revalidatePath('/works', 'layout');
  revalidatePath('/notes');
  revalidatePath('/');
}

// A later note answers a question. The question stays; the link records it.
export async function answerQuestion(form: FormData): Promise<void> {
  await requireAllowedUser();
  const questionId = number(form, 'question_id');
  const answerId = number(form, 'answer_id');
  if (questionId === null || answerId === null) {
    throw new Error('answerQuestion needs a question_id and an answer_id.');
  }
  await addLink(answerId, questionId, 'answers');
  revalidatePath('/notes');
}

// ---------------------------------------------------------------------------
// A note and an axis
// ---------------------------------------------------------------------------
// Two different relations, and the difference matters.
//
// A ficha is membership: this note says what this work contributes to that
// axis's argument, and it becomes a part of the axis. A note can be a ficha of
// one axis only, because a ficha is written per (axis, work) — Anzaldúa's
// ficha in Eje 2 is not her ficha in Eje 4.
//
// A bridge is a cross-reference: this note bears on that axis. A note can
// bridge to as many axes as it likes, and bridging does not put its works into
// the axis, because axis_works derives membership from the children only.

export async function makeFicha(form: FormData): Promise<void> {
  await requireAllowedUser();

  const noteId = number(form, 'note_id');
  const axisId = number(form, 'axis_id');
  if (noteId === null || axisId === null) {
    throw new Error('makeFicha needs a note_id and an axis_id.');
  }

  await promoteToFicha(noteId, axisId);

  revalidatePath('/notes');
  revalidatePath('/axes', 'layout');
  revalidatePath('/works', 'layout');
  revalidatePath('/');

  const back = text(form, 'return_to');
  if (back && back.startsWith('/')) redirect(back);
}

export async function unmakeFicha(form: FormData): Promise<void> {
  await requireAllowedUser();

  const noteId = number(form, 'note_id');
  if (noteId === null) throw new Error('unmakeFicha called without a note_id.');

  await demoteFicha(noteId);

  revalidatePath('/notes');
  revalidatePath('/axes', 'layout');
  revalidatePath('/works', 'layout');
  revalidatePath('/');

  const back = text(form, 'return_to');
  if (back && back.startsWith('/')) redirect(back);
}

export async function bridgeToAxis(form: FormData): Promise<void> {
  await requireAllowedUser();

  const noteId = number(form, 'note_id');
  const axisId = number(form, 'axis_id');
  if (noteId === null || axisId === null) {
    throw new Error('bridgeToAxis needs a note_id and an axis_id.');
  }
  if (noteId === axisId) throw new Error('A note cannot bridge to itself.');

  await addLink(noteId, axisId, 'bridge');

  revalidatePath('/notes');
  revalidatePath('/axes', 'layout');
  revalidatePath('/');

  const back = text(form, 'return_to');
  if (back && back.startsWith('/')) redirect(back);
}

export async function unbridge(form: FormData): Promise<void> {
  await requireAllowedUser();

  const noteId = number(form, 'note_id');
  const axisId = number(form, 'axis_id');
  if (noteId === null || axisId === null) {
    throw new Error('unbridge needs a note_id and an axis_id.');
  }

  await removeLink(noteId, axisId, 'bridge');

  revalidatePath('/notes');
  revalidatePath('/axes', 'layout');
  revalidatePath('/');

  const back = text(form, 'return_to');
  if (back && back.startsWith('/')) redirect(back);
}

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

// The four parts she already uses, in one form. The thesis is the axis row;
// synthesis and exam move become child notes; fichas are added on the axis
// page one at a time, because each names its own works.
export async function addAxis(form: FormData): Promise<void> {
  await requireAllowedUser();

  const title = text(form, 'title');
  const thesis = text(form, 'thesis');
  if (!title) throw new Error('An axis needs a title.');
  if (!thesis) throw new Error('An axis needs a thesis.');

  const axis = await createNote({
    kind: 'axis',
    title,
    body: thesis,
    attribution: 'own',
    tags: tags(form),
  });

  const synthesis = text(form, 'synthesis');
  if (synthesis) {
    await createNote({
      kind: 'synthesis',
      parent_id: axis.id,
      body: synthesis,
      attribution: 'own',
      works: workIds(form, 'yield_work_ids').map((work_id) => ({ work_id, role: 'yield' as NoteRole })),
    });
  }

  const examMove = text(form, 'exam_move');
  if (examMove) {
    await createNote({ kind: 'exam_move', parent_id: axis.id, body: examMove, attribution: 'own' });
  }

  revalidatePath('/axes');
  revalidatePath('/');

  // Back to the workbench with the new axis selected, which turns the right
  // pane into its ficha composer with her attached works still there — so
  // making an axis and writing its first ficha is one motion.
  const back = text(form, 'return_to');
  if (back && back.startsWith('/')) redirect(showingAxis(back, axis.id));
  redirect(`/axes/${axis.id}`);
}

export async function addFicha(form: FormData): Promise<void> {
  await requireAllowedUser();

  const axisId = number(form, 'axis_id');
  const body = text(form, 'body');
  const ids = workIds(form, 'work_ids');
  if (axisId === null) throw new Error('addFicha called without an axis_id.');
  if (!body) throw new Error('A ficha needs a body.');
  if (ids.length === 0) throw new Error('A ficha names at least one work.');

  const attr = attribution(form);
  const ficha = await createNote({
    kind: 'ficha',
    parent_id: axisId,
    body,
    attribution: attr,
    attributed_to: attr === 'other' ? text(form, 'attributed_to') : null,
    tags: tags(form),
    works: ids.map((work_id) => ({ work_id, role: 'ficha' as NoteRole })),
  });

  revalidatePath(`/axes/${axisId}`);
  revalidatePath('/works', 'layout');
  revalidatePath('/');
  const back = text(form, 'return_to');
  if (back && back.startsWith('/')) redirect(showingNote(back, ficha.id));
}

// Synthesis or exam move added after the axis was created without one.
export async function addAxisPart(form: FormData): Promise<void> {
  await requireAllowedUser();

  const axisId = number(form, 'axis_id');
  const body = text(form, 'body');
  const kindRaw = text(form, 'kind');
  if (axisId === null || !body) throw new Error('addAxisPart needs an axis_id and a body.');
  if (kindRaw !== 'synthesis' && kindRaw !== 'exam_move') {
    throw new Error('addAxisPart kind must be synthesis or exam_move.');
  }

  await createNote({
    kind: kindRaw,
    parent_id: axisId,
    body,
    attribution: 'own',
    works: kindRaw === 'synthesis'
      ? workIds(form, 'yield_work_ids').map((work_id) => ({ work_id, role: 'yield' as NoteRole }))
      : [],
  });

  revalidatePath(`/axes/${axisId}`);
}

// A whole-work relation on an existing note: a ficha gaining a work, a
// synthesis naming another yield. role comes from the form that called, never
// from a menu she sees.
export async function attachWork(form: FormData): Promise<void> {
  await requireAllowedUser();

  const noteId = number(form, 'note_id');
  const workId = text(form, 'work_id');
  const roleRaw = text(form, 'role');
  if (noteId === null || !workId) throw new Error('attachWork needs a note_id and a work_id.');
  const role: NoteRole =
    roleRaw === 'ficha' || roleRaw === 'yield' || roleRaw === 'supports' || roleRaw === 'disputes'
      ? roleRaw
      : 'about';

  await setWork(noteId, workId, role);
  revalidatePath('/works', 'layout');
  revalidatePath('/axes', 'layout');
  revalidatePath('/notes');
}

export async function detachWork(form: FormData): Promise<void> {
  await requireAllowedUser();

  const noteId = number(form, 'note_id');
  const workId = text(form, 'work_id');
  if (noteId === null || !workId) throw new Error('detachWork needs a note_id and a work_id.');

  await removeWork(noteId, workId);
  revalidatePath('/works', 'layout');
  revalidatePath('/axes', 'layout');
  revalidatePath('/notes');
}

export async function editAnchor(form: FormData): Promise<void> {
  await requireAllowedUser();

  const noteId = number(form, 'note_id');
  const ordinal = number(form, 'ordinal');
  const workId = text(form, 'work_id');
  if (noteId === null || ordinal === null || !workId) {
    throw new Error('editAnchor needs a note_id, an ordinal and a work_id.');
  }

  await setAnchor(noteId, ordinal, {
    work_id: workId,
    printed_page: number(form, 'printed_page'),
    quote: text(form, 'quote'),
    translation: text(form, 'translation'),
  });

  revalidatePath('/works', 'layout');
  revalidatePath('/notes');
}

// A second anchor turns a note into a connection: it appears on both works, from
// both directions, with no reciprocal record to keep in step.
export async function linkNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const noteId = number(form, 'note_id');
  const workId = text(form, 'work_id');
  if (noteId === null || !workId) {
    throw new Error('linkNote needs a note_id and a work_id.');
  }

  const ordinal = await nextAnchorOrdinal(noteId);
  await setAnchor(noteId, ordinal, {
    work_id: workId,
    printed_page: number(form, 'printed_page'),
    quote: text(form, 'quote'),
    translation: text(form, 'translation'),
  });

  revalidatePath('/works', 'layout');
  revalidatePath('/notes');
}

export async function unlinkNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const noteId = number(form, 'note_id');
  const ordinal = number(form, 'ordinal');
  if (noteId === null || ordinal === null) {
    throw new Error('unlinkNote needs a note_id and an ordinal.');
  }

  await removeAnchor(noteId, ordinal);
  revalidatePath('/works', 'layout');
  revalidatePath('/notes');
}

export async function removeNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = number(form, 'id');
  if (id === null) throw new Error('removeNote called without an id.');

  await deleteNote(id);
  revalidatePath('/works', 'layout');
  revalidatePath('/notes');
  revalidatePath('/axes', 'layout');
}
