#!/usr/bin/env python3
"""Load the chapter map from pipeline/pages/*.json into the sections table.

    python3 pipeline/load_sections.py --pending 5 --list I
                                                   # numbering checked, no chunks yet
    python3 pipeline/load_sections.py <work id> ...  # named works, by full id
    python3 pipeline/load_sections.py --dry-run --pending 5

With no work named and no --pending it refuses.

Run after load_pages.py and offsets.py for the same works: the printed pages
come from the pages table, so a work whose pages are not in yet gets none and
says so. A work whose page numbering offsets.py could not settle is skipped,
named or not, until the numbering is fixed and offsets.py run on it again.

One work per transaction: its sections are deleted and reinserted, so a rerun
after re-extraction replaces rather than duplicates. A book whose extract found
no chapters simply gets none, which is the honest answer for Rael and Herrera.

first_page and last_page are PRINTED pages, read from the printed_pages view
rather than computed, so a book with a plate section partway through (Gonzales,
migration 008) gets the right numbers on both sides of it.

Front matter is dropped. An outline lists Cover, Title page, Copyright and
Contents alongside the chapters, and a contents list that opens with four
entries nobody will ever click is worse than one that opens with chapter one.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dbconn import announce_pending, connect, pending, resolve, skip_offset_problems

PAGES = Path(__file__).parent / "pages"


def load_one(cur, book_id: str, work_id: str, doc: dict) -> int:
    chapters = doc.get("chapters") or []
    source = doc.get("chapters_source") or "none"

    cur.execute("delete from sections where work_id = %s", (work_id,))
    if not chapters or source == "none":
        return 0

    cur.execute(
        "select page_index, printed_page from printed_pages where work_id = %s",
        (work_id,),
    )
    printed = {index: page for index, page in cur.fetchall()}
    if not printed:
        print(f"  ! {book_id}: no pages loaded; run load_pages.py first")
        return 0

    rows = []
    for chapter in chapters:
        first = printed.get(chapter["page"])
        if first is None or first < 1:
            continue  # unloaded, or front matter
        last = printed.get(chapter.get("last_page"))
        rows.append(
            (
                work_id,
                len(rows) + 1,
                chapter.get("level", 1),
                chapter["title"][:300],
                first,
                last if last is not None and last >= first else None,
                source,
            )
        )

    if not rows:
        return 0

    # The end of each section is the page before the next one starts, so the
    # spans tile. The extract closes them in file pages; redone here because a
    # front-matter entry may have been dropped between them.
    closed = []
    for i, row in enumerate(rows):
        last = rows[i + 1][4] - 1 if i + 1 < len(rows) else row[5]
        closed.append(row[:5] + (max(last, row[4]) if last is not None else None, row[6]))

    cur.executemany(
        """
        insert into sections
          (work_id, ordinal, level, title, first_page, last_page, source)
        values (%s, %s, %s, %s, %s, %s, %s)
        """,
        closed,
    )
    return len(closed)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("work", nargs="*", help="full work ids")
    parser.add_argument(
        "--pending",
        type=int,
        metavar="N",
        help="the next N works with numbering checked and no chunks loaded",
    )
    parser.add_argument(
        "--list",
        dest="which",
        metavar="CODE",
        help="limit --pending to a list or section: I, II, II.C, Supl. III",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.pending and args.work:
        parser.error("--pending chooses the works itself; do not also name works")
    if not args.pending and not args.work:
        parser.error("name the works by full id, or use --pending N")

    by_stem = {f.stem: f for f in PAGES.glob("*.json")}
    if args.pending:
        wanted = pending("load_sections", args.pending, args.which)
        if not wanted:
            print("  nothing pending — no checked work is waiting for sections")
            return
        announce_pending(
            wanted, set(by_stem),
            "no extraction in pipeline/pages — run extract.py for it first",
        )
    else:
        wanted = skip_offset_problems([resolve(n) for n in args.work])
        for work_id in wanted:
            if work_id not in by_stem:
                print(f"  {work_id}: no extraction in pipeline/pages — run extract.py first")

    files = [by_stem[w] for w in wanted if w in by_stem]
    if not files:
        sys.exit("nothing to load")

    if args.dry_run:
        for f in files:
            doc = json.loads(f.read_text(encoding="utf-8"))
            chapters = doc.get("chapters") or []
            source = doc.get("chapters_source") or "none"
            print(f"  {f.stem:<52} {len(chapters):>4} from {source}")
        print("\n  dry run: nothing written")
        return

    total = 0
    with connect() as conn:
        for f in files:
            doc = json.loads(f.read_text(encoding="utf-8"))
            work_id = f.stem
            with conn.transaction():
                with conn.cursor() as cur:
                    n = load_one(cur, work_id, work_id, doc)
            total += n
            source = doc.get("chapters_source") or "none"
            print(f"  {work_id:<52} {n:>4} sections  ({source})")

    print(f"\n  {total:,} sections loaded")


if __name__ == "__main__":
    main()
