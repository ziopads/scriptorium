#!/usr/bin/env python3
"""Search the embedded chunks from the command line.

    python3 pipeline/search.py "la conquista como escritura"
    python3 pipeline/search.py "possession and narrative" --k 15
    python3 pipeline/search.py "curanderismo" --work gonzales
    python3 pipeline/search.py "brujas" --lang spanish
    python3 pipeline/search.py "ghosts" --full        # whole chunk, not a snippet

Why this exists before the MCP server: the cross-lingual claim for voyage-4 is
the thing the whole retrieval design rests on, and it has never been tested.
A Spanish thesis should find the English books. If it does not, the model
choice was wrong and better to know now than in October.

This is also the body of the server's `search` tool. Whatever proves right
here moves there.

Queries are embedded with input_type='query' against documents embedded with
input_type='document', which is what embed.py wrote and what the asymmetry is
for. Ordering is cosine distance; the score printed is 1 - distance, so 1.0 is
identical and 0 is unrelated.

Requires VOYAGE_API_KEY (environment or .env.local) and the chunks embedded.
"""

from __future__ import annotations

import argparse
import re
import sys
import textwrap

from dbconn import connect, resolve
from embed import DEFAULT_DIM, DEFAULT_MODEL, api_key


def embed_query(text: str, model: str, dim: int) -> list[float]:
    try:
        import voyageai
    except ImportError:
        sys.exit("voyageai is not installed. Run: pipeline/.venv/bin/pip install voyageai")
    client = voyageai.Client(api_key=api_key())
    result = client.embed([text], model=model, input_type="query", output_dimension=dim)
    return result.embeddings[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("query", help="in any language; the corpus is English and Spanish")
    parser.add_argument("--k", type=int, default=10, help="results to return")
    parser.add_argument("--work", action="append", help="work id or a substring; repeatable")
    parser.add_argument("--lang", choices=["english", "spanish"])
    parser.add_argument(
        "--front",
        action="store_true",
        help="include front matter, which is excluded by default",
    )
    parser.add_argument("--full", action="store_true", help="print the whole chunk")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dim", type=int, default=DEFAULT_DIM)
    args = parser.parse_args()

    works = [resolve(n) for n in args.work] if args.work else None

    vector = embed_query(args.query, args.model, args.dim)

    where = ["c.embedding is not null"]
    params: dict = {"vec": str(vector), "k": args.k}
    # Title pages, copyright pages and tables of contents are close to any
    # query about a book's subject, because they list it. Out unless asked for.
    if not args.front:
        where.append("c.section_type is distinct from 'front'")
    if works:
        where.append("c.work_id = any(%(works)s)")
        params["works"] = works
    if args.lang:
        where.append("c.lang = %(lang)s")
        params["lang"] = args.lang

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                select w.author, w.title, c.start_page, c.end_page, c.lang,
                       1 - (c.embedding <=> %(vec)s::vector) as score,
                       c.text
                from chunks c
                join works w on w.id = c.work_id
                where {' and '.join(where)}
                order by c.embedding <=> %(vec)s::vector
                limit %(k)s
                """,
                params,
            )
            rows = cur.fetchall()

    if not rows:
        print("  nothing found")
        return

    print(f'\n  "{args.query}"\n')
    for author, title, start, end, lang, score, text in rows:
        pages = f"p. {start}" if start == end else f"pp. {start}\u2013{end}"
        who = (author or "").split(",")[0] or "\u2014"
        print(f"  {score:.3f}  {who}, {title[:46]}  {pages}  {lang}")
        body = text if args.full else re.sub(r"\s+", " ", text)[:320] + "\u2026"
        for line in textwrap.wrap(body, width=86):
            print(f"         {line}")
        print()


if __name__ == "__main__":
    main()
