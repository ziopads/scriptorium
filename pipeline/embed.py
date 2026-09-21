#!/usr/bin/env python3
"""Embed chunks that have no embedding yet.

    python3 pipeline/embed.py --pending 5 --list I # checked works with unembedded chunks
    python3 pipeline/embed.py <work id> ...        # named works, by full id
    python3 pipeline/embed.py --dry-run --pending 5  # count, no API call
    python3 pipeline/embed.py --model voyage-4-large --dim 1024 <work id>

This is the stage that costs money, so it is the one where naming the works
matters most. With no work named and no --pending it refuses. A work whose page
numbering offsets.py could not settle is skipped, named or not.

Idempotent and resumable: it selects rows where embedding is null (or where
embedding_model differs from the requested model, with --replace), embeds
them in batches, and writes each batch in its own transaction. Interrupt it
and rerun; it picks up where it stopped.

The model and dimension are stamped on every row (embedding_model,
embedding_dim). The column's declared dimension must match --dim; the
migration comment in db/006 has the alter for that.

Requires VOYAGE_API_KEY in the environment or .env.local, the voyageai
package in the venv, and the chunks already loaded by load_chunks.py.
Documents are embedded with input_type='document'; the application embeds
queries with input_type='query'. Both matter for retrieval quality and the
application side must use the same model family.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path

from dbconn import announce_pending, connect, pending, resolve, skip_offset_problems

DEFAULT_MODEL = "voyage-4"
DEFAULT_DIM = 1024
BATCH = 64            # texts per request; ~3,500 chars each keeps a batch well under the token cap

ROOT = Path(__file__).parent.parent


def api_key() -> str:
    value = os.environ.get("VOYAGE_API_KEY")
    if not value:
        env = ROOT / ".env.local"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                m = re.match(r'^\s*VOYAGE_API_KEY\s*=\s*"?([^"\s]+)"?\s*$', line)
                if m:
                    value = m.group(1)
                    break
    if not value:
        sys.exit("VOYAGE_API_KEY is not set and was not found in .env.local")
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("work", nargs="*", help="full work ids")
    parser.add_argument(
        "--pending",
        type=int,
        metavar="N",
        help="the next N checked works with chunks not yet embedded",
    )
    parser.add_argument(
        "--list",
        dest="which",
        metavar="CODE",
        help="limit --pending to a list or section: I, II, II.C, Supl. III",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dim", type=int, default=DEFAULT_DIM)
    parser.add_argument("--replace", action="store_true",
                        help="also re-embed rows already embedded with a different model")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.pending and args.work:
        parser.error("--pending chooses the works itself; do not also name works")
    if not args.pending and not args.work:
        parser.error("name the works by full id, or use --pending N")

    if args.pending:
        works = pending("embed", args.pending, args.which)
        if not works:
            print("  nothing pending — no checked work has unembedded chunks")
            return
    else:
        works = skip_offset_problems([resolve(n) for n in args.work])
        if not works:
            print("  nothing to embed")
            return

    with connect() as conn:
        with conn.cursor() as cur:
            # The column's declared dimension, to fail before the first call
            # rather than on the first write.
            cur.execute("""
                select atttypmod from pg_attribute
                where attrelid = 'chunks'::regclass and attname = 'embedding'
            """)
            declared = cur.fetchone()[0]
            if declared != args.dim:
                sys.exit(
                    f"chunks.embedding is vector({declared}) but --dim is {args.dim}. "
                    f"Run: alter table chunks alter column embedding type vector({args.dim});"
                )

            if args.pending:
                cur.execute(
                    "select distinct work_id from chunks where work_id = any(%s)",
                    (works,),
                )
                works = announce_pending(
                    works,
                    {row[0] for row in cur.fetchall()},
                    "no chunks in the database — run load_chunks.py for it first",
                )
                if not works:
                    print("  nothing to embed")
                    return

            where = "embedding is null" if not args.replace else \
                    "(embedding is null or embedding_model is distinct from %(model)s)"
            params = {"model": args.model, "works": works}
            where += " and work_id = any(%(works)s)"
            cur.execute(f"select count(*) from chunks where {where}", params)
            todo = cur.fetchone()[0]

        print(f"  {todo:,} chunks to embed with {args.model} at {args.dim} dims")
        if args.dry_run or todo == 0:
            if args.dry_run:
                print("  dry run: no API call made")
            return

        try:
            import voyageai
        except ImportError:
            sys.exit("voyageai is not installed. Run: .venv/bin/pip install voyageai")
        client = voyageai.Client(api_key=api_key())

        done = 0
        started = time.time()
        while True:
            with conn.cursor() as cur:
                cur.execute(
                    f"select id, text from chunks where {where} order by work_id, start_page, id limit %(batch)s",
                    {**params, "batch": BATCH},
                )
                rows = cur.fetchall()
            if not rows:
                break

            ids = [r[0] for r in rows]
            texts = [r[1] for r in rows]
            result = client.embed(
                texts, model=args.model, input_type="document", output_dimension=args.dim,
            )
            vectors = result.embeddings
            if len(vectors) != len(ids):
                sys.exit(f"got {len(vectors)} embeddings for {len(ids)} texts")

            with conn.transaction():
                with conn.cursor() as cur:
                    cur.executemany(
                        """
                        update chunks
                        set embedding = %s::vector, embedding_model = %s, embedding_dim = %s
                        where id = %s
                        """,
                        [(str(v), args.model, args.dim, i) for v, i in zip(vectors, ids)],
                    )
            done += len(ids)
            elapsed = time.time() - started
            print(f"  {done:>6,}/{todo:,}  {elapsed:5.0f}s", end="\r", flush=True)

        print(f"\n  {done:,} chunks embedded in {time.time() - started:.0f}s")
        print("  When the corpus is larger than a few thousand rows, build the index:")
        print("    create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);")


if __name__ == "__main__":
    main()
