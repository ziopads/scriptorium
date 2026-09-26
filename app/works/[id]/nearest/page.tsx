import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { nearestWorks } from '@/lib/neighbours';

export const dynamic = 'force-dynamic';

// The book page's Nearest tab: the five works whose text most resembles this
// one's, with each language's average taken away first (lib/neighbours.ts).
// A prompt for pairings, not evidence: it cannot say why two books sit
// together, and a pairing is worth something only once she has read both.

function who(n: { author: string | null; editor: string | null; title: string }): string {
  return (n.author ?? n.editor ?? n.title).split(',')[0];
}

export default async function WorkNearestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;
  const result = await nearestWorks(id);

  if (!result) {
    return (
      <p className="text-sm text-muted">
        This work has no searchable text yet, so there is nothing to compare it with. Works
        that cannot be searched are listed on{' '}
        <Link href="/gaps/files" className="text-accent hover:underline">
          Gaps → Files
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <ol className="divide-y divide-rule border-y border-rule text-sm">
        {result.neighbours.map((n) => (
          <li key={n.id} className="flex items-baseline gap-3 py-2">
            <span className="w-12 shrink-0 font-mono text-xs text-muted">{n.similarity.toFixed(2)}</span>
            <Link href={`/works/${encodeURIComponent(n.id)}/nearest`} className="min-w-0 flex-1 hover:text-accent">
              {who(n)}, <span className="italic">{n.title}</span>
              {n.year !== null ? <span className="text-muted"> ({n.year})</span> : null}
            </Link>
            {n.lang && n.lang !== result.lang ? (
              <span className="shrink-0 text-xs text-muted">in {n.lang === 'spanish' ? 'Spanish' : 'English'}</span>
            ) : null}
            <Link href={`/?w=${encodeURIComponent(n.id)}`} className="shrink-0 text-xs text-accent hover:underline">
              workbench
            </Link>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted">
        Similarity of the whole text, 1 being identical, after taking away what every
        {result.lang === 'spanish' ? ' Spanish' : result.lang === 'english' ? ' English' : ''} book
        has in common, so that works in the other language can appear. It says two books share
        vocabulary and themes, never why: a prompt for a pairing, not evidence for one. The{' '}
        <Link href={`/map?focus=${encodeURIComponent(id)}`} className="text-accent hover:underline">
          corpus map
        </Link>{' '}
        shows the same resemblances for every work at once.
      </p>
    </div>
  );
}
