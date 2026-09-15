# Scriptorium — open work

Raised by James, 14 September 2026, with my reading of each. Nothing here is
decided. Ordered by number as raised; a suggested order of work is at the end.

Working rules stand: understand before proposing; read the source; blank beats
a guess; discussion first.

---

## 1. Batch-select notes and apply a tag

Zazil introduced **Colonial Terror** today and it needs applying retroactively.

Tags live on `notes.tags`. There is no multi-select anywhere in the interface,
and no bulk action of any kind.

The thing to notice is that this is the same mechanism as item 8. One is
selecting rows in the notes list and applying a tag; the other is selecting
rows in the catalogue and applying a rating. Build the selection once — a
checkbox column in the left pane, a count and an action bar when anything is
checked — and both become small.

For finding the notes to tag, the honest answer is that she needs search before
she needs batch tagging: applying a tag to notes you cannot find is not the
bottleneck. So this pairs with item 6.

Shape I would propose: checkboxes in the notes pane, an action bar reading
"7 selected — add tag ▾ / remove tag ▾", a server action taking `(ids[], tag)`.
Tags are a text array, so adding is `array_append` where not already present.
No schema change.

**Cost:** small, once selection exists. **Value:** high and recurring — she
will invent more tags.

---

## 2. Adding a work that is not on the comps list

She is reading, hits a reference worth keeping for the dissertation, and wants
it in the catalogue and attached to the note she is writing.

Most of this exists. `works.standing = 'added'` (migration 003) is exactly this
case, `/works/new` is a stub route, and `/gaps` exists to backfill.

The friction in the request is the phrase "grab the catalogue id". She should
never see an id. The whole point of the workbench is that a note is written by
pointing at things.

Shape I would propose: an "add a work" control in the right pane, beside the
attached-works chips. It opens a small form — author, title, year, and nothing
else required — creates the work with `standing = 'added'` and
`source_format = 'none'`, and attaches it to the note in the same action. Full
bibliographic data is backfilled later from `/gaps` (see item 9), which is
where incomplete records already surface.

The one design question: does a work created this way belong on any exam list?
No. It has no list membership, so it will not carry a code, and the left pane
already shows `standing = 'added'` in place of a code for such rows.

**Cost:** small. **Value:** high — this is a daily action for the next month
and there is currently no way to do it without leaving the workbench.

---

## 3. Creating an axis from the right pane

Correct, and it is a gap rather than a design decision. The right pane composes
a note, or a ficha for an already-selected axis, but a new axis can only be
started from `/axes`, where there is no way to point at works.

Once created, an axis's fichas already work well — select the axis, the right
pane becomes the ficha composer, and the attached works come from clicking rows.
So the missing piece is only the first step: title and thesis.

Shape I would propose: a third mode in the right pane, reached from the same
place the ficha composer is. Title, thesis, attribution. On save it selects the
new axis (`a=<id>`), which puts the pane straight into the ficha composer with
the works she already had attached — so creating an axis and writing its first
ficha is one continuous action.

**Cost:** small. **Value:** high, and it removes the last reason to visit
`/axes`.

---

## 4. Linking a note to an axis

You are not missing anything; the model supports two different versions of this
and the interface exposes neither.

`note_links (from_note, to_note, kind)` takes `bridge`, `contrast`, `answers`.
An axis *is* a note, so a plain note can already link to an axis today at the
database level. That is the weaker relation: "this note bears on that axis."

The stronger relation is promotion: a note that says what a work contributes to
an axis's argument *is* a ficha, and becoming one means acquiring
`parent_id = <axis>`, `kind = 'ficha'`, and a `note_works` row with
`role = 'ficha'`. The handoff already lists "make this an axis" promotion as
step 4; this is its sibling, "make this a ficha of".

Both are worth having and they mean different things. A note can bear on three
axes; it can only be a ficha of one, because a ficha is per (axis, work) and
carries the argument for that axis specifically.

Shape I would propose: on a note under review, two controls — "relates to axis
▾" writing a `note_links` bridge, and "make this a ficha of ▾" doing the
promotion. Both are pick-from-a-list, no ids typed.

Worth noting for the map: `axis_works` derives an axis's membership from its
children only. A `note_links` bridge from a plain note does not make that
note's works part of the axis, which is right — a bridge is a cross-reference,
not membership.

**Cost:** medium (promotion has to move a row between shapes and satisfy the
parent/kind constraints). **Value:** high. This is how the mapa actually
grows.

---

## 5. Human-readable exports

The CSV is a data interchange format and reads like one. What she will want in
October is something she can print, or read on a phone on the way to the exam.

Three that seem worth having:

- **Today** — notes and axes created or updated since a date, in the order she
  wrote them, as Markdown. Answers "what did I do today", which is the thing
  you want at the end of a working day.
- **An axis, whole** — thesis, then each ficha with its work and its
  quotations, then the synthesis, then the exam move. This is her mapa
  rendered back to her, and it is the document she revises from.
- **Everything, by work** — for each examinable work: the passages she has
  anchored in page order, her notes on it, the axes it serves. This is the
  per-work dossier discussed on 14 Sept, in document form rather than as a tab.

Markdown rather than PDF: it prints, it pastes into her dissertation, and it
costs nothing to generate.

**Cost:** small each, once the queries exist — and the queries mostly exist in
`lib/notes.ts` already. **Value:** high in the last three weeks, low now.
Build after the things that change what is *in* the database.

---

## 6. Filtering notes and axes

Agreed, and it gates item 1.

What exists: `/notes` has four fixed queues (proposals, whose claim?, no
passage behind it, open questions) and the left pane shows the most recent 40.
There is no text search over notes at all, and no filter by tag, by work, by
attribution, or by date.

Ranked by what I think she will reach for:

1. **Text** over title, body, and quotation. In memory would do — there are
   dozens of notes, not thousands, and the left pane already filters 160 works
   in memory instantly.
2. **Tag**, which is what makes Colonial Terror useful once applied.
3. **Attribution** — hers, the author's, unclassified.
4. **Work**, which the centre pane's Notes tab already does for one work.
5. **Date**, for item 5's "today".

These compose, so they want to be the same filter row the catalogue pane has
rather than five separate queues.

**Cost:** small if in memory, and in memory is defensible at this size.
**Value:** high, and rising as the notes accumulate.

---

## 7. Backups and disaster recovery

Worth being precise about what would actually hurt, because the answers differ.

**Irreplaceable:** her notes, axes, fichas, quotations, attributions, tags, and
the catalogue itself — `works`, `exam_lists`, `list_sections`, `list_items`,
`notes`, `note_works`, `note_anchors`, `note_links`, `note_revisions`. All of
it is small. The whole lot is probably under 5 MB as SQL.

**Rebuildable, slowly:** `pages` and `chunks`, from `pipeline/pages/*.json`,
which is the durable artifact by design. Are those in git? They should be
checked — if `pipeline/pages/` is gitignored, the "durable artifact" lives on
one laptop, which is the actual exposure.

**Rebuildable, cheaply:** embeddings. 75 seconds and no money, because the free
grant covers the whole corpus several times.

So the plan should be lopsided: protect the first category hard, the second
adequately, the third not at all.

What I would propose:

- **Neon's own point-in-time restore** as the first line. It needs no work; it
  needs checking what the retention window is on the current plan. If it is
  seven days, that covers the accident-you-notice-immediately case, which is
  most of them.
- **A nightly logical dump of the work-product tables only**, `pg_dump
  --data-only --table=...`, run by a **GitHub Actions scheduled workflow**
  rather than cron on the laptop. A cron job on a machine that is asleep at
  3 a.m. is not a backup. Actions runs whether or not anyone is awake, has the
  Neon connection string as a secret already if you add it, and can commit the
  dump to a private repo — which gives you version history over the backups for
  free, and a copy on GitHub's infrastructure rather than Neon's.
- **A weekly full dump** including `pages`, to a second destination (R2 is
  already in the stack).
- **Restore drill.** A backup nobody has restored is a hypothesis. Once, before
  October, restore last night's dump into a Neon branch and open the app
  against it. This is the step everyone skips and it is the only one that
  proves the rest.

The failure I would actually worry about is not Neon losing data; it is a bad
migration or a careless `delete` three days before the exam. Point-in-time
restore covers that better than nightly dumps do, which is why it is first.

**Cost:** half a day including the drill. **Value:** low until the day it is
total. Do it early, while it is cheap to think about.

---

## 8. Stars on catalogue items

Yes, and the batch-select from item 1 is most of the work.

`works` already carries `purpose` and `standing`, which characterise a work's
*role* — why it is on the list, and whether it is assigned or added. Importance
is a third axis and does not fit either, so this wants its own column:
`priority smallint` (0–5), nullable, defaulted to null rather than zero so that
"not yet rated" and "rated low" stay distinguishable.

Then: a star control on the catalogue row and the work record, a filter button
beside the list filters ("★5", "★4+"), and batch-apply from the selection.

The workflow she described — go down a list characterising, then filter — is
exactly the batch-select case, and it argues for building selection in the
catalogue pane first and the notes pane second.

One thought: sorting by priority in the left pane would put the dozen at the
top, which is probably where she wants them for the next month.

**Cost:** small (one column, one control) plus the shared selection work.
**Value:** high, and it shapes how she spends the remaining weeks.

---

## 9. ISBNs and citation backfill

`pipeline/isbns.py` and `pipeline/enrich.py` already exist and I have not read
them, so the plan should start by reading those rather than by designing
something new. `pipeline/citability.csv`, `triage.csv`, `viability.csv` and
`overrides.csv` suggest a good deal of this ground has been walked already.

What is known: `incompleteWorks()` in `lib/works.ts` computes what is missing
for a citation — author or editor, publisher, place, year — judging an essay on
its container's imprint rather than its own. `/gaps` surfaces the result. So
the diagnosis exists and the question is only how the values get in.

The sources, in order of trust: the book's own copyright page, which for the
five extracted books is now in `pages` and searchable; the ISBN, via Open
Library or the Library of Congress; and hand entry from the PDF.

The shape that seems right: `enrich.py` proposes, `/gaps` disposes. A script
that fetches by ISBN and writes *proposals* she confirms, rather than writing
straight to `works`, keeps the same review discipline the notes have. A wrong
publisher in a citation is the kind of error an examiner notices.

**Next step:** read `isbns.py` and `enrich.py` and report what they already do.
Cheap, and it decides the rest.

---

## 10. The `+` button drops the selected work — confirmed bug

Reproduced in the source. In `components/workbench/left-pane.tsx` the `+` link
builds the new attachment list from `attached(params)`, which reads `ws` from
the URL. When nothing has been explicitly attached, `ws` is empty — the
selected work is attached *implicitly*, in `right-pane.tsx`:

```ts
const ids = ws.length > 0 ? ws : params.w ? [params.w] : [];
```

So the first `+` writes `ws=<other work>`, `ws` is no longer empty, and the
implicit fallback stops applying. The selected work vanishes.

Fix: seed from the effective list rather than the raw one — where `ws` is
empty and `params.w` is set, start from `[params.w]`. One expression in
`left-pane.tsx`.

Order matters when fixing it. `NoteForm` treats the **first** attached work as
the one carrying the quotation anchor, and shows "quote in …" against it, so
the selected work must stay first.

**Cost:** minutes. **Value:** removes daily friction. Do this first.

---

## 11. The CSV — sort order, kinds, axes

Read `app/api/export/notes/route.ts` alongside this.

**Rows are relations, not notes.** One row per note-to-work relation, so a note
touching three works is three rows, deliberately — "a note that touches two
works is a connection, and flattening it to one row would hide the second half
of the thought". A note touching nothing still gets one row with empty work
columns. `relations_in_note` tells you how many rows a note spans and
`also_touching` names the others.

**The `kind` column is not `notes.kind`.** The database constrains
`notes.kind` to six values: `note`, `question`, `ficha`, `axis`, `synthesis`,
`exam_move`. The export writes a different thing into that column — for a
top-level note it writes `notes.kind`, but for an axis tree it writes the
*part*: `thesis`, `ficha`, `synthesis`, `exam_move`. So an axis appears with
kind `thesis` and the value `axis` never appears in the file at all. That is
the confusion. Either rename the column to `part` or emit both.

**The `axis` column** holds the axis's title, and is filled only for rows
belonging to an axis tree. A plain note that merely references an axis has
nothing here, because no such link is exposed yet (item 4).

**The `role` column** is `note_works.role`: `about` for a plain note on a whole
work, `ficha`, `yield` for a work named in a synthesis without a ficha of its
own, and `supports` / `disputes` set by accepting a proposal. `applies` and
`introduces` are reserved and unused. `relation` distinguishes `passage` (a
quotation with a folio, from `note_anchors`) from `work` (argument-level, from
`note_works`).

**Sort order** is whatever `listAllNotes()` returns, then exploded per
relation. I have not read that function, so I cannot say what it orders by —
but an export with an unexplained order is a defect regardless. It should sort
explicitly and say so in the comment: axes and their parts together in axis
order, then loose notes by date, is my guess at what she wants.

**Cost:** small. **Value:** the file is currently hard to trust, and an export
you do not trust is not a backup either (see item 7).

---

## 12. Making the mass of notes useful for the exams

The most important item here and the least defined, so this is thinking rather
than a proposal.

What the exam actually demands is different from what the notes currently
support. The notes are a record of reading. The exam is a performance under
questioning, and the dissertation is an argument. Three different uses of the
same material.

**For the written exam** the useful object is the axis: a thesis, the works
that support it, and the passages behind them. That machinery exists; what is
missing is the ability to read it whole (item 5) and to see where it is thin.

**For the oral** the useful object is a *question*, not a note. The mapa
already ends with "Cómo se enlazan los ejes" and an exam order (5 → 3 → 4 →
1/2/6 → 7), which is her own answer to "what will they ask and in what order".
Nothing in the app holds that.

Things I think would earn their place, roughly in order of value per unit of
work:

- **A coverage matrix.** Examinable works down one side, the seven axes across
  the top. What it shows is the empty rows: works on her list that appear in no
  axis at all. Those are the works an examiner can open on and she has nothing
  prepared. This is one query over `axis_works` and `examinable_works` and it
  answers the most frightening question she has.

- **Gaps, per axis.** Which fichas cite no passage; which claims are attributed
  to an author with no quotation behind them (`unsupported_claims` computes
  this already); which axes have no exam move written. A checklist that shrinks
  is worth a great deal in September.

- **The quotation book.** Every anchored passage, by work, in page order, with
  her translation and her gloss. This is the oldest scholarly instrument there
  is and it is the thing to reread the night before. It needs no new data.

- **Rehearsal against her own record.** Once the MCP server exists, Claude asks
  a question on an axis, she answers in prose, and Claude checks what she said
  against her notes — flagging a claim she has attributed to Adorno that Adorno
  does not make, a work she cited that is not on that axis, a quotation she
  half-remembered. This is the one thing here that no notebook can do, and it
  uses the attribution column for the purpose it was built for. It is also the
  one most likely to be annoying if done badly, so it should be strictly
  checking-against-the-record rather than examining her.

- **The bipartite map**, already planned. Its value is spotting the work that
  sits in four axes (load-bearing, must be known cold) and the axis resting on
  a single work (fragile).

- **Spaced review** over quotations. I am least sure about this one. It is a
  memorisation tool and comps is not a memorisation exam, but there are a dozen
  passages she will want verbatim.

What I would *not* build: anything that generates prose she might read instead
of her own notes. The value of this system is that everything in it is either
hers or marked as not hers.

---

## 13. Anthologies, essays, and the PDFs we have

Nothing about the PDFs has to change, which is the useful part of the answer.
Pages load per file and belong to the container work; a child essay never gets
pages of its own and never needs them. What it gets is a page range into its
container. So this is a catalogue and interface question, not an extraction
one, and no re-extraction is implied.

**What exists.** `works.container_id`, `first_page`, `last_page` are in the
schema. `getWorkWithContainer()` and `listContents()` are in `lib/works.ts` and
the centre pane already lists a container's contents. `formatBibliography`
renders "in <container>" and judges an essay's missing imprint against its
container rather than itself. The model is built; it is unpopulated.

**What decides child work versus section.** Item 8's discussion of chapters
proposed a `sections` table rather than child `works` rows. Both are right, for
different things, and the criterion is citability:

- **Separately citable → child work.** An essay in an edited volume with its own
  author. Also a tale in Rael or Anaya or Vigil: she would cite "Doña
  Sebastiana," in *Cuentos españoles*, so the tale needs a bibliographic
  identity even though its author is the collector. It can bear notes, appear
  in an axis, and carry a ficha of its own.
- **An internal division of a single-author book → section.** Adorno's chapters
  are navigation and search scope. Nobody cites "chapter 7" as a work.

The test is whether the unit gets its own line in a bibliography. That resolves
both questions with one rule and keeps four hundred chapter rows out of a
160-work catalogue while letting the tales in, which is where she actually
works.

**Where the page ranges come from.** The chapter map built on 14 September.
Flores-Masera's outline gave 125 hierarchical entries; that *is* its table of
contents. Anaya's tales came only from the withdrawn source, and its running
heads fall below `CHAPTER_HEAD_MIN` because each tale runs under eight pages —
so lowering that threshold for short-section books, already noted as open, is
what unlocks the anthologies specifically. Rael has neither outline nor usable
heads and would be hand-entered from its printed contents, or re-OCR'd first.

**How they get created.** Not automatically. The same discipline as everywhere
else: the chapter map proposes, she confirms. A loader reads `chapters` from
the extract, matches against the printed contents, and produces candidate child
works — title, `container_id`, `first_page`, `last_page`, author inherited from
the container unless the volume is edited. She accepts or edits them in a list.
For a 125-entry volume this is the only tolerable way, and for a five-essay
reader hand entry through item 2's add-a-work form is faster than building
anything.

**The one mechanism this needs.** Given a container and a printed page, which
child work contains it. One function, three callers:

- **Preview.** A child work has no pages, so `pageBounds` returns null and the
  tab says "no text" — the fallback flagged on 14 Sept and deferred. It should
  read the container's pages clamped to `first_page`–`last_page`, opening at
  `first_page`, with the container named in the header.
- **Quotation capture.** She is reading the container at page 47 and selects a
  passage. The anchor should attach to the tale, not the collection, because
  that is what she is writing about and what the citation must name. Resolving
  the range does this without her choosing anything.
- **Search.** Chunks are stored against the container, so a hit reports the
  anthology. Resolving the range at display time reports the essay, which is
  the answer she needs. This can be a view over `chunks` joined to child works
  on `start_page between first_page and last_page`.

That third one also gives `chunks.section_type` something to key on for
single-author books, so the section work and the essay work share a query.

**Also unresolved:** whether a child essay is examinable. If a list names the
essay, it is, and it carries a code; if the list names the anthology and she
adds the essay herself, it is `standing = 'added'` and appears in the catalogue
without a code. Both should work today — worth confirming against
`examinable_works` before creating any.

**Cost:** the range-resolution function and the Preview fallback are small. The
bulk-proposal loader is medium and only pays for itself on the large volumes.
**Value:** high for the folktale collections, which are objects of study rather
than reference works, and where the tale is the unit she argues about.

---

## A suggested order

Before anything else: **10** (minutes, daily friction), then **2** and **3**
(both small, both unblock daily work).

Then **7**, early and while cheap, because its value is insurance.

Then the selection mechanism, and with it **8** and **1** — in that order,
because rating the catalogue shapes how she spends the weeks, and because the
catalogue pane is the simpler place to build selection first.

Then **6**, then **4**.

**9** starts with reading two scripts, so it can happen any time.

**5** and the first two items of **12** — the coverage matrix and the gaps
checklist — belong to late September, when there is enough in the database for
them to say something. The MCP server comes before them regardless, because
rehearsal and the dossier both depend on it.

**11** is a half-hour of tidying whenever the export next matters.

**13** splits: the range-resolution function and the Preview fallback go with
the MCP server work, since search needs the same resolution. Creating the child
works themselves waits on deciding which volumes actually need them — probably
Rael, Anaya, and Vigil, where the tales are the objects of study.
