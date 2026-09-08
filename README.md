# Scriptorium

A reading instrument for one reader. It holds the books of a doctoral
comprehensive exam list as text, keeps a correct bibliographic record for each,
and exposes both to search, to notes, and to a conversational assistant reached
over the Model Context Protocol.

Built for the reader, doctoral candidate in Spanish & Portuguese at CU
the university. Comprehensive exams are the exam date; the dissertation that follows
is the horizon the design is actually aimed at.

## Where the thinking is written down

Read these before changing anything structural. Each carries a changelog and the
reasoning behind decisions that already look settled.

| File | What it holds |
|---|---|
| `docs/REQUIREMENTS.md` | What it has to do. User stories with stable identifiers, decisions and their reasons, acceptance criteria. |
| `docs/ARCHITECTURE.md` | How it is built. Storage budget, schema departures, the MCP surface, and a section separating what was verified from what is recalled. |
| `docs/HANDOFF.md` | The original design conversation, including what was rejected and why. |

## Stack

- **Next.js** with the App Router, TypeScript, Tailwind
- **Neon** serverless Postgres with `pgvector` — chosen over Supabase because
  Supabase's free tier pauses a project after seven days of inactivity and holds
  it until someone opens the dashboard, which for a reader who works in bursts
  over two years means her notes go dark while she is at a conference
- **Cloudflare R2** for extracted page text, keeping roughly 70 MB out of a
  0.5 GB database cap
- **Vercel** for the application and, later, for the MCP route

The extraction pipeline is local Python and never deploys.

## Running it

```bash
npm install
npm run dev
```

Four variables in `.env.local`:

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | written by `neon link`; the pooled `-pooler` host |
| `NEON_AUTH_BASE_URL` | Neon Console → Auth → Configuration |
| `NEON_AUTH_COOKIE_SECRET` | `openssl rand -base64 32` |
| `ALLOWED_EMAILS` | comma-separated; this is the whole access model |

`npx tsc --noEmit` before committing. If it complains about a module under
`.next/dev/types`, a route was deleted and the generated validator is stale:
`rm -rf .next`.

The first request after five idle minutes is slow: Neon suspends the compute and
wakes it on the next query.

## Access

Authentication is Neon Auth — Better Auth, managed by Neon, with its tables in
the `neon_auth` schema of this same database. Authorization is ours.

Neon Auth allows anyone on the web to sign up, and `/api/auth/[...path]` proxies
that endpoint, so registration cannot be closed from here. What decides access is
`ALLOWED_EMAILS`, checked by `requireAllowedUser()` in every page **and every
Server Action**. The actions need their own check because a Server Action is a
POST endpoint that exists whether or not anyone rendered its form. The guard
fails closed: an unset variable admits nobody, so an unexpected `/auth/denied`
means check the environment before the account.

Accounts are created through a sign-up call, not through the console's **Create
user** button — that button makes an identity row without a credential, and such
an account cannot sign in. The temporary page that did this has been deleted;
adding a third person means restoring it briefly or using the Admin plugin.

There is no password reset. See `docs/REQUIREMENTS.md` §8.9.

## Database

```
db/schema.sql       authoritative; run once per database
db/seed-books.sql   85 rows transcribed from the reading list; re-runnable
```

The seed's header records its transcription rules — where gaps were left null,
which two source errors were corrected, and which entries named two works and
became two rows.

## Layout

```
app/
  page.tsx              the four lists with counts
  books/                catalogue, one record, the edit form
  gaps/                 incomplete records, one form per row
  auth/sign-in/         the only credential surface
  auth/denied/          signed in, not on the allowlist
  api/auth/[...path]/   proxies Managed Better Auth
lib/
  db.ts                 the Neon connection
  types.ts              row shapes, matching the schema column-for-column
  books.ts, notes.ts    queries, shared by pages and later by MCP tools
  citation.ts           Chicago 17th, generated from one book record
  actions.ts            Server Actions
  auth/                 the Neon Auth client and the allowlist guard
proxy.ts                requires a session; Next 16's middleware
db/                     schema and seed
docs/                   requirements, architecture, handoff
```

## Conventions

**Blank beats a guess.** An unknown publisher is null, never inferred. Empty form
inputs are normalised to null so that a record cannot look filled while being
empty.

**Citation correctness outranks recall.** A passage returned with the wrong
printed page is worse than a passage not returned. `page_offset` exists because a
file's page 30 is often printed page 12.

**Identifiers are permanent.** `books.id` is the primary key, notes and chunks
reference it, and it appears in URLs. The edit form displays it and will not
change it.

**Mutations are Server Actions.** Plain `<form action={...}>`, no client
JavaScript in the mutation path, no API routes to secure separately. `lib/` stays
server-only because `db()` reads the connection string.

**One model call at runtime.** Vivarium's rule is that the application never
calls a language model at runtime; semantic search cannot hold that line, so the
narrowed version is: the only runtime model call is embedding a search query, and
no text is ever generated inside the application. Position cards are written by
hand through a Claude subscription and entered as reviewed text.

**Explicit environment files.** `node --env-file=...`, never an implicit default.
Files are named at `git add`; never `git add -A`.

## State, September 2026

Working: sign-in behind a two-address allowlist, the catalogue, list membership,
the Chicago citation forms, reading status, the edit form, and the gaps page for
filling incomplete records.

Not built yet: the notes write path, password reset, extraction, chunking,
embeddings, search, position cards, and the MCP server. The build sequence and
what blocks each stage are in `docs/ARCHITECTURE.md`.

Not yet deployed. Vercel will need all four environment variables, and
`ALLOWED_EMAILS` is the one that must be confirmed before the first deployment
rather than after.
