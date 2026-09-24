# The corpus pipeline

**Version:** 0.2
**Date:** 2026-09-23
**Scope:** How files on disk become rows in the database. Page numbering —
offsets, ranges, accepted pagination and the unverified-page marker — is in
`PAGE-NUMBERS.md`. The application is in `ARCHITECTURE.md`; what it has to do
is in `REQUIREMENTS.md`. Current counts are on the Gaps page; this document
carries none.

---

## Changelog

- **0.2** (2026-09-23) — Rewritten against the code. The seven-stage batch,
  the gate, which file a work reads, space. The seeding scripts kept as
  history. Page numbering moved to `PAGE-NUMBERS.md`.
- **0.1** (2026-09-13) — Written after the seeding session. Records the script
  order, the decisions embedded in each, and the traps that cost real time.

---

## 1. The batch

Seven stages, run in this order for the same works:

```
extract → chunk → load_pages → offsets --apply → load_sections → load_chunks → embed
```

Every stage runs as `pipeline/.venv/bin/python3 pipeline/<stage>.py` from the
repo root, takes full work ids or `--pending N`, and refuses with neither. A
near-miss id prints the ids containing it and stops. `--list CODE` limits
`--pending` to one list or section (`I`, `II.C`, `Supl. III`). Every stage but
`offsets` takes `--dry-run`; `offsets` writes nothing without `--apply`.

| Stage | Reads | Writes | `--pending` picks |
|---|---|---|---|
| `extract` | `works.source_path`; the PDF in `corpus/ACCOUNTED` | `pages/{id}.json` | a file in `ACCOUNTED`, no JSON on disk, no pages loaded |
| `chunk` | `pages/{id}.json` | `chunks/{id}.json` | a pages JSON, no chunks JSON, no chunks loaded |
| `load_pages` | `pages/{id}.json` | `pages`, `page_loads`; clears `offset_checked_at`, `offset_problem`, `pagination_accepted_at` | a pages JSON, no pages loaded |
| `offsets` | `printed_pages`, `page_offsets` | `page_offset`, `offset_checked_at`, `offset_problem` | pages loaded, no chunks, never checked |
| `load_sections` | `pages/{id}.json`, `printed_pages` | `sections` | checked, not blocked (§2), no chunks |
| `load_chunks` | `chunks/{id}.json`, `printed_pages` | `chunks`, without vectors | the same |
| `embed` | `chunks` where `embedding` is null | `embedding`, `embedding_model`, `embedding_dim` | checked, not blocked, chunks without vectors |

Each stage picks exactly what the one before it finished, so a batch run with
the same `N` at every stage walks the same books, and a book that fails a stage
drops out of the later ones. `--pending` orders works as the lists print them,
with her dissertation additions last.

**`--pending` knows nothing of agreements.** A work is held back from it only
by `dbconn.LEAVE_ALONE`, which is empty. A work that is waiting on a decision
but is otherwise ready for a stage will be picked by the next `--pending` run of
that stage. To hold works back, name the others.

**Reloading needs names.** Once a work has chunks, `offsets`, `load_sections`
and `load_chunks` no longer pick it. After changing a work's offset or ranges,
name it: `offsets`, then `load_sections`, `load_chunks`, `embed`. A chunk's
`start_page` and `end_page` are computed when it is loaded, so its printed pages
stay wrong until `load_chunks` runs again.

**One work per transaction.** Every loader deletes and reinserts the work's
rows, so a rerun replaces them. Deleted rows stay in the table's file until
`vacuum full` rewrites it (§4).

**The pages JSON is the durable artifact.** Chunks, vectors and database rows
derive from it and can be rebuilt without opening a PDF again. Its
`printed_page` field is always the file page: `extract.py` writes offset 0 and
no loader reads the field. Printed pages exist only in the `printed_pages` view
(`PAGE-NUMBERS.md`).

**Chunks** are runs of whole paragraphs, about 2,800 characters, never more
than 3,600, overlapping by about 400. A chunk ends at a page break only where
the language changes (facing-page editions). Pages under 50 characters never
start or end a chunk. `section_type` is left null. `CHUNKER_VERSION` is stamped
on each file: change the sizes, bump it, rerun.

**Embedding** is voyage-4 at 1,024 dimensions by default, `input_type='document'`;
the app embeds queries with `input_type='query'`. `embed.py` resumes where it
stopped; `--replace` re-embeds rows stamped with a different model.

### For reference: a batch, as run

    caffeinate -i sh -c 'P="pipeline/.venv/bin/python3 -u"; N=15; $P pipeline/extract.py --pending $N; $P pipeline/chunk.py --pending $N; $P pipeline/load_pages.py --pending $N; $P pipeline/offsets.py --apply --pending $N; $P pipeline/load_sections.py --pending $N; $P pipeline/load_chunks.py --pending $N; $P pipeline/embed.py --pending $N' 2>&1 | tee /tmp/scriptorium-batch-N.log

    grep -E 'ch/p|confirmed|corrected|PROBLEM|failed|loaded|embedded' /tmp/scriptorium-batch-N.log

Check what `--pending` will pick, with `--dry-run` on the first stage, before
running a batch.

## 2. The gate

A work is **blocked** when `works.offset_problem` is set and
`works.pagination_accepted_at` is null. A blocked work has pages and nothing
else: no sections, chunks or embeddings.

- **`--pending`**: `load_sections`, `load_chunks` and `embed` pick only works
  checked and not blocked (`dbconn.pending()`).
- **Named works**: the same three pass named ids through
  `skip_offset_problems()`, which prints each blocked work with its problem and
  drops it.

**The named path tests only the problem.** A work never checked has no
`offset_problem`, so naming it passes. `load_pages` clears both
`offset_checked_at` and `offset_problem`; naming that work in `load_chunks`
before `offsets.py` has run would load chunks whose page numbers nobody
checked. `--pending` does not have this gap.

### How `offsets.py` judges

It reads `(page_index, printed_page, folio)` for every page from
`printed_pages`, where `printed_page` already reflects any ranges. Folios are the
numbers `extract.py` read on each page's first or last line before removing
running heads.

1. **No pages**: reported; nothing written.
2. **Stray readings set aside.** Each folio implies an offset
   (`folio − page_index`). Folios whose offset is implied by fewer than 3 pages
   (`MIN_REPEAT`) are discarded as note numbers or misread digits. The rest are
   the consistent folios.
3. **Too few**: fewer than 8 consistent folios (`MIN_FOLIOS`) is a problem,
   before any offset is considered. A file that prints no numbers can never
   pass.
4. **Confirmed**: 90 per cent or more of consistent folios (`CONFIDENT`) equal
   the printed page the view already gives. This is also how a work fixed by
   hand, by offset or ranges, clears its flag.
5. **Runs.** Consistent folios in page order, neighbours implying the same
   offset, form runs; a run is a sequence when its first and last folio are at
   least 5 file pages apart (`MIN_RUN`) — a distance in file pages, whatever the
   number of folios. The source comment says "fewer than MIN_RUN pages"; the
   code keeps runs where last − first ≥ 5, which is six pages inclusive.
6. **The work has ranges**: a problem, "page_offsets ranges disagree with the
   folios", with the sequences found.
7. **More than one sequence**: a problem, "Enter page_offsets ranges".
8. **Corrected**: one offset accounts for 90 per cent of consistent folios and
   differs from the stored one. If it equals the stored offset while the view
   disagrees, something else is in play: a problem, "check printed_pages".
9. **Otherwise**: a problem giving the four commonest offsets and their counts.

| Verdict | `page_offset` | `offset_checked_at` | `offset_problem` |
|---|---|---|---|
| confirmed | unchanged | now | cleared |
| corrected | new offset | now | cleared |
| problem | unchanged | now | the problem, in words |

`offsets.py` never touches `pagination_accepted_at` or `pagination_basis`.

**Known limit.** Stray readings implied by three or more pages count as
disagreement, so a work whose ranges are right can fail: Derrida's *Mal de
archivo*, eleven readings at `page_index − 1`, 84 per cent. The fix is to
measure a ranged work against its ranges rather than every number read. Not
made.

## 3. Which file

**`works.source_path`**, edited on the work's Edit page and shown on the work
page and the Gaps Files tab, is the only record of which PDF a work is.
`books.csv` and `mapping.csv` are read by no stage.

**Only a PDF in `corpus/ACCOUNTED` counts.** A name missing there, or present
twice, refuses the work and says where the name was seen. An EPUB, or the same
PDF in another folder, does not count.

**Several files** are separated by `|`, read in that order and numbered
continuously; the pages JSON records each file's page span under `sources`.

**Spellings are reduced to the one on disk** before comparing: decomposed by
macOS, composed by a spreadsheet, prefixed with `pipeline/corpus/`, or mangled
into MacRoman by a spreadsheet that guessed the encoding (`dbconn.py`).

**One `source_path` gives a work the whole file.** A volume holding two works
(the Rulfos, Aristóteles) needs page ranges per work before extraction, and
nothing supports that yet (§7).

## 4. Space

*From the handoff of 22 Sept; not rechecked against Neon for this revision.*

Neon's limit is 512 MB, counting data, indexes and history. `chunks` is nearly
all TOAST: the vectors and chunk text stored out of line. Deleting and
reinserting a work's rows leaves the old versions in the file until
`vacuum full` rewrites it, so **run the vacuum after any batch that reloads
several books**. A `load_chunks` that fails with `DiskFull` is recovered with,
in the Neon SQL editor:

    drop index if exists chunks_embedding_idx;
    vacuum full chunks;
    vacuum full pages;

**The HNSW index is off**, dropped to make room; search is a sequential scan,
slower and correct. Rebuild when the corpus is final and there is room, both
statements in one session:

    set maintenance_work_mem = '1GB';
    create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);

If space stays tight: halve the embedding dimensions (a change to `embed.py`
and a full re-embed, some loss of retrieval quality) or a larger plan.

## 5. Other scripts

### In use

| Script | What it does |
|---|---|
| `migrate.py` | applies numbered migrations in `db/`, records them with a checksum; `--status` before pushing app code |
| `check_pdf.py` | whether a PDF can support a page citation; run before adding a file |
| `reconcile.py` → `relist.py` | compare a new version of the lists with the catalogue; emit a migration moving `list_sections` and `list_items` |
| `isbns.py` → `enrich.py --by-isbn` | ISBNs from the files in `ACCOUNTED`; imprint proposals; `--apply` fills blank fields only |
| `upload_document.py` | puts a file (the exam list) in the `documents` table |
| `backup.py` | dumps the irreplaceable tables; `--all` adds pages and chunks |
| `dossier.py` | builds and loads a work's study aid; named works only |
| `search.py` | semantic search from the command line |
| `mcp_server.py` | the local MCP server |

### History: how the catalogue was seeded (13 Sept)

Not part of the running pipeline. The catalogue now changes through
`reconcile.py` → `relist.py` → a migration.

| Script | Reads | Writes |
|---|---|---|
| `parse_list.py` | the reading-list docx | `list.csv` |
| `check_pdf.py` | `corpus/*.pdf` | `citability.csv` |
| `match_corpus.py` | `list.csv`, `overrides.csv`, `corpus/` | `matches.csv` |
| `make_seed.py` | `list.csv`, `matches.csv`, `citability.csv` | `db/seed.sql` |
| `triage.py` | `corpus/` | `triage.csv` — text-layer survey |

`seed.sql` is entirely upserts; re-running it corrects rows in place and does
not touch notes or anchors.

**`overrides.csv`** binds a list title to a filename when the matcher cannot.
Cross-language editions score zero on title tokens — *Specters of Marx* against
*Espectros de Marx* — and no threshold fixes that. An override always wins.

> Never record a negative. A blank `filename_contains` asserts "not held", and
> a line saying Don Chipote was not held survived the arrival of Don Chipote
> and suppressed the file.

**`make_seed.py`'s tables** — `SPLITS`, `CONTAINERS`, `EMPTY_SECTIONS` — are
keyed by work id and verified at run time.

### Stale, slated for removal

These still read `mapping.csv` or `books.csv`, so their picture is out of date:
`coverage.py`, `viability.py`, `inventory.py` (writes `books.csv`), `link.py`,
`status.py`, `sync_books.py`. Also `reconcile.csv`, `mapping.csv`, and the
`dbconn.books()` stub.

## 6. Decisions worth not relitigating

**Neon says which file is which work** (§3). **A work has a file only if its
PDF is in `ACCOUNTED`.**

**Work ids are permanent.** Derived from author and title in `parse_list.py`.
Notes anchor to them, chunks reference them, they appear in URLs.

**Citability is not the file extension.** `check_pdf.py` decides it, and the
decisive test is printed folios at a non-zero offset. Producer metadata is
circumstantial: calibre is often used to strip DRM without touching pagination,
and macOS stamps Quartz PDFContext on anything re-saved through Preview.

**An offset is set from the folios** by `offsets.py` (§2), and written only in
the unambiguous case. A missing page number is visibly incomplete; a wrong one
is not.

**A large positive offset means an excerpt**: the file begins partway into the
book. A small one can mean leaves missing before the first numbered page.

**Partial and unusable copies are recorded as not held**, with a note saying
what exists. A catalogue claiming she has Gerhard when there are 28 pages of it
is worse than one saying she has nothing.

**A blocked work gets pages only** (§2). **Acceptance is recorded beside the
evidence** and does not clear it (`PAGE-NUMBERS.md`).

**Examinable is derived, never stored** — from list membership, including a
container's. See the `examinable_works` view.

## 7. Known gaps

Recorded, not fixed.

- Naming a work in `load_sections`, `load_chunks` or `embed` skips the
  "never checked" test (§2).
- Nothing holds a work back from `--pending` but `LEAVE_ALONE` (§1).
- `pagination_basis` is never cleared, including by `load_pages.py`.
- The `MIN_RUN` comment in `offsets.py` disagrees with the code (§2).
- The pages JSON's `printed_page` is always the file page (§1).
- Two-page spreads are not split: Lienhard, *La voz y su huella*.
- A volume holding two works is not supported: the Rulfos, Aristóteles (§3).
- `extract.py` reads a DOI as a folio. `folio_from()` takes the first number in
  a line it has identified as a running head, and Cambridge Elements print
  "https://doi.org/10.1017/… Published online by Cambridge University Press" on
  every page, so every page of Keetley's *Folk Gothic* has folio 10. Every
  reading is then a stray, `offsets.py` finds too few folios (the work was
  accepted `hand_set` at −6), and `read_pages` warns "the page reads 10" on
  every page. Fix: skip numbers inside a URL or DOI, then re-extract and
  recheck. Other Elements in the corpus will behave the same.

## 8. Traps that cost time

**The Neon SQL editor keeps its buffer.** Clear it before pasting. A stale
`seed.sql` produced identical row counts and silently omitted every
`page_offset`.

**A failed transaction blocks the connection.** `ROLLBACK required` on an
unrelated query means an earlier statement failed inside `begin`. Click
ROLLBACK; read the ERROR tab before re-running.

**An explicit null overrides a column default.** Naming every column in an
insert means a missing dict key sends `null` into a column that would otherwise
have defaulted.

**macOS filenames are decomposed Unicode.** `á` is `a` plus a combining acute,
so a substring match against a composed string fails silently on every accented
title. Fold before comparing.

**The docx has bold markers inside italic spans.** `*Cajas de **cartón*`.
`parse_list.py` reads the docx through python-docx and takes italics from run
properties.

**The venv is Homebrew's Python 3.13** since 22 September, built from
`pipeline/requirements.txt`, whose header gives the two commands. Scripts keep
`from __future__ import annotations` first; it does no harm. The old 3.9 venv
is at `~/scriptorium-venv-py39` until deleted.

**`npm i` walks up the tree.** Run where there is no `package.json`, it
installs into the nearest ancestor that has one.

**Changing ranges or an offset leaves chunks on the old numbers** until the
work is named in `load_chunks` (§1).

**The grouped offsets query misleads when runs overlap** (`PAGE-NUMBERS.md` §1).

**`--pending` picks works held back only by agreement** (§1).

**The batch log's name is literal**: `/tmp/scriptorium-batch-N.log`, the `N`
unexpanded, so each batch overwrites the last. Rename it per batch.
