'use server';

// Server Actions for projects (migration 019, lib/projects.ts). Kept apart
// from lib/actions.ts, which is long enough; the conventions are the same:
// every action checks the user, and an empty text field is null.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAllowedUser } from '@/lib/auth/guard';
import {
  PROJECT_KINDS,
  addListWorks,
  addProjectNotes,
  addProjectWorks,
  createProject,
  deleteProject,
  removeProjectNote,
  removeProjectWorks,
  updateProject,
  type ProjectInput,
  type ProjectKind,
} from '@/lib/projects';

function text(form: FormData, key: string): string | null {
  const raw = form.get(key);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function projectId(form: FormData): number {
  const id = Number.parseInt(text(form, 'project_id') ?? '', 10);
  if (Number.isNaN(id)) throw new Error('No project given.');
  return id;
}

function input(form: FormData): ProjectInput {
  const name = text(form, 'name');
  if (!name) throw new Error('A project needs a name.');
  const kind = text(form, 'kind');
  const due = text(form, 'due_on');
  return {
    name,
    kind: PROJECT_KINDS.some((k) => k.id === kind) ? (kind as ProjectKind) : 'comps',
    list_id: text(form, 'list_id'),
    question: text(form, 'question'),
    due_on: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
  };
}

function refresh(id?: number) {
  revalidatePath('/projects');
  if (id !== undefined) revalidatePath(`/projects/${id}`);
}

export async function newProject(form: FormData): Promise<void> {
  await requireAllowedUser();
  const id = await createProject(input(form));
  refresh();
  redirect(`/projects/${id}`);
}

export async function saveProject(form: FormData): Promise<void> {
  await requireAllowedUser();
  const id = projectId(form);
  await updateProject(id, input(form));
  refresh(id);
}

// The form carries a confirmation box; without it nothing happens.
export async function removeProject(form: FormData): Promise<void> {
  await requireAllowedUser();
  const id = projectId(form);
  if (form.get('confirm') !== 'yes') return;
  await deleteProject(id);
  refresh();
  redirect('/projects');
}

// From the catalogue's selection bar: the ticked works into, or out of, one
// project. Only works added to it can be taken out; a work reached through a
// note stays until the note leaves.
export async function addWorksToProject(
  project: number,
  workIds: string[],
): Promise<{ changed: number }> {
  await requireAllowedUser();
  const changed = await addProjectWorks(project, workIds);
  refresh(project);
  revalidatePath('/works');
  return { changed };
}

export async function removeWorksFromProject(
  project: number,
  workIds: string[],
): Promise<{ changed: number }> {
  await requireAllowedUser();
  const changed = await removeProjectWorks(project, workIds);
  refresh(project);
  revalidatePath('/works');
  return { changed };
}

export async function addListToProject(form: FormData): Promise<void> {
  await requireAllowedUser();
  const id = projectId(form);
  const listId = text(form, 'list_id');
  if (listId) await addListWorks(id, listId);
  refresh(id);
}

export async function removeNoteFromProject(form: FormData): Promise<void> {
  await requireAllowedUser();
  const id = projectId(form);
  const noteId = Number.parseInt(text(form, 'note_id') ?? '', 10);
  if (!Number.isNaN(noteId)) await removeProjectNote(id, noteId);
  refresh(id);
}

// From the notes page's selection bar: the ticked notes into one project. An
// axis brings its parts (lib/projects.ts).
export async function addSelectionToProject(
  project: number,
  noteIds: number[],
): Promise<{ added: number }> {
  await requireAllowedUser();
  const added = await addProjectNotes(project, noteIds);
  refresh(project);
  return { added };
}
