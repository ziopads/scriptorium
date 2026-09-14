#!/usr/bin/env python3
"""Generate db/seed.sql from the parsed list and the corpus match.

    python3 pipeline/make_seed.py

Reads pipeline/list.csv and pipeline/matches.csv. Writes db/seed.sql — one
transaction, reviewable before it runs. Writes nothing to the database.

WHAT IT EMITS
    exam_lists      five, with examinable false on the two working lists
    list_sections   the department's ordering, including the empty section
    works           one row per item, plus containers and split entries
    list_items      placement, with section and ordinal

DECISIONS BAKED IN HERE, EACH WITH ITS REASON

    Ids are permanent. They come from parse_list.py and are derived from author
    and title. Notes anchor to them and they appear in URLs.

    Examinable is not stored. It is derived by the examinable_works view from
    list membership, including membership of a container. A stored flag would
    drift the first time an item moved between lists.

    Partial and unusable copies are seeded as source_format 'none' with a note
    saying what exists. A catalogue that claims she has a book she has 28 pages
    of is worse than one that says she has nothing.

    EPUB and similar are seeded with their real format. They are searchable and
    not citable to a page; the interface says so at the point of use.
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

PIPELINE = Path(__file__).parent
LIST = PIPELINE / "list.csv"
MATCHES = PIPELINE / "matches.csv"
CITABILITY = PIPELINE / "citability.csv"
OUT = PIPELINE.parent / "db" / "seed.sql"

LISTS = [
    ("theory", "I. Theory", "Lista I — teoría", True, 1),
    ("dissertation", "II. Dissertation", "Lista II — tesis", True, 2),
    ("teaching", "III. Teaching", "Lista III — docencia, siglo XX", True, 3),
    ("working-bibliography", "Working bibliography",
     "Chapter-level research. Not examinable.", False, 4),
    ("filmography", "Working filmography", "Not examinable.", False, 5),
]

FORMAT = {
    ".pdf": "pdf_text",     # corrected per file by triage.py later
    ".epub": "epub",
    ".azw3": "epub",
    ".lcpdf": "none",
    ".zip": "none",
    ".txt": "none",
}

# An entry naming two works becomes two rows.
#
# The third element says whether the held file contains BOTH works. The Rulfo
# volume really is "Pedro Páramo ; y El llano en llamas", so the second work
# inherits the file and its offset. Cajas de cartón and Senderos fronterizos are
# separate volumes that the list names in one entry, so the second must not
# inherit — doing so had Senderos fronterizos claiming to be held, with a page
# offset, pointing at a different book.
#
# La Chrisx's "La loca de la raza cósmica" is deliberately absent. It reads like
# a split of the Corky González entry, but the document gives it its own line,
# so the parser already produces it — adding it here made it twice.
#
# Keys are verified against list.csv at run time. An id that has drifted is a
# silent no-op otherwise, and these ids have already changed once.
SPLITS = {
    "rulfo-el-llano-en-llamas-1955": [
        ("Pedro Páramo", "rulfo-pedro-paramo-1955", True),
    ],
    "jimenez-cajas-de-carton-2002": [
        ("Senderos fronterizos", "jimenez-senderos-fronterizos-2002", False),
    ],
}

# Essays cite through the volume that holds them: title and page range from the
# child, imprint from the parent. The container is a work with no list
# membership, so it is not examinable in its own right.
CONTAINERS = {
    "freud-el-malestar-en-la-cultura-1978": {
        "id": "freud-obras-completas",
        "title": "Obras completas",
        "author": "Freud, Sigmund",
        "kind": "edited_volume",
        "translator": "Etcheverry, José Luis",
        "publisher": "Amorrortu",
        "place": "Buenos Aires",
        "year": 1979,
    },
    "lacan-escritos-1-2012": {
        "id": "lacan-escritos-1-volume",
        "title": "Escritos 1",
        "author": "Lacan, Jacques",
        "kind": "edited_volume",
        "translator": "Segovia, Tomás",
        "publisher": "Siglo XXI",
        "place": "México",
        "year": 2009,
    },
}

# Sections that appear in the document with no items under them. They cannot be
# derived from the rows, because there are no rows — and the fact that her
# department carved out a category and left it unfilled is information. This is
# the case list_sections was made a table for; deriving sections from items
# alone silently dropped it.
EMPTY_SECTIONS = [
    ("dissertation", "I", "Textual Interpretation and Narrative Transculturation"),
]

# Works whose file cannot support a page citation.
#
# No longer maintained by hand. check_pdf.py writes pipeline/citability.csv and
# this reads it, so the catalogue's marker and the seeded page_offset both stay
# true as copies are replaced. Editing a dict here is what let a calibre
# conversion of Herrera sit in the catalogue with a citable tick.
#
# The verdicts map as follows:
#
#   citable / probably citable   pdf_text, with the detected page_offset
#   NOT citable                  epub — searchable, no page a reader can follow
#   needs OCR                    none, with a note. A scan with no text layer
#                                cannot be searched or cited, so recording it as
#                                held would hide a real gap.
#   check by hand                pdf_text with offset 0 and a note. Assume the
#                                book is what it looks like; the note says the
#                                pagination was not confirmed.


def read_citability() -> dict[str, dict]:
    if not CITABILITY.exists():
        print(f"  ! {CITABILITY} not found — run check_pdf.py first.")
        print("    Seeding without it: every PDF will be treated as citable.")
        return {}
    with CITABILITY.open(encoding="utf-8") as handle:
        return {r["filename"]: r for r in csv.DictReader(handle)}


# Files that exist but do not count as holding the work.
PARTIAL_NOTE = (
    "A partial copy is in the corpus but is not usable: {why}. "
    "Seeded as not held so the gap stays visible."
)


def q(v) -> str:
    if v is None or v == "":
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def kind_of(row: dict) -> str:
    if row["list_id"] == "filmography":
        return "film"
    title = row["title"]
    entry = row["entry"]
    if re.search(r'^["“]', title) or f'"{title}"' in entry or f'“{title}”' in entry:
        return "essay"
    if re.search(r"\beditor|\beditora|\bcoordinador|\brecopilador|, ed\.", row["author"], re.I):
        return "edited_volume"
    return "monograph"


def main() -> None:
    for path in (LIST, MATCHES):
        if not path.exists():
            sys.exit(f"{path} not found — run parse_list.py and match_corpus.py first")

    with MATCHES.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    citability = read_citability()

    # Keys in SPLITS and CONTAINERS are written by hand against ids that are
    # themselves derived from titles. A title correction moves the id, and a
    # stale key would silently do nothing — no container, no split, no error.
    known = {r["id"] for r in rows}
    stale = [k for k in list(SPLITS) + list(CONTAINERS) if k not in known]
    if stale:
        print("  These keys are not in matches.csv:\n")
        for key in stale:
            print(f"    {key}")
            stem = key.split("-")[0]
            near = [i for i in sorted(known) if i.startswith(stem)]
            for n in near[:4]:
                print(f"        did you mean {n}")
        sys.exit("\n  Fix the keys in make_seed.py and run again.")

    out: list[str] = [
        "-- Scriptorium — seed",
        "--",
        "-- Generated by pipeline/make_seed.py from list.csv and matches.csv.",
        "-- Re-runnable: every statement is an upsert. Review before running.",
        "--",
        "-- Work ids are permanent. Notes anchor to them and they appear in URLs.",
        "",
        "begin;",
        "",
        "-- Lists ------------------------------------------------------------",
        "insert into exam_lists (id, name, description, examinable, sort) values",
    ]
    out.append(",\n".join(
        f"  ({q(i)}, {q(n)}, {q(d)}, {q(e)}, {s})" for i, n, d, e, s in LISTS
    ) + "\non conflict (id) do update set name = excluded.name, "
        "description = excluded.description, examinable = excluded.examinable, "
        "sort = excluded.sort;\n")

    # Sections, in the order the document presents them.
    sections: dict[str, dict] = {}
    order: dict[str, int] = {}
    for row in rows:
        lid, title = row["list_id"], row["section"]
        if not title:
            continue
        sid = f"{lid}-{re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:40]}"
        if sid not in sections:
            order[lid] = order.get(lid, 0) + 1
            sections[sid] = {
                "id": sid, "list_id": lid,
                "letter": row["section_letter"] or None,
                "title": re.sub(r"^[A-Z]\.\s*", "", title),
                "kind": row["group"], "sort": order[lid],
            }
        row["section_id"] = sid

    for lid, letter, title in EMPTY_SECTIONS:
        sid = f"{lid}-{re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:40]}"
        if sid in sections:
            continue
        order[lid] = order.get(lid, 0) + 1
        sections[sid] = {
            "id": sid, "list_id": lid, "letter": letter, "title": title,
            "kind": "core", "sort": order[lid],
        }

    out.append("-- Sections ---------------------------------------------------------")
    out.append("insert into list_sections (id, list_id, letter, title, kind, sort) values")
    out.append(",\n".join(
        f"  ({q(s['id'])}, {q(s['list_id'])}, {q(s['letter'])}, {q(s['title'])}, "
        f"{q(s['kind'])}, {s['sort']})" for s in sections.values()
    ) + "\non conflict (id) do update set letter = excluded.letter, "
        "title = excluded.title, kind = excluded.kind, sort = excluded.sort;\n")

    # Works ----------------------------------------------------------------
    works: list[dict] = []
    memberships: list[tuple[str, str, str, int]] = []
    counters: dict[str, int] = {}

    for container in CONTAINERS.values():
        # Containers are built from a dict rather than from a list row, so every
        # column the works block emits has to be present. Omitting these two
        # sent nulls into a not-null column with a default — an explicit null in
        # an insert overrides the default rather than falling back to it.
        works.append({
            **container,
            "standing": "assigned",
            "purpose": "unassigned",
            "source_format": "none",
            "source_path": None,
            "page_offset": 0,
            "notes_internal": "Holds the imprint its essays cite through. "
                              "Not on any list, so not examinable in itself.",
        })

    for row in rows:
        held = bool(row["file"])
        ext = row.get("ext", "")
        note = row.get("note", "")

        source_format = FORMAT.get(ext, "none") if held else "none"
        internal = note or None
        page_offset = 0

        if not held and note:
            internal = PARTIAL_NOTE.format(why=note)

        # Citability comes from check_pdf.py, not from the extension.
        if held and ext == ".pdf":
            verdict = citability.get(row["file"], {})
            v = verdict.get("verdict", "")

            if v in {"citable", "probably citable"}:
                offset = verdict.get("offset", "")
                agreement = float(verdict.get("agreement") or 0)
                folios = int(verdict.get("folios") or 0)
                total = int(verdict.get("pages") or 0)

                # An offset is only seeded when the evidence is strong. The
                # checker will accept a long run on weak agreement, which is
                # right for judging whether a book is paginated at all and wrong
                # for deciding what its offset is. Coloniality at Large was
                # accepted on 146 agreeing folios out of 588, and a wrong offset
                # produces citations that look correct and are not.
                strong = (
                    offset not in ("", None)
                    and agreement >= 0.7
                    and total > 0
                    and folios >= total * 0.25
                )

                if strong:
                    page_offset = int(offset)
                    # A positive offset means the file begins partway into the
                    # book: it is an excerpt, and the pages it does have are
                    # correctly numbered.
                    if page_offset > 0:
                        internal = " | ".join(x for x in (
                            internal,
                            f"Excerpt: begins at printed page {page_offset + 1}.",
                        ) if x)
                elif offset not in ("", None):
                    internal = " | ".join(x for x in (
                        internal,
                        f"Page offset uncertain (best guess {offset}, "
                        f"{verdict.get('agreement')} agreement across {folios} "
                        f"of {total} pages). Left at zero; confirm against the PDF.",
                    ) if x)
            elif v == "NOT citable":
                source_format = "epub"
                internal = " | ".join(x for x in (
                    internal,
                    "No printed pagination: searchable, but no page a reader "
                    f"could follow. {verdict.get('against', '')}",
                ) if x)
            elif v == "needs OCR":
                source_format = "none"
                internal = " | ".join(x for x in (
                    internal,
                    f"Scan held ({verdict.get('pages', '?')}pp) with no text "
                    "layer. Run OCR, then re-check.",
                ) if x)
            elif v == "check by hand":
                internal = " | ".join(x for x in (
                    internal,
                    f"Pagination unconfirmed: {verdict.get('against', '')}",
                ) if x)

        work = {
            "id": row["id"],
            "title": row["title"],
            "author": row["author"] or None,
            "year": int(row["year"]) if row["year"].isdigit() else None,
            "kind": kind_of(row),
            "isbn": row.get("file_isbn") or None,
            "purpose": "both" if row["examinable"] == "yes" else "dissertation",
            "standing": "assigned",
            "source_format": source_format,
            "source_path": f"pipeline/corpus/{row['file']}" if held else None,
            "page_offset": page_offset,
            "notes_internal": internal,
            "container_id": None,
        }

        if row["id"] in CONTAINERS:
            work["container_id"] = CONTAINERS[row["id"]]["id"]
            work["kind"] = "essay"

        works.append(work)

        counters[row["list_id"]] = counters.get(row["list_id"], 0) + 1
        memberships.append((row["list_id"], row["id"],
                            row.get("section_id", ""), counters[row["list_id"]]))

        for extra_title, extra_id, shares_file in SPLITS.get(row["id"], []):
            extra = {
                **work,
                "id": extra_id,
                "title": extra_title,
                "notes_internal": f"Listed together with “{row['title']}” "
                                  f"in a single entry.",
            }
            if not shares_file:
                extra["source_format"] = "none"
                extra["source_path"] = None
                extra["page_offset"] = 0
                extra["isbn"] = None
                extra["notes_internal"] += (
                    " A separate volume: the file held for that entry does not "
                    "contain this work."
                )
            works.append(extra)

            counters[row["list_id"]] += 1
            memberships.append((row["list_id"], extra_id,
                                row.get("section_id", ""), counters[row["list_id"]]))

    cols = ["id", "title", "author", "year", "kind", "container_id", "isbn",
            "purpose", "standing", "source_format", "source_path", "page_offset",
            "notes_internal"]

    out.append("-- Works ------------------------------------------------------------")
    out.append(f"insert into works ({', '.join(cols)}) values")
    out.append(",\n".join(
        "  (" + ", ".join(q(w.get(c)) for c in cols) + ")" for w in works
    ) + "\non conflict (id) do update set\n" + ",\n".join(
        f"  {c} = excluded.{c}" for c in cols if c != "id"
    ) + ",\n  updated_at = now();\n")

    out.append("-- Placement --------------------------------------------------------")
    out.append("insert into list_items (list_id, work_id, section_id, ordinal) values")
    out.append(",\n".join(
        f"  ({q(l)}, {q(w)}, {q(s or None)}, {o})" for l, w, s, o in memberships
    ) + "\non conflict (list_id, work_id) do update set "
        "section_id = excluded.section_id, ordinal = excluded.ordinal;\n")

    out.append("commit;")

    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")

    held = sum(1 for w in works if w.get("source_format") not in (None, "none"))
    print(f"  {len(works)} works ({len(CONTAINERS)} containers, "
          f"{sum(len(v) for v in SPLITS.values())} from split entries)")
    print(f"  {len(sections)} sections, {len(memberships)} placements")
    print(f"  {held} with a file")
    print(f"\n  Wrote {OUT}")
    print("  Read it, then run it in the Neon SQL editor.")


if __name__ == "__main__":
    main()
