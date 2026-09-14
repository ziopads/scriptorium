# Scriptorium — entity-relationship diagram

**Version:** 0.1
**Date:** 2026-09-13
**Scope:** The notes graph as decided in the 13 September design conversation
and realised in `db/005-notes-graph.sql`. The catalogue side is unchanged from
migration 004. GitHub renders the Mermaid block below; VS Code does with the
Mermaid extension.

---

## The shape in one sentence

Two kinds of node, `works` and `notes`, and three kinds of edge between them:
`note_works` (a note argues about a whole work), `note_anchors` (a note quotes
a passage of a work), and `note_links` (a note refers to another note). An
axis is a note whose parts are child notes; a ficha is one of those parts.

```mermaid
erDiagram
  EXAM_LISTS ||--o{ LIST_SECTIONS : has
  LIST_SECTIONS ||--o{ LIST_ITEMS : orders
  WORKS ||--o{ LIST_ITEMS : appears_as
  WORKS o|--o{ WORKS : contains
  NOTES o|--o{ NOTES : parent_of
  NOTES ||--o{ NOTE_WORKS : argues_about
  WORKS ||--o{ NOTE_WORKS : is_argued_about
  NOTES ||--o{ NOTE_ANCHORS : quotes
  WORKS ||--o{ NOTE_ANCHORS : is_quoted
  NOTES ||--o{ NOTE_LINKS : from
  NOTES ||--o{ NOTE_LINKS : to
  NOTES ||--o{ NOTE_REVISIONS : superseded_by
  WORKS ||--o{ CHUNKS : searchable_as

  WORKS {
    text id PK
    text title
    text author
    text kind
    text container_id FK
    int page_offset
    text purpose
    text standing
  }
  EXAM_LISTS {
    text id PK
    text name
    int sort
    bool examinable
  }
  LIST_SECTIONS {
    text id PK
    text list_id FK
    text letter
    text kind
    int sort
  }
  LIST_ITEMS {
    text list_id FK
    text work_id FK
    text section_id FK
    int ordinal
  }
  NOTES {
    bigint id PK
    text kind
    bigint parent_id FK
    int ordinal
    text title
    text body
    text attribution
    text attributed_to
    text origin
    bool reviewed
    timestamp rejected_at
    text_array tags
  }
  NOTE_WORKS {
    bigint note_id FK
    text work_id FK
    text role
    int ordinal
  }
  NOTE_ANCHORS {
    bigint note_id FK
    int ordinal
    text work_id FK
    int printed_page
    text quote
    text translation
  }
  NOTE_LINKS {
    bigint from_note FK
    bigint to_note FK
    text kind
  }
  NOTE_REVISIONS {
    bigint id PK
    bigint note_id FK
    text body
    text attribution
    text origin
    bool reviewed
  }
  CHUNKS {
    bigint id PK
    text work_id FK
    int start_page
    text text
    vector embedding
  }
```

## Legend

| Table | Node or edge | What a row is |
|---|---|---|
| `works` | node | One monograph, essay, poem, film, or recording in the catalogue |
| `notes` | node | One thing she wrote: a note, question, ficha, axis, or a part of an axis |
| `note_works` | edge | Note → work, argument-level: this note is about this whole work, in this `role` |
| `note_anchors` | edge | Note → passage: this note quotes this page of this work, with her translation |
| `note_links` | edge | Note → note: bridge, contrast, answers |
| `note_revisions` | history | The state of a note before each edit |
| `list_*` | catalogue | Her department's reading list, from which `[I.A.3]` is derived |
| `chunks` | index | Extracted text, for search; never anchored to |

## Vocabularies

`notes.kind` — `note`, `question`, `ficha`, `axis`, `synthesis`, `exam_move`.
The last two are parts of an axis and are never named to her.

`notes.attribution` — `author`, `own`, `other`; null means not yet classified,
and null is never defaulted.

`notes.origin` — `human`, `assistant`. Survives review.

`note_works.role` — `about`, `ficha`, `yield`, `supports`, `disputes`,
`applies`, `introduces`. The first three are set by the form (`about` is a
plain note on a whole work, with no page and no quote); `supports` and
`disputes` by accepting a proposal; the last two are reserved.

`notes.rejected_at` — set when she rejects a proposal. Hidden everywhere
except the rejected list, from which it can be reconsidered; never deleted.

`note_links.kind` — `bridge`, `contrast`, `answers`.

## Prior art, in one line each

Web Annotation Data Model (body, target, selector, motivation) for anchors and
kinds; TEI `@resp` and PROV for the origin/attribution split; Toulmin for the
axis (claim, grounds, warrant); CiTO for `note_works.role`; IBIS for questions
that get answered without being erased; Zettelkasten structure notes for the
axis as a note over notes; hypergraph incidence form for the membership table.
