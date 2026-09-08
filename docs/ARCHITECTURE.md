# Scriptorium — architecture

**Version:** 0.3
**Date:** 2026-09-08
**Status:** draft
**Scope:** How the thing is built. What it has to do is in `REQUIREMENTS.md`;
what was rejected during the original design conversation is in `HANDOFF.md`.

---

## Changelog

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

The 0.5 GB Neon free-plan ceiling is the constraint that shapes the schema.

| | Naive | As designed |
|---|---|---|
| Page text | 70 MB in Postgres | 0 — lives in R2 |
| Chunk text | ~80 MB | ~80 MB |
| Vectors | 110 MB at 1024 dims | ~55 MB at 512 dims |
| Vector index | ~110 MB | ~55 MB |
| Full-text index | ~40 MB | ~40 MB |
| **Total** | **~410 MB** | **~230 MB** |

Three levers produced the second column, and they are independent:

1. **Pages in R2.** The handoff already treats pages as the durable artifact and
   the database as derived, so this follows the design rather than bending it.
   One JSON object per book. `expand_context` fetches the book's object and
   slices the requested page range. If per-book fetch latency becomes annoying,
   the fallback is one object per page, which R2's free operation allowances
   absorb without difficulty.
2. **512 dimensions rather than 1024.** On a corpus of this size, embedding
   dimension will not be what limits retrieval quality. Voyage's models expose
   256, 512, 1024, and 2048.
3. **`halfvec`.** pgvector's 16-bit float column halves vector storage again.
   Confirmed available on Neon, on every plan, and indexable by Hierarchical
   Navigable Small World (HNSW) up to 4,000 dimensions against 2,000 for the
   ordinary `vector` type.

Lever 3 is held in reserve. If the corpus lands larger than estimated, it buys
another 55 MB without touching anything else.

Overrunning the free plan is not a cliff. Neon's Launch plan has no monthly
minimum, storage at $0.35 per GB-month; 400 MB is about fourteen cents a month.

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

## 7. The MCP server

Mounted as a route handler in the same Next.js application, using Vercel's
`mcp-handler`. Version 2.x serves the current 2026-07-28 protocol natively and
2025-era Streamable HTTP through a stateless fallback from the same handler; the
old HTTP+SSE transport is gone and Redis is not needed. It requires the v2
Model Context Protocol SDK packages, zod ^4, and Node 20 or later, and Fluid
compute should be enabled on Vercel.

Tool definitions live in `mcp/tools/`, so the handoff's instruction that the
server occupy its own directory is honoured while the route stays a thin mount
over the same `lib/` the web pages use. Retrieval logic exists once.

**Transport.** Streamable HTTP. She adds the URL under Customize → Connectors;
Claude Desktop will not connect to a remote server configured through
`claude_desktop_config.json`. Once added on the web, it is available on iOS and
Android as well, which is the whole reason for choosing hosted over local.

**Auth.** Claude supports both authless and OAuth-based remote servers. Three
levels, in rising cost: authless at an unguessable path with Anthropic's
published address ranges allowlisted at the edge; a static bearer token entered
in the connector's advanced settings; full OAuth through `withMcpAuth`. Level 1
is proportionate for development. The thing that argues for more eventually is
`draft_note`, since the read tools expose a corpus that mostly sits on library
shelves while the write tool touches her own writing.

**Write surface.** `draft_note` is the only tool that writes, it writes one note
per call, and it requires a `book_id` and a quoted passage. There is no tool to
edit or delete. Correction and deletion of her own writing stay in the
application, where an accidental call cannot reach them.

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
- Word and token counts for the corpus, which come from the handoff's estimate
  rather than from measurement.

## 12. Open items

1. The extraction triage (`REQUIREMENTS.md` §8.1). Blocks the storage estimate
   as well as the schedule.
2. Authentication for the web application (§8.8).
3. Embedding model and dimension (§8.5), which fixes `chunks.embedding`.
4. Whether `expand_context` fetches per book or per page from R2. Decide after
   measuring one fetch.
5. Position card schema (§8.4), to be settled with her.
