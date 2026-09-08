import { createNeonAuth } from '@neondatabase/auth/next/server';

// Managed Better Auth, hosted by Neon. Authentication only — proving that
// someone is who they say. Authorization is ours and lives in ./guard.ts.
//
// That division matters here. Neon Auth currently allows anyone on the web to
// sign up, and our own /api/auth/[...path] route proxies that API, so open
// registration is reachable whether or not we build a sign-up form. Accounts
// are therefore created from the Neon Console, and access is decided by the
// allowlist rather than by who managed to register.
//
// This client is constructed at module load rather than lazily, because
// proxy.ts calls auth.middleware() at module scope. Both variables must
// therefore be present at BUILD time, not only at runtime — a Vercel build with
// either one missing fails while collecting page data.
//
// The checks below exist because the SDK's own error for a missing secret
// reports the line number of an unrelated import, which sends you looking in
// the wrong file.

const baseUrl = process.env.NEON_AUTH_BASE_URL;
const secret = process.env.NEON_AUTH_COOKIE_SECRET;

if (!baseUrl) {
  throw new Error(
    'NEON_AUTH_BASE_URL is not set. It is in the Neon Console under Auth → ' +
      'Configuration, and it must exist in the build environment as well as at runtime.',
  );
}

if (!secret) {
  throw new Error(
    'NEON_AUTH_COOKIE_SECRET is not set. Generate one with `openssl rand -base64 32`. ' +
      'It must exist in the build environment as well as at runtime.',
  );
}

export const auth = createNeonAuth({
  baseUrl,
  cookies: { secret },
});
