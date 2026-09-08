import { signOut } from '@/app/auth/sign-in/actions';

// Reached when someone is signed in but not on the allowlist. Also reached when
// ALLOWED_EMAILS is unset, since the guard fails closed — if this appears for an
// address that should work, check the environment variable before the account.

export const dynamic = 'force-dynamic';

export default function DeniedPage() {
  return (
    <div className="mx-auto max-w-sm space-y-4 py-12">
      <h1 className="text-2xl">No access</h1>
      <p className="text-sm">
        That account exists but is not permitted to use this catalogue.
      </p>
      <form action={signOut}>
        <button type="submit" className="text-sm text-accent hover:underline underline-offset-2">
          Sign out
        </button>
      </form>
    </div>
  );
}
