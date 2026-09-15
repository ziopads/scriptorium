'use client';

import { useRef, type ReactNode } from 'react';

// A form that empties itself once the action has run.
//
// Every field in the note form is uncontrolled, and an uncontrolled input
// keeps whatever the user typed when the server component re-renders around
// it. The workbench redirects to the URL it is already on, so nothing
// unmounts, and after saving she was left looking at her own text in the
// textarea with no sign that anything had happened.
//
// reset() sits in a finally so it runs whether the action returned or
// redirected. Resetting a form that is about to unmount costs nothing.
//
// The action is passed in as a prop, which is allowed for server actions and
// keeps this component ignorant of which form it is wrapping.

export function ResettingForm({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      className={className}
      action={async (formData: FormData) => {
        try {
          await action(formData);
        } finally {
          ref.current?.reset();
        }
      }}
    >
      {children}
    </form>
  );
}
