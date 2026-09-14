#!/usr/bin/env python3
"""Load page text from pipeline/pages/*.json into the pages table.

    python3 pipeline/load_pages.py                     # every page file with a work_id
    python3 pipeline/load_pages.py herrera-transmigracion-cuerpos-2013
    python3 pipeline/load_pages.py --dry-run           # report, write nothing

One work per transaction: its rows are deleted and reinserted, so a rerun
after re-extraction replaces rather than duplicates. page_loads records which
extractor run the rows came from.

The printed page is not written. It is page_index + works.page_offset, in the
printed_pages view; this loader neither reads nor trusts the printed_page the
extractor put in the JSON, because the offset that matters is the one in the
catalogue, corrected by hand.

Requires DATABASE_URL_UNPOOLED (read from .env.local) and psycopg.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dbconn import connect, resolve, work_ids

PAGES = Path(__file__).parent / "pages"


def load_one(cur, book_id: str, work_id: str, doc: dict) -> int:
    pages = doc["pages"]

    cur.execute("select 1 from works where id = %s", (work_id,))
    if cur.fetchone() is None:
        sys.exit(f"{book_id}: work_id {work_id} is not in the works table")

    cur.execute("delete from pages where work_id = %s", (work_id,))
    cur.executemany(
        "insert into pages (work_id, page_index, folio, text) values (%s, %s, %s, %s)",
        [(work_id, p["page"], p.get("folio"), p["text"]) for p in pages],
    )
    cur.execute(
        """
        insert into page_loads
          (work_id, source_book_id, extracted_at, extractor, page_count,
           running_heads_removed, loaded_at)
        values (%s, %s, %s, %s, %s, %s, now())
        on conflict (work_id) do update set
          source_book_id = excluded.source_book_id,
          extracted_at = excluded.extracted_at,
          extractor = excluded.extractor,
          page_count = excluded.page_count,
          running_heads_removed = excluded.running_heads_removed,
          loaded_at = now()
        """,
        (
            work_id,
            book_id,
            doc.get("extracted_at"),
            doc.get("extractor"),
            len(pages),
            doc.get("running_heads_removed", []),
        ),
    )
    return len(pages)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("book_id", nargs="*", help="pipeline ids; default: every mapped page file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    files = sorted(PAGES.glob("*.json"))
    if args.book_id:
        wanted = set(args.book_id)
        files = [f for f in files if f.stem in wanted]
        missing = wanted - {f.stem for f in files}
        if missing:
            sys.exit(f"no page file for: {', '.join(sorted(missing))}")

    mapped = work_ids()
    skipped = [f.stem for f in files if f.stem not in mapped]
    files = [f for f in files if f.stem in mapped]
    for s in skipped:
        print(f"  {s}: no work_id in mapping.csv, skipped")
    if not files:
        sys.exit("nothing to load")

    if args.dry_run:
        for f in files:
            doc = json.loads(f.read_text(encoding="utf-8"))
            print(f"  {f.stem:<44} -> {mapped[f.stem]:<52} {len(doc['pages']):>4}p")
        print("\n  dry run: nothing written")
        return

    total = 0
    with connect() as conn:
        for f in files:
            doc = json.loads(f.read_text(encoding="utf-8"))
            book_id = f.stem
            work_id = resolve(book_id)
            with conn.transaction():
                with conn.cursor() as cur:
                    n = load_one(cur, book_id, work_id, doc)
            total += n
            print(f"  {book_id:<44} -> {work_id:<52} {n:>4}p")

    print(f"\n  {total:,} pages loaded")


if __name__ == "__main__":
    main()
