'use client';

import { useActionState } from 'react';

import { signInWithEmail } from './actions';

// There is no sign-up form. Accounts are created from the Neon Console, since
// Neon Auth allows open registration and a form here would only make that
// easier to find.

export default function SignInPage() {
  const [state, formAction, pending] = useActionState(signInWithEmail, null);

  return (
    <form action={formAction} className="mx-auto max-w-sm space-y-5 py-12">
      <div>
        <h1 className="text-2xl">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Scriptorium</p>
      </div>

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
  );
}
