# Page numbers

**Version:** 0.3
**Date:** 2026-09-23
**Scope:** How a passage gets its printed page number, how a file whose
numbering breaks is described, what it means to accept a file's pagination, and
where the app marks a page number as unverified. The batch that feeds all of
this is in `PIPELINE.md`.

---

## Changelog

- **0.3** (2026-09-23) — The MCP server treats an accepted work as citable and
  reports how far its page numbers can be trusted (§3).
- **0.2** (2026-09-23) — The notes export carries the marker (§3).
- **0.1** (2026-09-23) — First version.

---

A citation's page is the printed page. The pipeline stores only the file page
(`pages.page_index`, counted from 1 across all of a work's files). The printed
page is computed by the `printed_pages` view:

- where a `page_offsets` range contains the page, `page_index +` that range's
  offset;
- elsewhere, `page_index + works.page_offset`.

Nothing stores the result. Sections, chunks and note anchors copy it when they
are loaded or written, and keep the copy.

## 1. Ranges

### When a work needs them

`offsets.py` reports "N numbering sequences… Enter page_offsets ranges" when
the folios imply more than one offset over long runs. The causes are ordinary:
plates, unscanned blanks, part-title leaves, roman front matter running into
arabic. The Gaps page lists these under **Ranges needed**. It picks them by
matching the problem text against `numbering sequences` or
`page_offsets ranges disagree`, so rewording those messages in `offsets.py`
moves works between tabs.

### The table

`page_offsets (work_id, from_page, to_page, page_offset, note)`, pages being
file pages, inclusive. The database refuses:

- `from_page` below 1;
- `to_page` before `from_page`;
- two ranges of one work claiming the same page (an exclusion constraint).

Pages outside every range fall back to `works.page_offset`. By convention the
last range ends at 9999.

Nothing in the app or pipeline writes this table: ranges are entered with
`insert` in the Neon SQL editor. `backup.py` includes it; take a backup after
entering ranges.

### Deriving the ranges

**1.** The grouped query from migration 008 gives each offset and its span:

```sql
select folio - page_index as implied,
       min(page_index) as from_page, max(page_index) as to_page, count(*)
from pages
where work_id = '…' and folio is not null
group by implied having count(*) > 5 order by from_page;
```

**2. When the spans overlap, that query is lying to you.** It reports the
minimum and maximum page for each offset value across the whole book, so:

- **Stragglers**: a few folios near a boundary that imply the neighbour's offset
  stretch that group past the boundary, and one boundary looks like two ranges
  covering the same pages.
- **Recurring offsets**: an offset that returns later in the book is merged into
  one group spanning everything between. Lotman returns to +6 at file pages
  356–358, after runs at +7 and +8.

`having count(*) > 5` also hides short runs, where boundaries resting on few
folios disappear. Moraña's boundary near file page 457 rests on a single folio.

When the spans overlap, read the folios in page order:

```sql
select page_index, folio, folio - page_index as implied
from pages where work_id = '…' and folio is not null order by page_index;
```

**3.** Extend each range forward through the unnumbered leaves to where the
next begins, so the spans tile. The last range ends at 9999.

**4.** `offsets.py <id>` without `--apply` to check; then with `--apply`; then
name the work in `load_sections`, `load_chunks` and `embed`. Chunks carry the
page numbers they were loaded with, so skipping `load_chunks` leaves every
chunk on its old numbers.

### Blanks, gaps and duplicate leaves

**A scanned blank, plate or part title** carries no folio. It belongs to the
range before it, and nothing contradicts that. Pages under 50 characters never
start or end a chunk, so these leaves are never cited.

**An unscanned blank** is absent from the file, and every later folio moves one
step: the offset rises by 1 there and a new range starts. Lotman steps +4, +5,
+6, +7, +8 at printed 68, 78, 248 and 358.

**A printed page missing from the file** looks the same and is handled the
same. The page has no row in `printed_pages`; a lookup by that number finds
nothing. Derrida's *Mal de archivo* lacks printed page 23.

**A leaf scanned twice** is handled by a range at a lower offset over the
repeat, so two file pages resolve to one printed page: Lotman's file pages
356–358 are a second scan of printed 362–363, at +6; *Mal de archivo*'s file
pages 92–93 repeat 90–91 (printed 98–99). `printed_page` is therefore not unique
within a work. `read_pages` in the MCP server returns both copies in file
order, and the passage appears twice in the chunks, so search can return it
twice.

**Flores** shows a pattern to expect near a book's end: blanks omitted one at a
time from file page 276, the offset climbing +9, +10, +11, +12, +13, a range
each.

## 2. Accepting a file's pagination

Some files `offsets.py` cannot settle and never will: a file that prints no
numbers (a calibre conversion of an ebook), which has no folios and stops at
"too few"; and a bad scan that prints numbers that cannot be read. Unaccepted,
either stays blocked (`PIPELINE.md` §2) and never reaches search or a study
aid.

**Accepting** records a person's decision that the file is usable as it stands:

- `works.pagination_accepted_at` (migration 016): when. Null means not
  accepted.
- `works.pagination_basis` (migration 017): why.
  - `hand_set`: the numbering was reviewed by a person, outside the normal
    pipeline, and its anomalies resolved — by overriding the offset, or by
    entering `page_offsets` ranges, the larger intervention. Page numbers are
    shown unmarked.
  - `none_printed`: the file prints no page numbers. The page shown is the
    file's own, and it is marked.

**Acceptance leaves `offset_problem` alone.** The problem is the evidence;
acceptance is a judgement recorded beside it, and it takes precedence.
`offsets.py` rewrites the problem on every run as before. Blocked means a
problem and no acceptance, so accepting unblocks without clearing anything.

### Where it is set

Gaps → Page numbers (`setPaginationAccepted` in `lib/works.ts`). The tab lists
every work with an `offset_problem` in four groups — **Ranges needed**, **No
usable numbers**, **Accepted as they are**, **Loaded, never checked** — each row
showing how many folios were read out of how many pages, which is what separates
a file that prints nothing (none read) from a bad scan (a few read).

- Each row shows both bases, always in the same order: the one in force boxed
  and inert, the other a button.
- On a row not yet accepted, choosing a basis accepts it.
- **Withdraw** clears both columns.

A `hand_set` offset is typed on the work's Edit page (`works.page_offset`);
`hand_set` ranges are entered as in §1.

### What clears it

- `load_pages.py` sets `pagination_accepted_at` to null whenever it replaces a
  work's pages: a new extraction is new evidence, and the decision was made
  about the old one. It leaves `pagination_basis` as it was.
- Withdraw clears both.
- Nothing else. A later `offsets.py` verdict of confirmed or corrected clears
  `offset_problem` and leaves the acceptance in place. That is intended: the
  work page keeps its caveat, because the acceptance is the recorded decision.

### The backfill

Migration 017 classified the eleven works accepted under 016 by stored offset:
non-zero `hand_set`, zero `none_printed`. That was an inference about intent,
so the Gaps tab shows the basis on every accepted row.

## 3. The unverified-page marker

`components/page-number.tsx` renders a printed page with an asterisk right after
it, placed to survive a paste into a draft, with the explanation on hover:
"Page number unverified… Check it against the PDF before citing."

**The rule** is `unverifiedPages()` in `lib/works.ts`, computed once per
request. A work is marked when `offset_problem` is set and `pagination_basis` is
anything but `hand_set` (null counts as marked, the cautious default).
Acceptance does not enter the rule, so an unaccepted work with a problem is
marked wherever its pages appear — in a note written before the book was
loaded, for example.

**The work page** carries one paragraph for any accepted work. For `hand_set`
it says the offset was read from one page and applied to the whole book; for
`none_printed` it says the numbers are the file's own and a citation needs a
printed copy.

**Works cited is deliberately unmarked**: an essay's page range there is typed
from the edition into `first_page` and `last_page`, not derived from the file.

### Where the marker appears

In `note-card.tsx` and `claim-card.tsx`, and in the notes export
(`app/api/export/notes/route.ts`), which applies the same rule twice:

- an asterisk after the page inside `citation` (`…, 45*.`). It is added after
  `plain()`, which strips every asterisk, by finding the ending `formatNote`
  writes (`, {page}.`); a citation that does not end that way is left
  unmarked;
- a column `page_verified`: `no` for a marked work, `hand set` for
  `pagination_basis = 'hand_set'`, `yes` otherwise, empty on rows with no page.
  `yes` means only that the app does not mark the work; a work loaded but never
  checked reads `yes` too.

These read printed pages without `PageNumber`, and show them unmarked:

- the preview reader, `app/works/[id]/preview/page.tsx`;
- the workbench, `components/workbench/center-pane.tsx` and `page-view.tsx`;
- the note form, `components/note-form.tsx`.

### The MCP server

`pipeline/mcp_server.py` follows the same decisions. `citable()` refuses a
work never checked, or one whose `offset_problem` is set and not accepted; an
accepted work is citable, so `draft_note` can quote it. `read_pages`,
`find_quotation` and `search` return `page_numbers`, by the app's rule:

| `page_numbers` | When |
|---|---|
| `unverified: the file's own page, not the edition's` | a problem, accepted, basis not `hand_set` |
| `unverified: numbering unsettled` | a problem, not accepted |
| `hand set` | basis `hand_set` |
| `verified` | checked, no problem |
| `unchecked` | never checked |

`find_works` and `search` also report `numbering`: `accepted (hand set)`,
`accepted (no printed numbers)`, `problem: …`, `checked` or `unchecked`.
`read_pages` still labels each page `printed`, `computed`, `front matter` or
`warning` from its folio, which is evidence about that page, independent of the
basis.

`UnverifiedPagesNote`, the one-line explanation meant for the foot of any sheet
showing a marked page, is written and placed nowhere.

## 4. Decided, not yet built

- **The work page chooses its `hand_set` paragraph by whether the work has
  ranges.** The present text ("read from one page… applied to the whole book")
  is wrong for Derrida's *Mal de archivo*, which is `hand_set` on ranges. A
  count of the work's `page_offsets` rows picks between an offset paragraph and
  a ranges paragraph; no new stored state.
