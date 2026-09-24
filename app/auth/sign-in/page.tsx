'use client';

import { use, useActionState } from 'react';

import { InitialS, InitialSCredit } from '@/components/initial-s';
import { signInWithEmail } from './actions';

// There is no sign-up form. Accounts are created from the Neon Console, since
// Neon Auth allows open registration and a form here would only make that
// easier to find.
//
// The woodcut sits beside the form on a wide screen and above it on a narrow
// one, which is the right order to read them in either way round.

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [state, formAction, pending] = useActionState(signInWithEmail, null);
  // Set by app/oauth/authorize; the action accepts only that page as a target.
  const nextParam = use(searchParams).next;
  const next = Array.isArray(nextParam) ? nextParam[0] : nextParam;

  return (
    // The layout's main already carries the header's container and padding, so
    // no mx-auto here: left-aligned, the woodcut's edge under the wordmark's S.
    <div className="flex max-w-2xl flex-col gap-8 py-12 sm:flex-row sm:items-start sm:gap-12">
      <figure className="m-0 shrink-0 space-y-2 sm:w-52">
        <InitialS size={208} className="border border-rule" />
        <figcaption>
          <InitialSCredit />
        </figcaption>
      </figure>

      <form action={formAction} className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-2xl">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Scriptorium</p>
        </div>

        {next ? <input type="hidden" name="next" value={next} /> : null}

        <label className="block space-y-1">
          <span className="text-sm">Email</span>
          <input type="text" name="email" autoComplete="username" required />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Password</span>
          <input type="password" name="password" autoComplete="current-password" required />
        </label>

        {state?.error ? <p className="text-sm text-accent">{state.error}</p> : null}

        <button
          type="submit"
          disabled={pending}
          className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background disabled:opacity-50"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
