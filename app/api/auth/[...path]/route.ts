import { auth } from '@/lib/auth/server';

// Proxies every Managed Better Auth call. Note that this exposes the sign-up
// endpoint as well as sign-in; that is inherent to the SDK and is why the
// allowlist in lib/auth/guard.ts, rather than registration, is what controls
// access.

export const { GET, POST } = auth.handler();
