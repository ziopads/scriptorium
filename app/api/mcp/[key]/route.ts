// The remote MCP endpoint: https://<host>/api/mcp/<MCP_PATH_KEY>
//
// Deploy 1 of the phased plan (docs/HANDOFF.md, 23 Sept). Access is decided
// here, because proxy.ts excludes this path from the sign-in middleware — a
// redirect to /auth/sign-in means nothing to Claude. Two checks, both needed:
//
//   1. The path key equals MCP_PATH_KEY, compared in constant time. Unset or
//      empty admits nobody, as ALLOWED_EMAILS does.
//   2. On Vercel, the caller is inside Anthropic's egress range,
//      160.79.104.0/21 (claude.com/docs/connectors/building/authentication).
//      Vercel overwrites x-forwarded-for to prevent spoofing
//      (vercel.com/docs/headers/request-headers). Skipped when running
//      locally, where there is no Vercel in front and the caller is you.
//
// Either failure is a plain 404, so a wrong guess learns nothing. This is
// proportionate only while the server returns catalogue data; OAuth tied to
// her login comes before any book text is served.

import { timingSafeEqual } from 'node:crypto';
import { handler } from '@/mcp/server';

export const dynamic = 'force-dynamic';

const ANTHROPIC_NET = ipv4ToInt('160.79.104.0');
const ANTHROPIC_MASK = 0xffffffff << (32 - 21);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n;
}

function fromAnthropic(req: Request): boolean {
  const raw = req.headers.get('x-vercel-forwarded-for') ?? req.headers.get('x-forwarded-for') ?? '';
  const ip = ipv4ToInt(raw.split(',')[0].trim());
  if (ip === null || ANTHROPIC_NET === null) return false;
  return (ip & ANTHROPIC_MASK) === (ANTHROPIC_NET & ANTHROPIC_MASK);
}

function keyMatches(given: string): boolean {
  const expected = process.env.MCP_PATH_KEY ?? '';
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function guarded(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!keyMatches(key)) return new Response('Not found', { status: 404 });
  if (process.env.VERCEL && !fromAnthropic(req)) return new Response('Not found', { status: 404 });
  return handler(req);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
