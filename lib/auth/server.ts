import { createNeonAuth } from '@neondatabase/auth/next/server';

// Managed Better Auth, hosted by Neon. Authentication only — proving that
// someone is who they say. Authorization is ours and lives in ./guard.ts.
//
// That division matters here. Neon Auth currently allows anyone on the web to
// sign up, and our own /api/auth/[...path] route proxies that API, so open
// registration is reachable whether or not we build a sign-up form. Accounts
// are therefore created from the Neon Console, and access is decided by the
// allowlist rather than by who managed to register.

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
  },
});
