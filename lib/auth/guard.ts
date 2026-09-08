import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth/server';

// Authorization. Two people may use this application; everyone else may hold an
// account and see nothing.
//
// The allowlist is checked in two places, and both are necessary. Pages call it
// so that a signed-in stranger sees a refusal rather than a catalogue. Server
// Actions call it because an action is a POST endpoint that exists
// independently of the page rendering its form — guarding the page and not the
// action is the usual way this goes wrong.

export interface AllowedUser {
  id: string;
  email: string;
  name?: string | null;
}

function allowlist(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

// Returns the user when signed in and permitted, and null otherwise. Fails
// closed: an unset or empty ALLOWED_EMAILS admits nobody, so a missing
// environment variable in production locks the application rather than opening
// it.
export async function getAllowedUser(): Promise<AllowedUser | null> {
  const { data: session } = await auth.getSession();

  // Narrowed once, here. Optional chaining on session?.user?.email proves
  // nothing to the compiler about session at the point of the return.
  const user = session?.user;
  const email = user?.email?.toLowerCase();
  if (!user || !email) return null;

  const permitted = allowlist();
  if (permitted.length === 0) return null;
  if (!permitted.includes(email)) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

// For pages and Server Actions. Redirects rather than throwing, so an
// unauthorised visitor lands somewhere that explains itself.
export async function requireAllowedUser(): Promise<AllowedUser> {
  const user = await getAllowedUser();
  if (!user) redirect('/auth/denied');
  return user;
}
