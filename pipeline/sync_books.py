#!/usr/bin/env python3
"""Write what books.csv knows about each work's PDF into the database.

    python3 pipeline/sync_books.py
    python3 pipeline/sync_books.py --dry-run

books.csv is the register a person edits. This copies three of its columns into
works so the application can show them: the filename, the verdict on that file,
and the state a person has concluded.

    source_path   the filename in pipeline/corpus, or several, pipe-separated
    pdf_verdict   check_pdf.py's reading: citable, re-OCR, needs OCR, …
    pdf_state     none · queued · ready · loaded

Run it after editing books.csv, and after any extraction. Nothing else writes
these columns, and nothing depends on them: they describe the corpus, not the
catalogue, and a work with a wrong pdf_state still reads and cites correctly.

The point is the question Zazil can then ask without a terminal: which books on
my lists does nobody have a copy of.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from dbconn import connect

BOOKS = Path(__file__).parent.parent / "books.csv"


def state_of(row: dict) -> str:
    """What a person has concluded, read off the row.

    'queued' is inferred from the verdict rather than typed: a file needing OCR
    is a file that exists, which is a different thing from having no copy, and
    conflating them would put books on the shopping list that are already in
    hand."""
    pdf = (row.get("pdf") or "").strip()
    verdict = (row.get("pdf_verdict") or "").strip().casefold()
    pages = (row.get("pages") or "0").strip()

    if not pdf:
        return "none"
    if pages.isdigit() and int(pages) > 0:
        return "loaded"
    if "ocr" in verdict:
        return "queued"
    return "ready"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not BOOKS.exists():
        raise SystemExit(f"{BOOKS} not found — run pipeline/inventory.py first")

    with BOOKS.open(encoding="utf-8-sig") as fh:
        rows = [r for r in csv.DictReader(fh) if (r.get("work_id") or "").strip()]

    tally: dict[str, int] = {}
    updates = []
    for row in rows:
        state = state_of(row)
        tally[state] = tally.get(state, 0) + 1
        updates.append((
            (row.get("pdf") or "").strip() or None,
            (row.get("pdf_verdict") or "").strip() or None,
            state,
            row["work_id"].strip(),
        ))

    for state in ("loaded", "ready", "queued", "none"):
        if tally.get(state):
            print(f"  {tally[state]:>4}  {state}")

    if args.dry_run:
        print("\n  dry run: nothing written")
        return

    with connect() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                update works
                set source_path = %s, pdf_verdict = %s, pdf_state = %s,
                    updated_at = now()
                where id = %s
                """,
                updates,
            )
    print(f"\n  {len(updates)} works updated")


if __name__ == "__main__":
    main()
