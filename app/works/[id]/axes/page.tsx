import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { listAxesForWork } from '@/lib/notes';

export const dynamic = 'force-dynamic';

// The book page's Axes tab: the axes of her argument that draw on this book,
// through a ficha or a synthesis.

export default async function WorkAxesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;
  const axes = await listAxesForWork(id);

  if (axes.length === 0) {
    return <p className="text-sm text-muted">No axis binds this work yet.</p>;
  }

  return (
    <ul className="max-w-3xl divide-y divide-rule border-y border-rule text-sm">
      {axes.map((ax) => (
        <li key={ax.axis_id} className="py-2">
          <Link href={`/axes/${ax.axis_id}`} className="hover:text-accent">
            {ax.axis_title}
          </Link>
          <span className="text-xs text-muted">
            {' '}· {ax.role === 'ficha' ? 'ficha' : ax.role === 'yield' ? 'named in the synthesis' : ax.role}
            {ax.reviewed ? '' : ' · proposal'}
          </span>
        </li>
      ))}
    </ul>
  );
}
