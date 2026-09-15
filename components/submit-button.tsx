'use client';

import { useFormStatus } from 'react-dom';

// A submit button that refuses a second press while the first is in flight.
//
// On 14 September three identical notes were written 456 and 247 milliseconds
// apart: one impatient triple-click, each press firing its own submit before
// the first response returned. A check inside the server action cannot stop
// that — the three requests overlap — so the guard has to be here, on the
// button.
//
// It also says "Saving…", which is the feedback whose absence caused the
// clicking in the first place.

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={
        className ??
        'border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-accent'
      }
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
