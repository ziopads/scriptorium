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
  setStandingNote,
  setStatus,
  updateImprint,
  upsertWork,
} from '@/lib/works';
import {
  addLink,
  approveNote,
  createNote,
  deleteNote,
  nextAnchorOrdinal,
  rejectNote,
  removeAnchor,
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

export async function saveImprint(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  if (!id) throw new Error('saveImprint called without an id.');

  await updateImprint(id, {
    author: text(form, 'author'),
    publisher: text(form, 'publisher'),
    place: text(form, 'place'),
    year: number(form, 'year'),
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
  fields: { purpose?: Purpose; standing?: Standing },
): Promise<{ updated: number }> {
  await requireAllowedUser();

  const updated = await characterizeWorks(ids, fields);

  revalidatePath('/works');
  revalidatePath('/');
  for (const id of ids) revalidatePath(`/works/${id}`);

  return { updated };
}

// A stub: id, title, and whatever else she has, marked as added by her and
// left for /gaps to backfill. Refuses an id that exists, because upsertWork
// would otherwise overwrite a full record with blanks.
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

  await upsertWork({
    id,
    title,
    author,
    year,
    kind: (text(form, 'kind') ?? 'monograph') as WorkKind,
    standing: 'added',
    purpose: 'unassigned',
    notes_internal: text(form, 'notes_internal'),
  });

  revalidatePath('/works');
  revalidatePath('/gaps');
  redirect(`/works/${id}`);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

// From a work page. With a quote or a page it is an anchor; with neither it is
// a note about the whole work, recorded in note_works rather than as an anchor
// with nothing in it. From /notes the work is optional: a note about nothing
// on the list (Leal's periodisation, a definition) is allowed to stand alone.
export async function addNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const workId = text(form, 'work_id');
  const body = text(form, 'body');
  if (!body) throw new Error('A note needs a body.');
  if (workId && !(await getWork(workId))) {
    throw new Error(`No work with id ${workId}. Check the identifier on its catalogue page.`);
  }

  const kindRaw = text(form, 'kind');
  const kind: NoteKind = kindRaw === 'question' ? 'question' : 'note';
  const printedPage = number(form, 'printed_page');
  const quote = text(form, 'quote');
  const attr = attribution(form);
  const passage = printedPage !== null || quote !== null;

  await createNote({
    kind,
    body,
    attribution: attr,
    attributed_to: attr === 'other' ? text(form, 'attributed_to') : null,
    tags: tags(form),
    anchors: workId && passage
      ? [{ work_id: workId, printed_page: printedPage, quote, translation: text(form, 'translation') }]
      : [],
    works: workId && !passage ? [{ work_id: workId, role: 'about' }] : [],
  });

  if (workId) revalidatePath(`/works/${workId}`);
  revalidatePath('/notes');
  if (!workId) redirect('/notes');
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
}

export async function declineNote(form: FormData): Promise<void> {
  await requireAllowedUser();
  const id = number(form, 'id');
  if (id === null) throw new Error('declineNote called without an id.');
  await rejectNote(id);
  revalidatePath('/works', 'layout');
  revalidatePath('/notes');
}

export async function reconsiderNote(form: FormData): Promise<void> {
  await requireAllowedUser();
  const id = number(form, 'id');
  if (id === null) throw new Error('reconsiderNote called without an id.');
  await restoreNote(id);
  revalidatePath('/works', 'layout');
  revalidatePath('/notes');
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
  await createNote({
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
