# Scriptorium

A reading instrument for one reader. It holds the books of a doctoral
comprehensive exam list as text, keeps a correct bibliographic record for each,
and exposes both to search, to notes, and to a conversational assistant reached
over the Model Context Protocol.

The design target is the dissertation that follows the exams, a horizon of
roughly two years. The exam itself is an early slice: whatever is ready by then
is a gain, and nothing is compromised to reach it.

Deployed at `https://scriptorium-mauve.vercel.app`; the remote MCP server is at
`/api/mcp` on the same host.

## Where the thinking is written down

Read these before changing anything structural. Each carries a changelog and the
reasoning behind decisions that already look settled.

| File | What it holds |
|---|---|
| `docs/REQUIREMENTS.md` | What it has to do: user stories, decisions and their reasons, acceptance criteria. |
| `docs/ARCHITECTURE.md` | How it is built: what runs where, storage, schema, the MCP servers, the runtime model call, the repository, the environment. |
| `docs/PIPELINE.md` | How files on disk become rows: the batch, the gate, which file a work reads, space, traps. |
| `docs/PAGE-NUMBERS.md` | Printed page numbers: offsets, ranges, accepted pagination, the unverified-page marker. |
| `docs/NOTES-AND-CONNECTIONS.md`, `docs/ERD.md` | The notes model and its diagram. |
| `docs/COMO-TOMAR-NOTAS.md`, `docs/COMO-PREGUNTAR.md` | Her instructions, the source of the wording on `/como` and `/como/claude`. |

`docs/HANDOFF.md` is the running handoff between working sessions: what was
done, what is outstanding, what went wrong. It is gitignored because it names
works from her exam list.

## Stack

- **Next.js** with the App Router, TypeScript, Tailwind
- **Neon** serverless Postgres with `pgvector`, holding the catalogue, the page
  text, the chunks and their vectors, notes and study aids. Chosen over
  Supabase because Supabase's free tier pauses a project after seven days of
  inactivity and holds it until someone opens the dashboard, which for a reader
  who works in bursts over two years means her notes go dark while she is at a
  conference
- **Voyage** (voyage-4, 1024 dimensions) for embeddings: the corpus once,
  offline; a search query at runtime
- **Vercel** for the application and the remote MCP server

The corpus pipeline is local Python in `pipeline/` and never deploys.

## Running it

```bash
npm install
npm run dev
```

The variables and who reads each are in `docs/ARCHITECTURE.md` §10. They live in
`.env.local` for development and the pipeline, and in Vercel's settings for the
deployment; a changed Vercel variable reaches only a new build. Never append to
`.env.local` without first making sure it ends in a newline.

**`npx tsc --noEmit` before every push.** `next dev` strips types without
checking them; Vercel's build checks them, so a type error fails the deploy. If
it complains about a module under `.next/dev/types`, a route was deleted and the
generated validator is stale: `rm -rf .next`.

Deploying is `git push origin main`; watch Vercel's Deployments for Ready.

The pipeline runs as `pipeline/.venv/bin/python3 pipeline/<script>.py`, naming
works by full id or `--pending N`. `docs/PIPELINE.md` has the batch.

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

The remote MCP server uses the same sign-in: the application is its own OAuth
authorization server, and its consent screen sits behind `ALLOWED_EMAILS`
(`docs/ARCHITECTURE.md` §7).

Accounts are created through a sign-up call, not through the console's **Create
user** button — that button makes an identity row without a credential, and such
an account cannot sign in. The temporary page that did this has been deleted;
adding a third person means restoring it briefly or using the Admin plugin.

There is no password reset. See `docs/REQUIREMENTS.md` §8, item 9.

## Database

The schema is the numbered migrations in `db/`, applied and recorded by
`pipeline/migrate.py`:

```
pipeline/.venv/bin/python3 pipeline/migrate.py --status    what is applied, what is pending
pipeline/.venv/bin/python3 pipeline/migrate.py --dry-run   name what would run
pipeline/.venv/bin/python3 pipeline/migrate.py             apply what is pending
```

Run `--status` before pushing code that depends on a migration. `db/schema.sql`
stops at migration 002 and is not authoritative (`docs/ARCHITECTURE.md` §5).

## Layout

`docs/ARCHITECTURE.md` §9. In short: `app/` the routes, `components/`, `lib/`
the reads, writes and rules shared by pages and tools, `mcp/` the remote MCP
server, `pipeline/` the local Python, `db/` the migrations, `tests/matcher/` the
quotation matcher's fixtures, `docs/`.

## Conventions

**Blank beats a guess.** An unknown publisher is null, never inferred. Empty form
inputs are normalised to null so that a record cannot look filled while being
empty.

**Citation correctness outranks recall.** A passage returned with the wrong
printed page is worse than a passage not returned. Every page number leaves the
application one way, through `lib/page-verified.ts`: `page_label` with an
asterisk when the work's numbering is unverified, and `page_verified`.

**Identifiers are permanent.** `works.id` is the primary key, notes and chunks
reference it, and it appears in URLs. The edit form displays it and will not
change it.

**Mutations are Server Actions.** No API routes to secure separately. `lib/`
stays server-only because `db()` reads the connection string.

**One model call at runtime:** embedding a search query. No text is generated
inside the application; study aids are generated offline and proposals arrive
through `draft_note`, both for her review (`docs/ARCHITECTURE.md` §8).

**The two MCP servers change together**, with identical instructions text
(`docs/ARCHITECTURE.md` §7).

**Files are named at `git add`;** never `git add -A`.

## State

Working, deployed: the catalogue and reading lists, the workbench (a book's
pages, contents, study aid and notes beside a note form that takes a selected
passage with its page), notes, axes and their review queues, the Gaps tabs, the
readiness matrix, projects with their works cited in Chicago 17th and 18th and
MLA, and the remote MCP server (0.7.0) behind OAuth, which is where semantic
search over the corpus lives; the application itself has no search page yet.

What is outstanding is in `docs/HANDOFF.md`.
