#!/usr/bin/env python3
"""Load page text from pipeline/pages/*.json into the pages table.

    python3 pipeline/load_pages.py --pending 5 --list I
                                                       # extracted, not yet loaded
    python3 pipeline/load_pages.py <work id> ...       # named works, by full id
    python3 pipeline/load_pages.py --dry-run --pending 5

With no work named and no --pending it refuses.

One work per transaction: its rows are deleted and reinserted, so a rerun
after re-extraction replaces rather than duplicates. page_loads records which
extractor run the rows came from.

New pages clear the work's offset check (offset_checked_at, offset_problem),
because the folios it was judged on have been replaced. Run offsets.py next.

works.source_path is not written. Neon is where a person records which file a
work is; a loader copying back whatever the extraction read would overwrite
that decision with the file the pipeline happened to open.

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

from dbconn import announce_pending, connect, pending, resolve

PAGES = Path(__file__).parent / "pages"


def load_one(cur, work_id: str, doc: dict) -> int:
    pages = doc["pages"]

    cur.execute("select 1 from works where id = %s", (work_id,))
    if cur.fetchone() is None:
        sys.exit(f"{work_id} is not in the works table")

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
            work_id,
            doc.get("extracted_at"),
            doc.get("extractor"),
            len(pages),
            doc.get("running_heads_removed", []),
        ),
    )

    cur.execute(
        "update works set offset_checked_at = null, offset_problem = null where id = %s",
        (work_id,),
    )

    return len(pages)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("work", nargs="*", help="full work ids")
    parser.add_argument(
        "--pending",
        type=int,
        metavar="N",
        help="the next N works extracted and not yet loaded",
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
        wanted = pending("load_pages", args.pending, args.which)
        if not wanted:
            print("  nothing pending — every extraction on disk is loaded")
            return
        announce_pending(wanted, set(by_stem), "")
    else:
        wanted = [resolve(n) for n in args.work]
        for work_id in wanted:
            if work_id not in by_stem:
                print(f"  {work_id}: no extraction in pipeline/pages — run extract.py first")

    files = [by_stem[w] for w in wanted if w in by_stem]
    if not files:
        sys.exit("nothing to load")

    if args.dry_run:
        for f in files:
            doc = json.loads(f.read_text(encoding="utf-8"))
            print(f"  {f.stem:<52} {len(doc['pages']):>4}p")
        print("\n  dry run: nothing written")
        return

    total = 0
    with connect() as conn:
        for f in files:
            doc = json.loads(f.read_text(encoding="utf-8"))
            work_id = f.stem
            with conn.transaction():
                with conn.cursor() as cur:
                    n = load_one(cur, work_id, doc)
            total += n
            print(f"  {work_id:<52} {n:>4}p")

    print(f"\n  {total:,} pages loaded")
    print("  Next: offsets.py for the same works, before sections and chunks.")


if __name__ == "__main__":
    main()
