#!/usr/bin/env python3
"""Load pipeline/chunks/*.json into the chunks table, with no embeddings.

    python3 pipeline/load_chunks.py                    # every mapped chunk file
    python3 pipeline/load_chunks.py rael               # a substring of a work id
    python3 pipeline/load_chunks.py --dry-run

One work per transaction: its chunks are deleted and reinserted. start_page
and end_page are PRINTED pages, as the schema requires, and they are read from
the printed_pages view rather than computed here. That matters since migration
008: a book whose printed numbering breaks partway — Gonzales has an unnumbered
plate section, after which the file runs twelve ahead — needs a different
offset for each range, and works.page_offset alone would put every chunk in the
second half of that book on the wrong page. If an offset is later corrected,
rerun this for that work.

embedding, embedding_model and embedding_dim are left null; embed.py fills
them once the model is settled.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dbconn import connect, resolve, work_ids

CHUNKS = Path(__file__).parent / "chunks"


def load_one(cur, work_id: str, doc: dict) -> int:
    cur.execute("select page_offset from works where id = %s", (work_id,))
    row = cur.fetchone()
    if row is None:
        sys.exit(f"{work_id} is not in the works table")
    offset = row[0]

    # The printed page per file page, as the view resolves it: a range in
    # page_offsets where one covers the page, works.page_offset elsewhere.
    # Falling back to the bare offset for a page the view does not know about,
    # which happens only if chunks were built from a newer extraction than the
    # one loaded into pages.
    cur.execute(
        "select page_index, printed_page from printed_pages where work_id = %s",
        (work_id,),
    )
    printed = {index: page for index, page in cur.fetchall()}

    def page_of(index: int) -> int:
        return printed.get(index, index + offset)

    missing = sum(
        1
        for c in doc["chunks"]
        if c["start_page_index"] not in printed or c["end_page_index"] not in printed
    )
    if missing:
        print(
            f"  ! {work_id}: {missing} chunks name a page that is not in the pages"
            " table; load_pages.py may be behind chunk.py"
        )

    cur.execute("delete from chunks where work_id = %s", (work_id,))
    cur.executemany(
        """
        insert into chunks
          (work_id, start_page, end_page, lang, text, text_search,
           chunker_version, section_type)
        values (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        [
            (
                work_id,
                page_of(c["start_page_index"]),
                page_of(c["end_page_index"]),
                c["lang"],
                c["text"],
                c["text_search"],
                doc["chunker_version"],
                # A printed page below 1 is front matter: half-title, title,
                # copyright, contents, dedication. Those chunks were competing
                # with the body in every search — Adorno's table of contents
                # came back second for a question about the right to narrate,
                # and its copyright page sixth. Marking them costs nothing now
                # that the offsets are trustworthy, and search excludes them.
                "front" if page_of(c["start_page_index"]) < 1 else None,
            )
            for c in doc["chunks"]
        ],
    )
    return len(doc["chunks"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("work", nargs="*", help="work ids, or a substring of one")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    files = sorted(CHUNKS.glob("*.json"))
    if args.work:
        wanted = {resolve(n) for n in args.work}
        files = [f for f in files if f.stem in wanted]

    mapped = set(work_ids())
    for f in files:
        if f.stem not in mapped:
            print(f"  {f.stem}: not in mapping.csv, skipped")
    files = [f for f in files if f.stem in mapped]
    if not files:
        sys.exit("nothing to load")

    if args.dry_run:
        for f in files:
            doc = json.loads(f.read_text(encoding="utf-8"))
            print(f"  {f.stem:<52} {len(doc['chunks']):>5} chunks")
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
            print(f"  {work_id:<52} {n:>5} chunks")

    print(f"\n  {total:,} chunks loaded, no embeddings yet")


if __name__ == "__main__":
    main()
