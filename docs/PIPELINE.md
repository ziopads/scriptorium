# The corpus pipeline

**Version:** 0.1
**Date:** 2026-09-13
**Scope:** How files on disk become rows in the database. The application is in
`ARCHITECTURE.md`; what it has to do is in `REQUIREMENTS.md`.

---

## Changelog

- **0.1** (2026-09-13) — Written after the seeding session. Records the script
  order, the decisions embedded in each, and the traps that cost real time.

---

## 1. State

The database holds **160 works** across five lists and 25 sections, seeded from
the October 2026 reading list. Of 125 examinable works, **95 have a file** and
30 do not. **56 works carry a verified `page_offset`**; ten more have a
best-guess offset recorded in `notes_internal` and left at zero.

The application is deployed and reads all of this. Nothing has been extracted,
chunked, or embedded yet.

## 2. The scripts, in order

Everything runs from the repo root with `pipeline/.venv` active. Each script
reads files and writes files; none writes to the database.

```bash
source pipeline/.venv/bin/activate

python3 pipeline/parse_list.py "$HOME/Desktop/Lists_Zazil Collins_Octubre 2026.docx"
python3 pipeline/check_pdf.py pipeline/corpus --quiet
python3 pipeline/match_corpus.py --show-scores
python3 pipeline/make_seed.py
# then paste db/seed.sql into the Neon SQL editor
```

| Script | Reads | Writes |
|---|---|---|
| `parse_list.py` | the reading-list docx | `list.csv` |
| `check_pdf.py` | `corpus/*.pdf` | `citability.csv` |
| `match_corpus.py` | `list.csv`, `overrides.csv`, `corpus/` | `matches.csv` |
| `make_seed.py` | `list.csv`, `matches.csv`, `citability.csv` | `db/seed.sql` |
| `triage.py` | `corpus/` | `triage.csv` — text-layer survey |
| `isbns.py` | `corpus/` | `isbns.csv` — not currently used by the seed |
| `enrich.py` | `list.csv` | `catalogue.csv` — abandoned, see §5 |
| `extract.py` | `mapping.csv`, `corpus/` | `pages/*.json` — **broken, see §5** |
| `offsets.py` | `pages/*.json` | proposals on stdout |

`seed.sql` is entirely upserts. Re-running it corrects rows in place; it does
not need a truncate, and it does not touch notes or anchors.

## 3. The two files maintained by hand

**`overrides.csv`** binds a list title to a filename when the matcher cannot.
Cross-language editions score zero on title tokens — *Specters of Marx* against
*Espectros de Marx* — and no threshold fixes that. An override always wins.

> Never record a negative. A blank `filename_contains` asserts "not held", and
> a line saying Don Chipote was not held survived the arrival of Don Chipote
> and suppressed the file. Absence is what the matcher concludes when it finds
> nothing, and it is the fact most likely to change.

**`make_seed.py`'s tables** — `SPLITS`, `CONTAINERS`, `EMPTY_SECTIONS`. Keyed by
work id and verified at run time, because ids derive from titles and have moved
once already.

## 4. Decisions worth not relitigating

**Work ids are permanent.** Derived from author and title in `parse_list.py`.
Notes anchor to them, chunks reference them, they appear in URLs.

**Citability is not the file extension.** `check_pdf.py` decides it, and the
decisive test is printed folios at a non-zero offset: that is what it means for
a file's pages to correspond to a published edition. Producer metadata is
circumstantial — calibre is often used to strip DRM without touching pagination,
and macOS stamps Quartz PDFContext on anything re-saved through Preview.

**An offset is only seeded on strong evidence** — 70% agreement across at least
a quarter of the pages. The checker accepts weaker runs, which is right for
"is this book paginated at all" and wrong for "what is its offset". A missing
page number is visibly incomplete; a wrong one is not.

**A positive offset means an excerpt.** The file begins partway into the book.
`Indan given` at +65 starts at printed page 66.

**Partial and unusable copies are seeded as not held**, with a note saying what
exists. A catalogue claiming she has Gerhard when there are 28 pages of it is
worse than one saying she has nothing.

**Examinable is derived, never stored** — from list membership, including a
container's. See the `examinable_works` view.

## 5. Known broken and unfinished

**`extract.py` and `offsets.py` read `mapping.csv`**, which is dead. It was
superseded by `matches.csv` and its ids belong to the old 85-work list. Both
need repointing before anything can be extracted. `extract.py` should also take
`page_offset` from the database rather than from a CSV column that no longer
exists.

**Enrichment is abandoned.** Open Library rate-limits to roughly one request a
minute, making 156 lookups a two-hour job for data that is a convenience.
65 ISBNs came from filenames. Backfilling the rest is an `UPDATE`, not a reseed.

**Eleven files need OCR** — listed by `check_pdf.py` as `needs OCR`, about 1,080
pages. Run ABBYY with Spanish and English together, export as searchable PDF
(never reflowed), write back into `corpus/` beside the originals. Do not OCR
the whole corpus: most of it has a real text layer, and re-recognising a
born-digital PDF replaces good text with guesses.

**Ten offsets are uncertain** and recorded as such in `notes_internal`.

**`AGENTS.md` and `CLAUDE.md`** are untracked Next.js boilerplate at the repo
root. Delete or write real ones.

## 6. Traps that cost time

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
title. Fold before comparing — `pipeline/match_corpus.py` has the function.

**The docx has bold markers inside italic spans.** `*Cajas de **cartón*`. Any
markdown conversion truncates the title there. `parse_list.py` reads the docx
directly through python-docx and takes italics from run properties instead.

**The venv is Python 3.9.** `int | None` in a signature needs
`from __future__ import annotations` as the first statement.

**`npm i` walks up the tree.** Run in a directory with no `package.json` and it
installs into the nearest ancestor that has one. Two stray `node_modules` were
found this way.
