# Scriptorium — architecture

**Version:** 0.5
**Date:** 2026-09-24
**Status:** draft
**Scope:** How the thing is built. What it has to do is in `REQUIREMENTS.md`;
what was rejected during the original design conversation is in `HANDOFF.md`.

---

## Changelog

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

One repository, one deployed application, one database, one object store, and a
local pipeline that never leaves the developer's machine.

```
her PDFs (local)
      │
      ▼  extract          Python, local, deterministic
  pages JSON on disk ──────────────────────────────────┐
      │                                                 │ upload
      ▼  chunk            Python, local, deterministic  │
  chunk JSON on disk                                    ▼
      │                                            Cloudflare R2
      ▼  embed            one batched call out      (page text)
  chunks + vectors                                       ▲
      │                                                  │
      ▼  load                                            │
   Neon Postgres  ◀────────────────────────────────┐     │
      ▲                                            │     │
      │                                     Next.js on Vercel
      │                              ┌──────────────┴─────────────┐
      │                              │  web pages   │  /api/mcp   │
      └──────────────────────────────┴──────────────┴──────┬──────┘
                                                            │
                                              Anthropic's infrastructure
                                                            │
                                               her Claude (web, desktop, phone)
```

The arrow that surprises people is the last one. Remote MCP connections
originate from Anthropic's cloud rather than from the device she is holding, so
the server has to be reachable from the public internet even when she is using
Claude Desktop on the same laptop the database would otherwise sit on. That fact
is what closed the local-SQLite option, and it is worth remembering before
anyone proposes reopening it.

## 2. What runs where

| Piece | Where | Why there |
|---|---|---|
| Extraction, chunking | Her files, James's machine | Deterministic, no network, no key, re-runnable |
| Embedding | Local script, one call out | The only ingest step that leaves the machine |
| Books, lists, notes, cards, chunks, vectors | Neon Postgres | One join reaches bibliography and passage together |
| Page text | Cloudflare R2 | Keeps ~70 MB out of a 0.5 GB cap; pages are already the on-disk artifact |
| Web application | Vercel | Scaffold transfers from Vivarium |
| MCP server | A route in that same application | Cannot drift from the schema it reads |
| Position card generation | Her Claude subscription, by hand | No metered API; the manual step is the review anyway |

Nothing in the ingest pipeline runs on Vercel. Vercel serves pages and answers
tool calls.

## 3. The pipeline

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

Measured, not estimated. `pipeline/triage.py` over the 42 files in hand: 8,568
pages, 18.8 million characters, about 4.7 million tokens. The original design
assumed 70 MB of text; it is 18 MB. At a 400-word target that is roughly 9,000
chunks rather than 27,000.

| | Measured, 1024 dimensions |
|---|---|
| Page text | 18 MB |
| Chunk text | ~21 MB |
| Vectors | ~37 MB |
| Vector index | ~37 MB |
| Full-text index | ~10 MB |
| **Total** | **~125 MB** |

Even doubled for the full 85-book list rather than the 42 files in hand, that
sits inside Neon's 0.5 GB free-plan ceiling with room to spare. **The storage
constraint that shaped this design does not bind.** Three consequences:

1. **Embedding dimension is no longer expensive.** 1024 is affordable, so the
   choice follows retrieval quality rather than arithmetic.
2. **`halfvec` stays in reserve**, and is now unlikely to be needed. It remains
   available: pgvector 0.8.6 on this project, HNSW-indexable to 4,000
   dimensions against 2,000 for the ordinary `vector` type.
3. **Pages still live in R2, but now by design rather than by necessity.** Pages
   are the durable artifact and the database is derived from them; keeping that
   division visible in the infrastructure is worth more than the 18 MB it saves.
   One JSON object per book; `expand_context` fetches it and slices the page
   range.

Overrunning the free plan was never a cliff in any case. Neon's Launch plan has
no monthly minimum, storage at $0.35 per GB-month.

## 5. Schema

`db/schema.sql` is authoritative and carries its reasoning inline. What follows
is the list of departures from the handoff's version and why each one exists.

**No `pages` table.** Page text lives in R2 under `books.r2_pages_key`. The
chunker reads page JSON from disk, so nothing in the pipeline wants a pages
table either.

**`notes.origin` and `notes.reviewed`.** A note written by `draft_note` is
`assistant` and unreviewed; editing it in the application sets `reviewed` and
leaves `origin` alone, so provenance survives the edit. Human notes default to
reviewed, since writing one is reviewing it.

**`notes.printed_page` rather than `page`.** Naming the column for the printed
folio makes it hard to write the file page into it by accident. The offset is
applied once, at ingest, from `books.page_offset`.

**`chunks.embedding_model` and `embedding_dim`.** Same argument as
`chunker_version`. Six weeks in, some books will have been re-embedded and
others not, and without the stamp there is no way to tell which rows came from
which model short of guessing.

**`chunks.text_search`.** The chunk text lowercased with accents folded, written
by the loader in Python. Both sides of a search use it, so an unaccented query
matches accented text. Doing the folding in the pipeline avoids `unaccent`,
which is not immutable and would otherwise need a wrapper function created only
to satisfy a generated column. The cost is that *papa* and *papá* collide in
retrieval; that is accepted, since optical character recognition on Spanish
scans mangles accents anyway and trigram similarity backs up the near miss.

**`vector(512)`.** Provisional, and the one column that is expensive to change.
It is fixed by decision §8.5, which is not yet made. Nothing in the September
work touches this table, so the declaration can wait until the model is chosen.

**The vector index is not created in the schema file.** Building HNSW on an
empty table accomplishes nothing, and at roughly 27,000 rows a sequential scan
is fast enough that the index can wait until after the first load.

On the `tsvector`: it is a generated column with a `case` over `lang` selecting
between two literal configurations, both of which are immutable. Postgres
accepted it on 8 September 2026, so the fallback of having the loader write a
plain `tsvector` column is not needed.

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

Corpus embeddings are computed once, offline, and arrive in Postgres as ordinary
column values. Position cards are generated by hand through her own Claude
subscription and entered as reviewed text. Nothing else calls out.

## 9. Repository layout

```
app/
  page.tsx                 catalogue landing
  books/[id]/page.tsx      one book: bibliography, card, notes
  notes/                   notes browsing, tags, export
  admin/                   ingest status, incomplete records
  api/mcp/route.ts         thin mount over mcp/
lib/
  db.ts                    Neon client
  books.ts, notes.ts       reads and writes, shared by pages and tools
  search.ts                keyword, vector, hybrid
  pages.ts                 R2 fetch for expand_context
  citation.ts              Chicago formatting from one book record
mcp/
  tools/                   one file per tool, importing lib/
  server.ts                tool registration
pipeline/                  Python, local only, never deployed
  extract.py, chunk.py, embed.py, load.py
db/
  schema.sql
docs/
  REQUIREMENTS.md, ARCHITECTURE.md, HANDOFF.md
```

## 10. Environments and secrets

Explicit env files, carried from Vivarium: `node --env-file=.env.local`, never
an implicit default. The pipeline reads its own file and is never given the
production connection string by accident.

Secrets in play: the Neon connection string, R2 credentials, an embeddings key
if one is used, and whatever the MCP route uses for auth. Named in documentation,
values never reproduced.

## 11. Verified against recalled

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
