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

import {
  addToList,
  removeFromList,
  setStatus,
  updateImprint,
  upsertBook,
} from '@/lib/books';
import type { Book, BookInput } from '@/lib/types';

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
  const id = text(form, 'id');
  const status = text(form, 'status') as Book['status'] | null;
  if (!id || !status) throw new Error('changeStatus needs an id and a status.');

  await setStatus(id, status);

  revalidatePath('/books');
  revalidatePath(`/books/${id}`);
}

export async function joinList(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const listId = text(form, 'list_id');
  if (!id || !listId) throw new Error('joinList needs an id and a list_id.');

  await addToList(listId, id, text(form, 'rationale'));

  revalidatePath('/');
  revalidatePath(`/books/${id}`);
}

export async function leaveList(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const listId = text(form, 'list_id');
  if (!id || !listId) throw new Error('leaveList needs an id and a list_id.');

  await removeFromList(listId, id);

  revalidatePath('/');
  revalidatePath(`/books/${id}`);
}
