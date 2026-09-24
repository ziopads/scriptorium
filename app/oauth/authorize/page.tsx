// The consent screen Claude opens when a connector is added with sign-in.
//
// proxy.ts leaves /oauth to this page, because the sign-in middleware's
// redirect drops the query string and with it Claude's request. So the page
// does its own: not signed in goes to /auth/sign-in with ?next= pointing back
// here, signed in but not on the allowlist goes to /auth/denied.
//
// A bad client or redirect_uri is shown here and never redirected to: an
// address the client's own metadata document does not list must not receive
// anything, not even an error. The screen names the client by the host of its
// client_id, not by the name it gives itself, as the CIMD draft requires.

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth/server';
import { getAllowedUser } from '@/lib/auth/guard';
import { AUTHORIZE_FIELDS, checkAuthorize, originFrom, readAuthorizeParams } from '@/lib/oauth';
import { allow, deny } from './actions';

export const dynamic = 'force-dynamic';

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const p = readAuthorizeParams((name) => {
    const v = sp[name];
    return Array.isArray(v) ? v[0] : v;
  });

  const { data: session } = await auth.getSession();
  if (!session?.user) {
    const back = new URLSearchParams();
    for (const f of AUTHORIZE_FIELDS) if (p[f]) back.set(f, p[f]);
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/oauth/authorize?${back.toString()}`)}`);
  }
  const user = await getAllowedUser();
  if (!user) redirect('/auth/denied');

  let host: string;
  try {
    host = (await checkAuthorize(p, originFrom(await headers()))).host;
  } catch (err) {
    return (
      <div className="mx-auto max-w-sm space-y-4 py-12">
        <h1 className="text-2xl">Cannot connect</h1>
        <p className="text-sm">This request to connect to Scriptorium was refused.</p>
        <p className="text-sm text-accent">{(err as Error).message}</p>
      </div>
    );
  }

  const hidden = AUTHORIZE_FIELDS.map((f) => <input key={f} type="hidden" name={f} value={p[f]} />);

  return (
    <div className="mx-auto max-w-sm space-y-5 py-12">
      <h1 className="text-2xl">Connect Claude</h1>
      <p className="text-sm">
        <strong>{host}</strong> is asking to read Scriptorium as <strong>{user.email}</strong>: the
        catalogue, the books&rsquo; text and your notes, through the tools the connector offers.
      </p>
      <p className="text-xs text-muted">
        Access lasts until it is revoked. Signing out here does not end it.
      </p>
      <div className="flex gap-3">
        <form action={allow}>
          {hidden}
          <button
            type="submit"
            className="border border-accent px-4 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
          >
            Allow
          </button>
        </form>
        <form action={deny}>
          {hidden}
          <button type="submit" className="border border-rule px-4 py-1.5 text-sm text-muted hover:text-accent">
            Deny
          </button>
        </form>
      </div>
    </div>
  );
}
