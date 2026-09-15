'use client';

import { useState, useTransition } from 'react';

import { rateWork } from '@/lib/actions';

// Five stars on a catalogue row. Clicking the star she is already on clears
// the rating, because unrated and rated-one are different states and there has
// to be a way back to the first (migration 007).
//
// Optimistic: the star fills on click and the server catches up. Rating a
// hundred works is a run of single clicks, and waiting a round trip for each
// would make the list feel broken. On failure it snaps back and says so.

export function Stars({
  id,
  value,
  onChanged,
}: {
  id: string;
  value: number | null;
  onChanged?: (value: number | null) => void;
}) {
  const [shown, setShown] = useState<number | null>(value);
  const [hover, setHover] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function rate(n: number) {
    const next = shown === n ? null : n;
    const previous = shown;
    setShown(next);
    setFailed(false);
    onChanged?.(next);

    startTransition(async () => {
      try {
        await rateWork(id, next);
      } catch {
        setShown(previous);
        setFailed(true);
      }
    });
  }

  const lit = hover ?? shown ?? 0;

  return (
    <span
      className="inline-flex shrink-0 items-baseline"
      onMouseLeave={() => setHover(null)}
      title={failed ? 'Could not save that rating' : shown ? `${shown} of 5` : 'Not yet rated'}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => rate(n)}
          onMouseEnter={() => setHover(n)}
          aria-label={`Rate ${n} of 5`}
          aria-pressed={shown === n}
          className={`px-px text-sm leading-none ${
            failed ? 'text-muted' : n <= lit ? 'text-accent' : 'text-rule hover:text-accent'
          }`}
        >
          {n <= lit ? '★' : '☆'}
        </button>
      ))}
    </span>
  );
}
