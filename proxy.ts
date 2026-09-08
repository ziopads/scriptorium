import { auth } from '@/lib/auth/server';

// Next 16 names this file proxy.ts; on earlier versions it is middleware.ts
// with a default export named middleware. The logic is identical.
//
// This layer only establishes that someone is signed in. It knows nothing about
// the allowlist, because middleware runs on the edge and the allowlist decision
// belongs beside the data. Pages and Server Actions call requireAllowedUser().

export default auth.middleware({
  loginUrl: '/auth/sign-in',
});

export const config = {
  matcher: [
    // Everything except the auth pages, the auth API, and static assets.
    '/((?!auth|api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
};
