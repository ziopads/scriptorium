'use server';

import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth/server';

export async function signInWithEmail(
  _prev: { error: string } | null,
  form: FormData,
): Promise<{ error: string } | null> {
  const email = form.get('email');
  const password = form.get('password');

  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'Email and password are both required.' };
  }

  const { error } = await auth.signIn.email({ email, password });

  // Deliberately not distinguishing an unknown address from a wrong password.
  if (error) {
    return { error: 'That email and password did not match an account.' };
  }

  redirect('/');
}

export async function signOut(): Promise<void> {
  await auth.signOut();
  redirect('/auth/sign-in');
}
