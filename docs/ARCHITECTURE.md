# Scriptorium — architecture

**Version:** 0.6
**Date:** 2026-09-24
**Status:** draft
**Scope:** How the thing is built. What it has to do is in `REQUIREMENTS.md`;
what was rejected during the original design conversation is in `HANDOFF.md`.

---

## Changelog

- **0.6** (2026-09-24) — §1, §2, §4, §5 and §9 rewritten against the code and
  the database: page text in Neon's `pages` table (migration 006), not R2;
  storage as measured on 22 September, with the index dropped; the migrations
  as the schema and `schema.sql` stale; the repository as it is. §3 is
  superseded by `docs/PIPELINE.md`. Then §8 (the runtime call and where model
  text comes from) and §10 (the variables as they are) rewritten; §11 and §12
  marked as the record of 8 September, with where each open item stands.
- **0.5** (2026-09-24) — §7 rewritten against the code: two MCP servers with
  the same ten tools and instructions, OAuth as built, the matcher and its
  fixtures, projects (0.7.0). §2, §4, §5 and §9 still describe the design of
  8 September (page text in R2, `schema.sql` authoritative, `lib/books.ts`)
  and are next; page text has been in Neon's `pages` table since migration
  006.
- **0.4** (2026-09-08) — Triage run over 42 files. §4 rewritten from measurement
  rather than estimate: the corpus is about a quarter of the assumed size, and
  the storage ceiling that shaped the schema does not bind.
- **0.3** (2026-09-08) — Schema applied to the Neon production branch: 19
  statements, 87 ms. Both outstanding schema uncertainties closed by the run.
  `pg_trgm` is available on Neon, and Postgres accepted the generated `tsv`
  column with its `case` over `lang`.
- **0.2** (2026-09-08) — Three unknowns closed by reading sources. `halfvec` is
  available on Neon and indexable by HNSW to 4,000 dimensions. Voyage's free
  allowance is 200 million tokens on the current model generation, which covers
  the entire ingest more than ten times over and removes embedding cost from the
  design. Accent handling moved out of Postgres and into the loader. §5 now
  points at `db/schema.sql` as authoritative rather than duplicating it.
- **0.1** (2026-09-08) — Initial draft, following the hosting and card-generation
  decisions recorded in `REQUIREMENTS.md` §8.2 and §8.4.

---

## 1. Shape

One repository, one deployed application, one database, and a local pipeline
that never leaves the developer's machine.

```
her PDFs (pipeline/corpus/ACCOUNTED)
      │
      ▼  extract.py                 Python, local
  page JSON on disk ─────── load_pages.py ─────────▶ pages
  (pipeline/pages/)  ────── offsets.py ────────────▶ page numbering
      │
      ▼  chunk.py
  chunk JSON on disk ────── load_sections.py ──────▶ sections
  (pipeline/chunks/) ────── load_chunks.py ────────▶ chunks
                                                       │
                     embed.py, one batched call out ──▶ chunks.embedding
                                                       │
                                                 Neon Postgres
                                                       ▲
                                              Next.js on Vercel
                                     ┌─────────────────┴────────────────┐
                                     │    web pages    │    /api/mcp    │
                                     └─────────────────┴────────┬───────┘
                                                                │
                                                   Anthropic's infrastructure
                                                                │
                                                her Claude (web, desktop, phone)
```

The page JSON on disk is the durable artifact; every table the pipeline
writes is a copy derived from it and rebuilt per work. `docs/PIPELINE.md`
describes the stages as they run.

The arrow that surprises people is the last one. Remote MCP connections
originate from Anthropic's cloud rather than from the device she is holding, so
the server has to be reachable from the public internet even when she is using
Claude Desktop on the same laptop the database would otherwise sit on. That fact
is what closed the local-SQLite option, and it is worth remembering before
anyone proposes reopening it.

## 2. What runs where

| Piece | Where | Why there |
|---|---|---|
| Extraction, chunking, page numbering | James's machine, `pipeline/` | Deterministic, no network, re-runnable per work |
| Page and chunk JSON | `pipeline/pages/`, `pipeline/chunks/` | The durable artifact; the tables are derived from it |
| Embedding the corpus | `pipeline/embed.py`, one batched call out to Voyage | The only ingest step that leaves the machine |
| Works, lists, pages, chunks, vectors, notes, study aids, projects | Neon Postgres | One join reaches bibliography, page and passage together |
| Study aids | `pipeline/dossier.py`, through `claude -p` on James's subscription | No metered API key; she reviews every section |
| Web application | Vercel | Scaffold transfers from Vivarium |
| MCP servers | A route in that application; a local copy in `pipeline/` | §7 |
| Embedding a search query | The application, at search time | The one runtime model call, §8 |

Nothing in the ingest pipeline runs on Vercel. Vercel serves pages and answers
tool calls.

## 3. The pipeline

*Superseded by `docs/PIPELINE.md`, which describes the stages as they run.
What follows is the design of 8 September, kept for its reasoning; the R2
upload it mentions is not part of the pipeline.*

Four stages, each reading files and writing files, so any one can be re-run
without the others and none of them needs a database to test.

**Extract.** PyMuPDF or pdfplumber for text-layer PDFs; `ocrmypdf` for scans,
which writes a text layer back into the original PDF and preserves the page
model. Output is one JSON file per book, one entry per page, verbatim. This
artifact never changes once it is correct, and everything downstream is derived
from it.

**Chunk.** Paragraph boundaries, accumulating until the target size is exceeded,
falling back to sentence boundaries inside an oversized paragraph. Never mid
sentence, never across a chapter. Target ~400 words with 15 percent overlap.
Each chunk carries a start page and an end page because paragraphs cross page
breaks. Stamped with `chunker_version`.

**Embed.** Batched, a few hundred chunks per call. Stamped with
`embedding_model` and `embedding_dim`.

**Load.** Pushes chunks and vectors to Neon, and page JSON to R2. Scoped per
book: delete that book's chunks, insert the new ones, in a transaction. Vectors
live on chunk rows, so re-chunking a book means re-embedding it, which per book
is pennies and seconds.

## 4. Storage budget

Measured in Neon on 22 September, after the last batch. The project's limit
is 512 MB, counting data, indexes and history.

| | |
|---|---|
| In use | about 450 MB |
| `chunks` | about 315 MB, nearly all of it stored out of line (TOAST): the vectors and the chunk text; the heap itself is about 9 MB |
| Chunks embedded | roughly 19,000, voyage-4 at 1024 dimensions |

The estimate of 8 September (about 125 MB for the whole corpus) was made from
42 files and held for text; it did not hold for vectors and their index once
the corpus passed 90 files. Three consequences:

1. **The HNSW index is off.** It was built (152 MB) and dropped to make room.
   Search is a sequential scan over about 19,000 vectors: slower, same results.
   Rebuild when the corpus is final and there is room, both statements in one
   session:

       set maintenance_work_mem = '1GB';
       create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);

2. **Reloading leaves dead rows.** Deleting and reinserting a work's pages and
   chunks keeps the old versions in the file until a `vacuum full` rewrites it.
   Run `vacuum full chunks;` and `vacuum full pages;` after any batch that
   reloads several books. When the project reached the limit during batch 5 (a
   `load_chunks` failed with `DiskFull`), dropping the index and the vacuum
   took it from 637 MB to 423 MB.
3. **If it stays tight**, the choices are halving the embedding dimensions (a
   change to `embed.py` and a full re-embed, with some loss of retrieval
   quality) or a larger Neon plan.

## 5. Schema

The schema is the numbered migrations in `db/`, 002 to 019, applied and
recorded by `pipeline/migrate.py`, which also refuses to run a file whose
contents changed after it was applied. Run `migrate.py --status` before
pushing application code that depends on a migration. Each migration explains
itself in its header; `docs/ERD.md` draws the notes graph.

`db/schema.sql` is the starting point from before the numbering began and
stops at migration 002. It is not authoritative, and a fresh install cannot be
built from it alone. The target is a schema-only dump generated from Neon, so
that a new instance is one file plus `migrate.py --baseline 19`, tested once on
an empty Neon branch. Until then, one change is recorded in neither place:
`schema.sql` declares `chunks.embedding` as `vector(512)`, and `embed.py`
writes 1024 dimensions and prints the `alter table` to run when the column
disagrees, so the column was changed outside the migrations.

The decisions that shape the code:

- **Page text in Postgres** (migration 006, reversing the R2 decision of 8
  September). `pages` holds each file page's text and the folio read off it.
  The printed page is never stored: the `printed_pages` view computes it from
  `works.page_offset` and, for a file with several numbering runs,
  `page_offsets` (008), so a corrected offset moves every page and anchor at
  once. `works.r2_pages_key` is left over from the R2 design and unused.
- **Works, not books** (004): monographs, essays inside volumes
  (`container_id`), films. Whether a work is examinable is derived by the
  `examinable_works` view, never stored.
- **Notes as a graph** (004, 005): a quotation with its page (`note_anchors`)
  is a different edge from a claim about a whole work (`note_works`); an axis
  is a note whose parts are child notes; `origin` records who typed a note and
  `attribution` whose claim it states. A rejected proposal is hidden
  (`rejected_at`), never deleted.
- **Stamps on chunks**: `chunker_version`, `embedding_model`, `embedding_dim`,
  so a partly re-embedded corpus can be told apart.
- **Accent folding in the loader**: `chunks.text_search` is the chunk text
  lowercased with accents folded in Python, and queries are folded the same
  way, so Postgres needs no `unaccent`. *papa* and *papá* collide; accepted.
- **Page numbering** (014, 016, 017): `offset_problem` records what
  `offsets.py` could not settle, and acceptance (`pagination_accepted_at`,
  `pagination_basis`) records a person's decision beside it without erasing
  it. `docs/PAGE-NUMBERS.md`.
- **Projects** (019): works and notes gathered for one piece of writing,
  through two membership tables; a project's works cited is derived (§7,
  `lib/projects.ts`).

## 6. Retrieval

Keyword and vector rankings are two common table expressions over the same
table, combined by reciprocal rank fusion in one statement. Because both live in
`chunks`, this is a query rather than an integration, and building the keyword
path first costs nothing toward the vector path.

Three normalisations happen before any search. Smart quotes and ligatures are
folded and line-break hyphenation rejoined during extraction, so the damage
never reaches the database. Accent folding and lowercasing happen in the loader,
which writes `chunks.text_search`; queries are folded the same way before they
are run. `pg_trgm` provides the similarity fallback for the case that matters
most — the quotation she has slightly wrong.

`section_type` earns its place by exclusion. An index is noise and is filtered
out of semantic retrieval always; a bibliography is exactly what to search when
the question is who cites whom.

## 7. The MCP servers

Two servers answer the same ten tools with the same instructions text:

| | Where | For |
|---|---|---|
| Local | `pipeline/mcp_server.py`, stdio, registered in `.mcp.json` | Claude Code in the repository |
| Remote | `app/api/mcp/route.ts`, a thin mount over `mcp/server.ts` | Her Claude: web, desktop, phone |

The Python server came first and is the specification. Each tool in
`mcp/tools/` is a port of the Python tool of the same name, over the same
`lib/` the web pages use. **The two change together**, and their
`INSTRUCTIONS` text is identical, character for character.

**Tools** (version 0.7.0): `find_works`, `list_projects`, `list_gaps`,
`search`, `read_pages`, `find_quotation`, `get_study_aid`, `list_claims`,
`list_notes`, `draft_note`. `find_works`, `search` and `list_notes` take an
optional `project`.

**Transport.** `mcp-handler` 2.x with the v2 Model Context Protocol SDK and
zod 4, Streamable HTTP, at `https://scriptorium-mauve.vercel.app/api/mcp`.
She adds that URL under Customize → Connectors; once added on the web it
reaches the desktop and phone apps too. Claude caches a connector's tool
list: after a deploy that adds or changes tools, disconnect and connect
again. Claude Code keeps the local server it started with until `/mcp`
reconnects it.

**Auth.** OAuth 2.1, with the application as its own authorization server,
because Neon Auth cannot act as an OAuth provider. The consent screen sits
behind her ordinary sign-in and `ALLOWED_EMAILS`. Files: `lib/oauth.ts`,
`app/.well-known/oauth-authorization-server`,
`app/.well-known/oauth-protected-resource`, `app/oauth/authorize`,
`app/oauth/token`. Clients are identified by metadata document only, and a
`client_id` must be an https URL on `claude.ai`, so only Claude can connect.
Migration 018's `oauth_tokens` stores SHA-256 hashes of every value, never
the value: an authorization code lasts ten minutes, an access token an hour,
a refresh token thirty days and is replaced each time it is used. Revoking
access is deleting that person's rows.

**Page numbers** leave both servers as they leave the app: `page_label`, with
an asterisk when the work's numbering is unverified, and `page_verified`
(`yes`, `hand set`, `no`). The rule is `lib/page-verified.ts`; the Python
carries a port of it.

**The matcher.** `find_quotation` and `draft_note` look quotations up with the
matcher that built the study aids: `normalize`, `key` and `Book.find` in
`pipeline/dossier.py`, ported to `lib/matcher.ts` over
`lib/sequence-matcher.ts`. Exact on the named page and its neighbours, then
the whole book; a close match (92 per cent) near the named page only. The
header of `lib/matcher.ts` lists where Python and JavaScript differ and how
each difference is handled. Fixtures: `tests/matcher/cases.json` (invented
text), `tests/matcher/expected.json` (written by
`pipeline/matcher_fixtures.py`, never by hand), and `tests/matcher/corpus.json`
(real pages, gitignored). Runners: `pipeline/test_matcher.py` and
`npm run test:matcher`. Any change to the matcher in `dossier.py` means
regenerating `expected.json`, reading its diff, changing `lib/matcher.ts`, and
passing both runners before pushing.

**Write surface.** `draft_note` is the only tool that writes. Every quotation
is looked up in its book, and the book's own text and page are stored in
place of what the model sent; one quotation not found, on front matter, or
from a work whose numbering is not settled refuses the whole note. The note
is stored with origin `assistant` and reviewed false, so it waits in her
proposals queue. Attribution is `author`, `other` or empty; `own` is refused,
since whether a claim is hers is hers to say, and so is the `dossier` tag.
Note and anchors are written in one statement. No tool edits or deletes:
correcting and deleting her writing stay in the application.

**Copies kept in step.** Rules that live once in TypeScript and are copied
into the Python, each marked at both ends:

- `GAPS_SQL` and `GAP_LABELS`, from `fileStates()` and `FILE_STATES` in
  `lib/gaps.ts` (`list_gaps`, and the coverage counts on `search`).
- `PROJECT_WORKS_SQL` and `PROJECT_NOTES_SQL`, from `projectWorks()` in
  `lib/projects.ts` and `mcp/project.ts`.
- The page-number rule, from `lib/page-verified.ts`.
- `INSTRUCTIONS`, from `mcp/server.ts`.

## 8. Runtime model calls

Vivarium's principle is that the application is a dumb reader and never calls a
language model at runtime. Scriptorium cannot hold that line and have semantic
search, so the line moves to a stated place:

> The only model call the application makes at runtime is embedding a search
> query. No text is ever generated inside the application.

The call is `lib/embed.ts`, used by the search page and by `search` on the
remote MCP server, through `lib/search.ts`: Voyage,
voyage-4 at 1024 dimensions with input type `query`, matching the corpus,
which `pipeline/embed.py` embeds once, offline, with input type `document`.
Change one side and every score is wrong.

Text a model writes reaches the database from outside the application, and
always as something she reviews:

- **Study aids**, generated offline by `pipeline/dossier.py` through `claude -p`
  on James's machine and loaded as unreviewed dossier sections and claims.
- **Proposals from her own Claude**, through `draft_note` (§7), stored as
  unreviewed notes with every quotation verified against the page text.

Nothing else calls out.

## 9. Repository layout

```
app/                         one directory per route
  page.tsx                   the workbench (panes in components/workbench/)
  works/                     the catalogue; works/[id]/ has the work's tabs
  lists/, readiness/         the reading lists; the readiness matrix
  notes/, axes/              notes and their review queues; the mapa de cruces
                             and the axis map
  search/                    search by word and by meaning, as a motif strip
  projects/                  projects, each with its works and notes
  works-cited/               a bibliography from ?id= or ?project=
  gaps/                      what the catalogue still lacks, one tab per kind
  como/, about/, colophon/   her instructions; the argument; credits
  auth/, oauth/, .well-known/  sign-in; the OAuth authorization server (§7)
  api/mcp/route.ts           the remote MCP server's mount
  api/export/                CSV of works and of notes
components/                  shared components; workbench/ for the three panes
lib/                         reads, writes and rules shared by pages and tools
  db.ts                      the Neon HTTP client
  works.ts, notes.ts, projects.ts, readiness.ts, gaps.ts,
  pages.ts, sections.ts, dossier.ts, axis-map.ts, motif.ts
  search.ts                  both searches, shared with the MCP server
  actions.ts, project-actions.ts   Server Actions
  citation.ts                Chicago 17th and 18th and MLA from one record
  page-verified.ts           the page-number rule for everything that leaves
  matcher.ts, sequence-matcher.ts  the quotation matcher, from dossier.py
  embed.ts                   query embedding
  oauth.ts, auth/            OAuth for the MCP server; the sign-in guard
mcp/                         the remote MCP server: server.ts, tools/ (one
                             file per tool), shared helpers
pipeline/                    Python, local only, never deployed
  extract.py, chunk.py, load_pages.py, offsets.py,
  load_sections.py, load_chunks.py, embed.py   the ingest stages
  dossier.py                 study aids, through claude -p
  mcp_server.py              the local MCP server
  migrate.py, backup.py, dbconn.py, search.py
db/                          migrations 002-019; schema.sql (stale); seeds
tests/matcher/               the matcher's fixtures (§7)
docs/                        ARCHITECTURE, PIPELINE, PAGE-NUMBERS, ERD,
                             NOTES-AND-CONNECTIONS, REQUIREMENTS, and her
                             instructions COMO-TOMAR-NOTAS, COMO-PREGUNTAR;
                             HANDOFF is gitignored
```

Other scripts in `pipeline/` are one-off or retired (`reconcile.py`,
`sync_books.py`, `status.py` among them); the handoff's clean-up list names
them.

## 10. Environments and secrets

Two places hold the variables: `.env.local` at the repository root, which
Next.js reads in development and `pipeline/dbconn.py` reads for the pipeline,
and Vercel's project settings (Production and Preview) for the deployed
application. A changed Vercel variable reaches only a new build, so redeploy
after editing one.

| Variable | Read by |
|---|---|
| `DATABASE_URL` | the application (the pooled connection) |
| `DATABASE_URL_UNPOOLED` | the pipeline and `migrate.py` (a real session), `.env.local` only |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | sign-in |
| `ALLOWED_EMAILS` | sign-in and the OAuth consent screen (§7) |
| `VOYAGE_API_KEY` | `embed.py`, and `search` at runtime |
| `GOOGLE_BOOKS_API_KEY` | `enrich.py --google`, catalogue records from Google Books; optional |

Values are named in documentation and never reproduced; a key is checked by
its length or its last four characters. **Never append to `.env.local`
without first making sure it ends in a newline**: on 23 September an appended
line was glued onto the last one and broke the Voyage key
(`docs/PIPELINE.md` §8).

## 11. Verified against recalled

*The record of 8 September, kept as it was written. Where it and the sections
above disagree, the sections above are current.*

Checked on 8 September 2026, by reading the source:

- Remote MCP connections originate from Anthropic's infrastructure regardless of
  client; Claude Desktop ignores remote servers in `claude_desktop_config.json`;
  custom connectors span Free through Enterprise with Free limited to one; iOS
  and Android can use servers added on the web; authless and OAuth are both
  supported — Anthropic support documentation on building custom connectors via
  remote MCP.
- `mcp-handler` 2.x behaviour, dependency versions, statelessness, and the
  removal of the Redis requirement — the package's own documentation and Vercel's
  changelog.
- Anthropic offers no embedding model and recommends Voyage AI; voyage-3-large
  exposes 256, 512, 1024, and 2048 dimensions — Anthropic's embeddings
  documentation.
- Neon free plan: 0.5 GB storage per project, 100 compute-hours, scale to zero
  after five minutes and not disableable, reactivation in a few hundred
  milliseconds, Launch at $0.35 per GB-month — Neon's plans and scale-to-zero
  documentation.
- pgvector is available on every Neon plan with no paid tier required, installed
  per database; HNSW indexes `vector` to 2,000 dimensions and `halfvec` to
  4,000; `halfvec` arrived in pgvector 0.7 — Neon's pgvector documentation.
- Voyage's free allowance is 200 million tokens on the current model generation.
  The corpus is on the order of 12 to 15 million tokens, so ingest and years of
  query embeddings both fit inside it — Voyage pricing coverage, checked against
  two independent summaries dated within the last week.
- The schema applies cleanly to Neon. All 19 statements in `db/schema.sql` ran
  against the production branch on 8 September 2026 in 87 ms, which confirms
  both that `pg_trgm` is on Neon's extension allow-list and that the generated
  `tsv` column is accepted. This project runs pgvector 0.8.6 and pg_trgm 1.6, so
  `halfvec` is in hand (it arrived in pgvector 0.7).
- Supabase free plan: 500 MB database, seven-day inactivity pause requiring a
  manual restore — Supabase pricing coverage, several sources agreeing.

Recalled and **not** verified, flagged for checking before it matters:

- The output dimensions and multilingual quality of Voyage's current generation.
  The published dimension options belonged to the previous generation; confirm
  against Voyage's own documentation before `chunks.embedding` is declared.
- Word and token counts for the corpus — **now measured**. See §4: 8,568 pages
  and 18.8 million characters across 42 files, 34 with a usable text layer and
  492 pages needing optical character recognition.
- **Raised by the triage, not yet resolved:** several files are excerpts rather
  than whole volumes, three are separate chapters of one title, and one title
  appears twice under different filenames. `books.source_path` assumes one file
  per book and does not accommodate this. See §12.

## 12. Open items

*The list of 8 September, kept as it was written. Where each stands on 24
September:*

1. *Several files for one work: `works.source_path` takes several filenames
   separated by `|`. The reverse, one file holding two works (the Rulfo and
   Aristóteles volumes), is open; see the handoff.*
2. *Settled: voyage-4 at 1024 dimensions (§8).*
3. *Moot: page text is in Neon (§5).*
4. *Became the study aids (`dossier_sections`, `pipeline/dossier.py`).*
5. *Settled: works outside the lists are her dissertation research and are
   kept; they are not examinable.*

1. **One book, several files.** The triage found three separate PDFs covering
   one title, and several files that are excerpts rather than whole volumes.
   `books.source_path` is a single column. Either the files are concatenated
   before extraction, or a `sources` table carries one row per file with its own
   `page_offset`. The second is correct; the first is faster and covers about
   five books.
2. Embedding model and dimension (`REQUIREMENTS.md` §8.5), which fixes
   `chunks.embedding`. No longer constrained by storage.
3. Whether `expand_context` fetches per book or per page from R2. Decide after
   measuring one fetch.
4. Position card schema (§8.4), to be settled with her. Now reachable before the
   exam, since the corpus is 81 percent text-layer.
5. Which files in the corpus folder are not on the reading list, and whether
   they are ingested anyway as dissertation material.
