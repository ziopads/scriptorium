'use server';

// Server Actions for the catalogue.
//
// Mutations live next to the forms that call them rather than behind API
// routes: there is no endpoint to secure separately, and lib/ stays server-only,
// which matters because db() reads the connection string.
//
// Every text field is normalised so that an empty input becomes null rather
// than an empty string. Blank beats a guess, and a record with publisher = ''
// would pass an `if (!book.publisher)` check while looking filled in the
// database.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAllowedUser } from '@/lib/auth/guard';
import {
  addToList,
  characterizeBooks,
  removeFromList,
  setStatus,
  updateImprint,
  upsertBook,
} from '@/lib/books';
import { createNote, deleteNote, updateNote } from '@/lib/notes';
import type { Book, BookInput, Purpose, Standing } from '@/lib/types';

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

// The full edit form. `id` is submitted as a hidden field and is never editable:
// it is the primary key, notes and chunks will reference it, and it appears in
// URLs. Changing one is a migration, not a form field.
export async function saveBook(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  const title = text(form, 'title');

  if (!id) throw new Error('saveBook called without an id.');
  if (!title) throw new Error('A book must have a title.');

  const input: BookInput = {
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
    status: (text(form, 'status') ?? 'unread') as Book['status'],
    purpose: (text(form, 'purpose') ?? 'unassigned') as Purpose,
    standing: (text(form, 'standing') ?? 'assigned') as Standing,
    standing_note: text(form, 'standing_note'),
    source_format: (text(form, 'source_format') ??
      'none') as Book['source_format'],
    source_path: text(form, 'source_path'),
    page_offset: number(form, 'page_offset') ?? 0,
    notes_internal: text(form, 'notes_internal'),
  };

  await upsertBook(input);

  revalidatePath('/books');
  revalidatePath(`/books/${id}`);
  revalidatePath('/gaps');
  redirect(`/books/${id}`);
}

// One row of the gaps table. Stays on the page afterwards, because the point of
// that screen is working down a list without navigating.
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
  revalidatePath('/books');
  revalidatePath(`/books/${id}`);
}

export async function changeStatus(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  const status = text(form, 'status') as Book['status'] | null;
  if (!id || !status) throw new Error('changeStatus needs an id and a status.');

  await setStatus(id, status);

  revalidatePath('/books');
  revalidatePath(`/books/${id}`);
}

export async function joinList(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  const listId = text(form, 'list_id');
  if (!id || !listId) throw new Error('joinList needs an id and a list_id.');

  await addToList(listId, id, text(form, 'rationale'));

  revalidatePath('/');
  revalidatePath(`/books/${id}`);
}

export async function leaveList(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = text(form, 'id');
  const listId = text(form, 'list_id');
  if (!id || !listId) throw new Error('leaveList needs an id and a list_id.');

  await removeFromList(listId, id);

  revalidatePath('/');
  revalidatePath(`/books/${id}`);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
// Tags arrive as one comma-separated field rather than a tag widget. She is
// typing while reading, and a text input costs nothing to learn. Duplicates and
// case differences are folded here so that the tag index does not accumulate
// three spellings of the same word.
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

export async function addNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const bookId = text(form, 'book_id');
  const body = text(form, 'body');

  if (!bookId) throw new Error('addNote called without a book_id.');
  if (!body) throw new Error('A note needs a body.');

  // origin defaults to 'human' and reviewed follows from it. Only the
  // draft_note MCP tool will pass 'assistant'.
  await createNote({
    book_id: bookId,
    body,
    quote: text(form, 'quote'),
    printed_page: number(form, 'printed_page'),
    tags: tags(form),
  });

  revalidatePath(`/books/${bookId}`);
  revalidatePath('/notes');
}

export async function editNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = number(form, 'id');
  const bookId = text(form, 'book_id');
  const body = text(form, 'body');

  if (id === null) throw new Error('editNote called without an id.');
  if (!body) throw new Error('A note needs a body.');

  // Editing sets reviewed and leaves origin alone, so an assistant draft she
  // has corrected still records where its first sentence came from.
  await updateNote(id, {
    body,
    quote: text(form, 'quote'),
    printed_page: number(form, 'printed_page'),
    tags: tags(form),
  });

  if (bookId) revalidatePath(`/books/${bookId}`);
  revalidatePath('/notes');
}

// Deletion exists here and will have no counterpart on the MCP server. Removing
// her own writing stays in the application, where an accidental tool call
// cannot reach it.
export async function removeNote(form: FormData): Promise<void> {
  await requireAllowedUser();

  const id = number(form, 'id');
  const bookId = text(form, 'book_id');
  if (id === null) throw new Error('removeNote called without an id.');

  await deleteNote(id);

  if (bookId) revalidatePath(`/books/${bookId}`);
  revalidatePath('/notes');
}

// ---------------------------------------------------------------------------
// Bulk characterization
// ---------------------------------------------------------------------------

// Called from the catalogue's client table rather than from a form, because
// shift-click range selection needs browser state. The mutation is still a
// Server Action: only the selecting is client-side, and the guard runs here as
// it does everywhere else.
//
// Undefined means leave alone. That distinction is the whole safety property —
// a bulk bar whose "no change" is indistinguishable from a real value will
// eventually rewrite eighty-five records on one stray click.
export async function characterizeSelection(
  ids: string[],
  fields: { purpose?: Purpose; standing?: Standing },
): Promise<{ updated: number }> {
  await requireAllowedUser();

  const updated = await characterizeBooks(ids, fields);

  revalidatePath('/books');
  revalidatePath('/');
  for (const id of ids) revalidatePath(`/books/${id}`);

  return { updated };
}
