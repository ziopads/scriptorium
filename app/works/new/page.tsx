import Link from 'next/link';

import { addStubWork } from '@/lib/actions';
import { requireAllowedUser } from '@/lib/auth/guard';
import { KIND_LABEL } from '@/lib/types';
import type { WorkKind } from '@/lib/types';

export const dynamic = 'force-dynamic';

// A work that is not on her lists: Radin, Carpentier, Bolaños. Title and
// whatever else she has; the rest is blank on purpose and waits in /gaps.
// Marked as added by her and not yet assigned a purpose, which is the record
// of how it got here.

export default async function NewWorkPage() {
  await requireAllowedUser();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted">
          <Link href="/works" className="hover:text-accent">Catalogue</Link>
        </p>
        <h1 className="text-2xl mb-1">Add a work</h1>
        <p className="text-sm text-muted">
          For a work that is not on your lists. Give what you have; the rest can be
          filled in later from the gaps page.
        </p>
      </div>

      <form action={addStubWork} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm">Title</span>
          <input type="text" name="title" required />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="min-w-56 flex-1 space-y-1">
            <span className="text-sm">Author</span>
            <input type="text" name="author" placeholder="Radin, Paul" />
            <span className="block text-xs text-muted">Surname first, as it will be cited.</span>
          </label>
          <label className="w-28 space-y-1">
            <span className="text-sm">Year</span>
            <input type="number" name="year" />
          </label>
          <label className="w-44 space-y-1">
            <span className="text-sm">Kind</span>
            <select name="kind" defaultValue="monograph">
              {(Object.keys(KIND_LABEL) as WorkKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-sm">Identifier</span>
          <input type="text" name="id" placeholder="left blank, it is made from author, title and year" />
          <span className="block text-xs text-muted">
            Permanent once created: notes point at it and it appears in the address.
            The form refuses an identifier that already exists.
          </span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Note to self</span>
          <textarea name="notes_internal" rows={2} placeholder="Cited in Adorno ch. 8; no file yet." />
        </label>

        <button
          type="submit"
          className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
        >
          Add to catalogue
        </button>
      </form>
    </div>
  );
}
