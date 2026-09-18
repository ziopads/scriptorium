#!/usr/bin/env python3
"""Emit a migration that moves the catalogue onto a new version of the lists.

    python3 pipeline/relist.py --check      # what would change, and what blocks it
    python3 pipeline/relist.py --emit db/010-lists-oct-2026.sql

Reads pipeline/reconcile.csv, which reconcile.py writes. Writes SQL to a file
and nothing to the database; pipeline/migrate.py applies it like any other
migration.

WHAT IT TOUCHES, AND WHAT IT WILL NOT

    list_sections   upserted to match the document: letters, titles, order.
    list_items      upserted: which list, which section, which ordinal.

    Nothing else. Not works, not notes, not anchors, not pages, not chunks. A
    work dropped from a list keeps every row it has; it loses one membership and
    becomes an off-list work, which is the same state a work added by hand
    arrives in.

    In particular this does NOT re-run make_seed.py. That would rewrite
    source_format, page_offset and notes_internal from citability.csv, and those
    columns now carry a day's worth of extraction: corrected offsets, OCR
    verdicts, the page_offsets ranges. Re-seeding would quietly undo them.

WHY A GENERATED MIGRATION RATHER THAN HAND-WRITTEN SQL

    A hundred and sixty placements, five lists, twenty-odd sections. Written by
    hand, the errors are invisible: an ordinal off by one, a section letter that
    does not match the document, a work silently left where it was. Generated,
    the file is reviewable as a whole and the review is the check.

    It is still a migration, committed and applied by the runner, because a
    schema that no one can reconstruct from the repository is how a database and
    a repository come apart.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

from dbconn import connect

PIPELINE = Path(__file__).parent
RECONCILE = PIPELINE / "reconcile.csv"

# The document's list headings, mapped to the ids already in exam_lists.
LIST_IDS = {
    "i. theory": "theory",
    "ii. dissertation": "dissertation",
    "iii. teaching": "teaching",
    "working bibliography": "working-bibliography",
    "working filmography": "filmography",
}


def q(value) -> str:
    if value is None or value == "":
        return "null"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def list_id_of(heading: str) -> str | None:
    head = heading.split(":")[0].strip().casefold()
    return LIST_IDS.get(head)


def section_id(list_id: str, letter: str, title: str) -> str:
    """The id form the database settled on: list, then the title without its
    letter.

    A section's letter moves — Dissertation J became I when a section above it
    was cut — so an id carrying the letter goes stale the moment the department
    renumbers, and an upsert then inserts a parallel row instead of updating.
    That is what migration 010 did, and 011 cleaned up: 23 sections existing
    twice, once holding the works and once empty.

    The title is the stable part. Keying on it means a renumbering updates the
    letter on the row that already holds the works.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", title.casefold()).strip("-")[:40]
    return f"{list_id}-{slug}"


def read_rows() -> list[dict]:
    if not RECONCILE.exists():
        sys.exit(f"{RECONCILE} not found — run reconcile.py --csv first")
    with RECONCILE.open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def build(rows: list[dict]):
    """Sections in document order, and one placement per entry."""
    sections: dict[str, dict] = {}
    order: dict[str, int] = {}
    placements: list[dict] = []
    unmatched: list[dict] = []
    counters: dict[str, int] = {}

    for row in rows:
        # "gone" carries a work with no place in the document; "new" carries a
        # place with no work. reconcile.py writes its nearest guess into the
        # work_id column of a new row so a person can read it, which means the
        # column is only authoritative on a matched row — taking it at face value
        # would have placed Los que se quedan at the Penitentes film's number.
        if row["status"] in {"gone", "new"}:
            if row["status"] == "new":
                unmatched.append({**row, "why": "no work in the catalogue"})
            continue

        list_id = list_id_of(row["list"])
        if not list_id:
            unmatched.append({**row, "why": f"no list id for {row['list'][:40]!r}"})
            continue

        raw_section = row["section"].strip()
        if raw_section.casefold().startswith("supplementary"):
            letter, title = None, "Supplementary"
        elif raw_section:
            m = re.match(r"^([A-Z])\.\s*(.+)$", raw_section)
            letter, title = (m.group(1), m.group(2)) if m else (None, raw_section)
        else:
            letter, title = None, ""

        sid = section_id(list_id, letter or "", title) if title else None
        if sid and sid not in sections:
            order[list_id] = order.get(list_id, 0) + 1
            sections[sid] = {
                "id": sid, "list_id": list_id, "letter": letter,
                "title": title, "sort": order[list_id],
                # Supplementary is examinable: her department counts it inside
                # the list totals, and a supplementary work can carry a ficha in
                # an axis. The distinction is one of emphasis, not of scope, so
                # nothing here touches examinability.
                "kind": "supplementary" if letter is None and title == "Supplementary" else "core",
            }

        if not row["work_id"]:
            unmatched.append({**row, "why": "no work in the catalogue"})
            continue

        # A work sharing an entry with another — Pedro Páramo with El llano en
        # llamas, Senderos fronterizos with Cajas de cartón — shares its number
        # too. The document gives the pair one line and one number, so the
        # counter does not advance and both works carry it.
        if row["status"] == "split":
            ordinal = counters.get(list_id, 1)
        else:
            counters[list_id] = counters.get(list_id, 0) + 1
            ordinal = counters[list_id]

        placements.append({
            "list_id": list_id,
            "work_id": row["work_id"],
            "section_id": sid,
            "ordinal": ordinal,
            "label": f"{row['author'][:28]} — {row['title'][:40]}",
        })

    return sections, placements, unmatched


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--emit", metavar="PATH", help="write the migration here")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    rows = read_rows()
    sections, placements, unmatched = build(rows)

    wanted = {(p["list_id"], p["work_id"]) for p in placements}

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select list_id, work_id from list_items")
            current = {(r[0], r[1]) for r in cur.fetchall()}
            cur.execute("select id from works")
            known = {r[0] for r in cur.fetchall()}

    missing_work = sorted({p["work_id"] for p in placements if p["work_id"] not in known})
    dropped = sorted(current - wanted)

    print(f"\n  {len(rows)} rows from reconcile.csv")
    print(f"  {len(sections)} sections, {len(placements)} placements")
    print(f"  {len(dropped)} memberships the document no longer has")
    if unmatched:
        print(f"  {len(unmatched)} entries that cannot be placed\n")
        for row in unmatched:
            print(f"    {row['list'][:22]:<22} {row['author'][:30]:<30} {row['why']}")
        print("\n  Add these works in the app first, then re-run reconcile.py --csv.")

    if missing_work:
        print("\n  These work ids are in reconcile.csv and not in the catalogue:")
        for wid in missing_work:
            print(f"    {wid}")
        sys.exit("\n  Refusing to emit: a placement must name a work that exists.")

    if dropped:
        print("\n  Memberships that would be removed (the work itself is untouched):")
        for list_id, work_id in dropped:
            print(f"    {list_id:<22} {work_id}")

    if args.check or not args.emit:
        print("\n  Nothing written. Re-run with --emit to write the migration.")
        return

    out = [
        "-- Scriptorium — migration 010: the October 2026 lists",
        "--",
        "-- Generated by pipeline/relist.py from pipeline/reconcile.csv, which",
        "-- reconcile.py produced from the department's final PDF.",
        "--",
        "-- The catalogue was built from an earlier version of the document. This",
        "-- moves it onto the final one: sections dissolved and created, works",
        "-- renumbered, thirty-seven works moved into Supplementary blocks.",
        "--",
        "-- Supplementary is examinable. The department counts it inside each",
        "-- list's total and a supplementary work can carry a ficha in an axis,",
        "-- so nothing here touches examinable_works.",
        "--",
        "-- Touches list_sections and list_items only. No work, note, anchor,",
        "-- page or chunk is read or written. A work dropped from a list keeps",
        "-- everything it has and becomes an off-list work.",
        "",
        "begin;",
        "",
        "-- Sections, in the order the document presents them ------------------",
        "insert into list_sections (id, list_id, letter, title, kind, sort) values",
    ]
    out.append(",\n".join(
        f"  ({q(s['id'])}, {q(s['list_id'])}, {q(s['letter'])}, {q(s['title'])}, "
        f"{q(s['kind'])}, {s['sort']})" for s in sections.values()
    ) + "\non conflict (id) do update set letter = excluded.letter, "
        "title = excluded.title, kind = excluded.kind, sort = excluded.sort;")
    out.append("")

    out.append("-- Placement ----------------------------------------------------------")
    out.append("insert into list_items (list_id, work_id, section_id, ordinal) values")
    # The label goes ABOVE its row, not after it. Trailing it put the comma that
    # separates two tuples inside the comment, which commented out every row
    # separator in the file and made the whole statement unparseable.
    out.append(",\n".join(
        f"  -- {p['label']}\n"
        f"  ({q(p['list_id'])}, {q(p['work_id'])}, {q(p['section_id'])}, {p['ordinal']})"
        for p in placements
    ) + "\non conflict (list_id, work_id) do update set "
        "section_id = excluded.section_id, ordinal = excluded.ordinal;")
    out.append("")

    if dropped:
        out.append("-- Off the list -------------------------------------------------------")
        out.append("--")
        out.append("-- One membership row each. The works themselves, and every note,")
        out.append("-- quotation and page belonging to them, are untouched: they become")
        out.append("-- off-list works, the same state a work added by hand arrives in.")
        for list_id, work_id in dropped:
            out.append(
                f"delete from list_items where list_id = {q(list_id)} "
                f"and work_id = {q(work_id)};"
            )
        out.append("")
        out.append("update works set standing = 'added', updated_at = now()")
        out.append("where id in (" + ", ".join(q(w) for _, w in dropped) + ")")
        out.append("  and not exists (select 1 from list_items li where li.work_id = works.id);")
        out.append("")

    out.append("commit;")
    out.append("")
    out.append("-- After running, confirm the counts against the document's own header:")
    out.append("--   Theory 29 · Dissertation 52 · Teaching 41")
    out.append("--")
    out.append("--   select l.name, s.title, count(*)")
    out.append("--   from list_items li")
    out.append("--   join exam_lists l on l.id = li.list_id")
    out.append("--   left join list_sections s on s.id = li.section_id")
    out.append("--   group by l.name, s.title order by l.name, s.title;")

    path = Path(args.emit)
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"\n  Wrote {path}")
    print("  Read it, then: pipeline/migrate.py --dry-run")


if __name__ == "__main__":
    main()
