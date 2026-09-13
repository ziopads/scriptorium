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
  removeFromList,
  setStandingNote,
  setStatus,
  updateImprint,
  upsertWork,
} from '@/lib/works';
import {
  createNote,
  deleteNote,
  nextAnchorOrdinal,
  removeAnchor,
  setAnchor,
  updateNote,
} from '@/lib/notes';
import type { Purpose, Standing, Work, WorkInput, WorkKind } from '@/lib/types';

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

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function addNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const workId = text(form, 'work_id');
  const body = text(form, 'body');
  if (!workId) throw new Error('addNote called without a work_id.');
  if (!body) throw new Error('A note needs a body.');

  await createNote({
    body,
    tags: tags(form),
    anchors: [
      {
        work_id: workId,
        printed_page: number(form, 'printed_page'),
        quote: text(form, 'quote'),
      },
    ],
  });

  revalidatePath(`/works/${workId}`);
  revalidatePath('/notes');
}

export async function editNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = number(form, 'id');
  const body = text(form, 'body');
  if (id === null) throw new Error('editNote called without an id.');
  if (!body) throw new Error('A note needs a body.');

  await updateNote(id, { body, tags: tags(form) });

  // The note may be anchored to several works; revalidating the whole catalogue
  // is cheaper than resolving which.
  revalidatePath('/works', 'layout');
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
}
