'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

import { tagSelection } from '@/lib/actions';
import { addSelectionToProject } from '@/lib/project-actions';

// Selecting notes and tagging them in bulk.
//
// Zazil invented "Colonial Terror" on 14 September with notes already written
// that needed it, and there was no way to apply a tag to more than one note.
//
// Context rather than props, because NoteCard renders the <li> and is a server
// component: the page passes each card a client checkbox, and the checkbox and
// the bar find each other through here. The same shape as the catalogue's
// shift-click table, which could not simply be reused for that reason.

interface Selection {
  selected: Set<number>;
  toggle: (id: number, shift: boolean) => void;
  clear: () => void;
  selectAll: () => void;
  order: number[];
}

const Ctx = createContext<Selection | null>(null);

export function SelectionProvider({
  order,
  children,
}: {
  order: number[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // A ref, not state: read during a click and never rendered. As state it
  // would re-render every card on each tick.
  const anchorRef = useRef<number | null>(null);

  const toggle = useCallback(
    (id: number, shift: boolean) => {
      // Read the anchor BEFORE setSelected. The updater does not run until
      // React re-renders, by which time the assignment below has overwritten
      // the ref — which makes every shift-click a range from a row to itself.
      const anchor = anchorRef.current;

      setSelected((prev) => {
        const next = new Set(prev);
        const turningOn = !prev.has(id);

        if (shift && anchor !== null && anchor !== id) {
          const a = order.indexOf(anchor);
          const b = order.indexOf(id);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) {
              if (turningOn) next.add(order[i]);
              else next.delete(order[i]);
            }
            return next;
          }
        }

        if (turningOn) next.add(id);
        else next.delete(id);
        return next;
      });

      anchorRef.current = id;
    },
    [order],
  );

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const selectAll = useCallback(() => {
    setSelected((prev) => (prev.size === order.length ? new Set() : new Set(order)));
    anchorRef.current = null;
  }, [order]);

  const value = useMemo(
    () => ({ selected, toggle, clear, selectAll, order }),
    [selected, toggle, clear, selectAll, order],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useSelection(): Selection | null {
  return useContext(Ctx);
}

// Rendered inside NoteCard. Silent when there is no provider, so the same card
// works on a work page and inside an axis.
export function NoteCheckbox({ id }: { id: number }) {
  const selection = useSelection();
  if (!selection) return null;

  return (
    <input
      type="checkbox"
      checked={selection.selected.has(id)}
      // onChange does not carry shiftKey, so the work happens in onClick;
      // this exists to keep React from warning about a controlled input.
      onChange={() => {}}
      onClick={(e) => selection.toggle(id, e.shiftKey)}
      aria-label="Select this note"
      className="mt-1 w-auto shrink-0"
    />
  );
}

// Also puts the ticked notes into a project (migration 019). An axis ticked
// here brings its parts; lib/projects.ts reads them through parent_id.
export function BulkTagBar({
  knownTags,
  projects = [],
}: {
  knownTags: string[];
  projects?: { id: number; name: string }[];
}) {
  const selection = useSelection();
  const [tag, setTag] = useState('');
  const [project, setProject] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!selection) return null;

  const count = selection.selected.size;
  const typed = tag
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  function run(direction: 'add' | 'remove') {
    if (!selection || typed.length === 0 || count === 0) return;
    const ids = [...selection.selected];

    startTransition(async () => {
      const { updated } = await tagSelection(
        ids,
        direction === 'add' ? typed : [],
        direction === 'remove' ? typed : [],
      );
      setNote(
        `${direction === 'add' ? 'Added to' : 'Removed from'} ${updated} ${
          updated === 1 ? 'note' : 'notes'
        }`,
      );
      setTag('');
      selection.clear();
    });
  }

  function addToProject() {
    if (!selection || count === 0 || project === '') return;
    const ids = [...selection.selected];
    const target = Number(project);
    const name = projects.find((p) => p.id === target)?.name ?? 'the project';

    startTransition(async () => {
      const { added } = await addSelectionToProject(target, ids);
      setNote(`Added ${added} ${added === 1 ? 'note' : 'notes'} to ${name}`);
      selection.clear();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-rule py-2 text-xs">
      <label className="flex items-center gap-2 text-muted">
        <input
          type="checkbox"
          checked={count > 0 && count === selection.order.length}
          onChange={selection.selectAll}
          className="w-auto"
        />
        Select all {selection.order.length}
      </label>

      {count === 0 ? (
        <span className="text-muted">
          Tick a note, then shift-click another to take everything between.
        </span>
      ) : (
        <>
          <span>{count} selected</span>

          <input
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            list="known-tags"
            placeholder="tag, or several separated by commas"
            className="max-w-xs"
          />
          <datalist id="known-tags">
            {knownTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          <button
            type="button"
            onClick={() => run('add')}
            disabled={pending || typed.length === 0}
            className="border border-accent px-3 py-1 text-accent hover:bg-accent hover:text-background disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Add tag'}
          </button>
          <button
            type="button"
            onClick={() => run('remove')}
            disabled={pending || typed.length === 0}
            className="text-muted hover:text-accent disabled:opacity-50"
          >
            Remove tag
          </button>
          {projects.length > 0 ? (
            <span className="flex items-center gap-2">
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
                aria-label="Project"
                className="w-auto max-w-56"
              >
                <option value="">Project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addToProject}
                disabled={pending || project === ''}
                className="text-accent hover:underline disabled:opacity-50"
              >
                Add to project
              </button>
            </span>
          ) : null}

          <button type="button" onClick={selection.clear} className="text-muted hover:text-accent">
            Clear
          </button>
        </>
      )}

      {note ? <span className="text-accent">{note}</span> : null}
    </div>
  );
}
