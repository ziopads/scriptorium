#!/usr/bin/env python3
"""Dump the irreplaceable tables to a file. Reads the database, writes nothing to it.

    python3 pipeline/backup.py                   # to backups/scriptorium-YYYY-MM-DD.sql
    python3 pipeline/backup.py --out -           # to stdout, for piping
    python3 pipeline/backup.py --all             # include pages and chunks as well
    python3 pipeline/backup.py --verify FILE     # count the rows in a dump

WHAT IS WORTH BACKING UP, AND WHAT IS NOT

    Irreplaceable, and small. Her notes, quotations, translations, attributions,
    tags and axes; the catalogue; the exam lists and their numbering; the page
    offset ranges that took a day to establish. A few thousand rows, a couple of
    megabytes. Nothing regenerates these: they were typed, or judged.

    Rebuildable, slowly. pages and chunks come back from pipeline/pages/*.json
    by re-running the loaders. Included only with --all.

    Rebuildable, free. Embeddings. 3,268 chunks took 97 seconds and cost
    nothing against the free grant. Never worth storing.

    So the dump is lopsided on purpose, and the small half is the half that
    matters. A backup that takes an hour to make gets made once.

WHAT THIS IS NOT

    Not a substitute for Neon's point-in-time restore, which is the better tool
    for the likely disaster: not Neon losing data, but a bad migration or a
    careless delete three days before an examination. Check the retention window
    on the current plan; that is the first line of defence and it needs no work.

    This is the second line: an off-Neon copy, in a format that can be read by
    any Postgres, in case the account itself is the problem.

RESTORING

    psql "$DATABASE_URL" -f backups/scriptorium-2026-09-16.sql

    Every table is truncated and reloaded, inside one transaction, in dependency
    order. Restore into a Neon branch first and open the application against it.
    A backup nobody has restored is a hypothesis.
"""

from __future__ import annotations

import argparse
import gzip
import io
import sys
from datetime import date
from pathlib import Path

from dbconn import connect

BACKUPS = Path(__file__).parent.parent / "backups"

# In dependency order: a restore truncates and reloads in this sequence, so a
# child never arrives before its parent.
CORE = [
    "exam_lists",
    "works",
    "list_sections",
    "list_items",
    "page_offsets",
    "sections",
    "notes",
    "note_works",
    "note_anchors",
    "note_links",
    "note_revisions",
    "schema_migrations",
]

DERIVED = ["pages", "chunks", "page_loads"]


def existing(cur, tables: list[str]) -> list[str]:
    cur.execute(
        "select table_name from information_schema.tables "
        "where table_schema = 'public' and table_name = any(%s)",
        (tables,),
    )
    found = {r[0] for r in cur.fetchall()}
    return [t for t in tables if t in found]


def dump(handle, tables: list[str], note: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    with connect() as conn:
        with conn.cursor() as cur:
            present = existing(cur, tables)

            handle.write("-- Scriptorium backup\n")
            handle.write(f"-- {note}\n")
            handle.write("--\n")
            handle.write("-- Restore:  psql \"$DATABASE_URL\" -f this-file\n")
            handle.write("-- Tables are truncated and reloaded in dependency order,\n")
            handle.write("-- inside one transaction. Restore into a branch first.\n\n")
            handle.write("begin;\n\n")
            handle.write("set constraints all deferred;\n\n")

            for table in reversed(present):
                handle.write(f"truncate table {table} cascade;\n")
            handle.write("\n")

            for table in present:
                cur.execute(f"select count(*) from {table}")
                counts[table] = cur.fetchone()[0]

                handle.write(f"-- {table}: {counts[table]:,} rows\n")
                handle.write(f"copy {table} from stdin;\n")
                buffer = io.StringIO()
                with cur.copy(f"copy {table} to stdout") as copy:
                    for row in copy:
                        buffer.write(bytes(row).decode("utf-8"))
                handle.write(buffer.getvalue())
                handle.write("\\.\n\n")

            handle.write("commit;\n")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="", help="path, or - for stdout")
    parser.add_argument("--all", action="store_true",
                        help="include pages, chunks and page_loads")
    parser.add_argument("--gzip", action="store_true")
    args = parser.parse_args()

    tables = CORE + (DERIVED if args.all else [])
    stamp = date.today().isoformat()
    note = f"{stamp} — {'everything' if args.all else 'catalogue, lists and notes'}"

    if args.out == "-":
        dump(sys.stdout, tables, note)
        return

    BACKUPS.mkdir(exist_ok=True)
    name = f"scriptorium-{stamp}{'-full' if args.all else ''}.sql"
    path = BACKUPS / (name + (".gz" if args.gzip else ""))

    if args.gzip:
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            counts = dump(fh, tables, note)
    else:
        with path.open("w", encoding="utf-8") as fh:
            counts = dump(fh, tables, note)

    for table, n in counts.items():
        print(f"  {table:<22} {n:>8,}")
    size = path.stat().st_size
    print(f"\n  {sum(counts.values()):,} rows, {size / 1024:.0f} kB")
    print(f"  Wrote {path}")
    print("\n  Restore it into a Neon branch and open the app against it before")
    print("  trusting it. A backup nobody has restored is a hypothesis.")


if __name__ == "__main__":
    main()
