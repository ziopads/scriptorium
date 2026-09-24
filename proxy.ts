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
    // Everything except the auth pages, the colophon, the auth API, and static
    // assets.
    //
    // The colophon is public by design: it credits a Met woodcut shown on the
    // sign-in page, and a credit that only signed-in readers can reach is not a
    // credit. It carries nothing of hers — /about, which describes the exam and
    // the note model, stays guarded.
    //
    // Files in public/ are served from the root, so excluding _next/static is
    // not enough: /initial-s-vogtherr.jpg was treated as a page, redirected to
    // the sign-in form, and rendered as alt text — on the sign-in page itself,
    // where nobody is signed in by definition. Anything with a file extension
    // is an asset and is left alone.
    //
    // A page route never has a dot in its last segment, so this cannot exclude
    // a real page.
    //
    // api/mcp is the remote MCP server, .well-known its OAuth metadata, and
    // oauth its authorization and token endpoints. Claude calls the first
    // three from Anthropic's servers and cannot follow a redirect to a sign-in
    // form; each decides access itself (lib/oauth.ts). /oauth/authorize does
    // send her to sign in, but its own way, keeping Claude's request in ?next=.
    '/((?!auth|colophon|api/auth|api/mcp|\\.well-known|oauth|_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)',
  ],
};
