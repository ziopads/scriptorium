#!/usr/bin/env python3
"""Load pipeline/chunks/*.json into the chunks table, with no embeddings.

    python3 pipeline/load_chunks.py                    # every mapped chunk file
    python3 pipeline/load_chunks.py rael-cuentos-espanoles-1977
    python3 pipeline/load_chunks.py --dry-run

One work per transaction: its chunks are deleted and reinserted. start_page
and end_page are PRINTED pages, as the schema requires: the page index from
the chunk file plus works.page_offset read from the catalogue at load time.
If the offset is later corrected, rerun this for that work.

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


def load_one(cur, book_id: str, work_id: str, doc: dict) -> int:
    cur.execute("select page_offset from works where id = %s", (work_id,))
    row = cur.fetchone()
    if row is None:
        sys.exit(f"{book_id}: work_id {work_id} is not in the works table")
    offset = row[0]

    cur.execute("delete from chunks where work_id = %s", (work_id,))
    cur.executemany(
        """
        insert into chunks
          (work_id, start_page, end_page, lang, text, text_search, chunker_version)
        values (%s, %s, %s, %s, %s, %s, %s)
        """,
        [
            (
                work_id,
                c["start_page_index"] + offset,
                c["end_page_index"] + offset,
                c["lang"],
                c["text"],
                c["text_search"],
                doc["chunker_version"],
            )
            for c in doc["chunks"]
        ],
    )
    return len(doc["chunks"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("book_id", nargs="*")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    files = sorted(CHUNKS.glob("*.json"))
    if args.book_id:
        wanted = set(args.book_id)
        files = [f for f in files if f.stem in wanted]
        missing = wanted - {f.stem for f in files}
        if missing:
            sys.exit(f"no chunk file for: {', '.join(sorted(missing))}")

    mapped = work_ids()
    for f in files:
        if f.stem not in mapped:
            print(f"  {f.stem}: no work_id in mapping.csv, skipped")
    files = [f for f in files if f.stem in mapped]
    if not files:
        sys.exit("nothing to load")

    if args.dry_run:
        for f in files:
            doc = json.loads(f.read_text(encoding="utf-8"))
            print(f"  {f.stem:<44} -> {mapped[f.stem]:<52} {len(doc['chunks']):>5} chunks")
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
            print(f"  {book_id:<44} -> {work_id:<52} {n:>5} chunks")

    print(f"\n  {total:,} chunks loaded, no embeddings yet")


if __name__ == "__main__":
    main()
