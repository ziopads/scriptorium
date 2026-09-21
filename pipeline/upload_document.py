#!/usr/bin/env python3
"""Put a file into the documents table (migration 015), for the app to serve.

    python3 pipeline/upload_document.py --dry-run exam-list "/path/to/list.pdf"
    python3 pipeline/upload_document.py exam-list "/path/to/list.pdf"

The first argument is the name the app asks for; 'exam-list' is the exam list
the list page offers for download (app/lists/exam-list/route.ts). Uploading
under a name that exists replaces that document, which is how a new version of
the list goes in: no commit, no deploy.

The file never enters the repository. It carries her name and the structure of
her dissertation, and the repository is on GitHub.
"""

from __future__ import annotations

import argparse
import mimetypes
import sys
from pathlib import Path

from dbconn import connect

# Neon's HTTP driver, which the app reads through, answers in one response.
# The exam list is a few hundred kilobytes; anything near this is a mistake.
MAX_BYTES = 8 * 1024 * 1024


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("name", help="the name the app asks for, e.g. exam-list")
    parser.add_argument("path", help="the file to upload")
    parser.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = parser.parse_args()

    path = Path(args.path).expanduser()
    if not path.is_file():
        sys.exit(f"no file at {path}")
    data = path.read_bytes()
    if len(data) > MAX_BYTES:
        sys.exit(f"{path.name} is {len(data):,} bytes; the limit is {MAX_BYTES:,}")
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select filename, size, uploaded_at from documents where id = %s",
                (args.name,),
            )
            existing = cur.fetchone()

        state = (
            f"replace {existing[0]} ({existing[1]:,} bytes, uploaded {existing[2]:%Y-%m-%d})"
            if existing else "insert"
        )
        print(f"  {args.name}: {state}")
        print(f"    with {path.name} ({len(data):,} bytes, {content_type})")

        if args.dry_run:
            print("\n  dry run: nothing written")
            return

        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into documents (id, filename, content_type, bytes, size, uploaded_at)
                    values (%s, %s, %s, %s, %s, now())
                    on conflict (id) do update set
                      filename = excluded.filename, content_type = excluded.content_type,
                      bytes = excluded.bytes, size = excluded.size, uploaded_at = now()
                    """,
                    (args.name, path.name, content_type, data, len(data)),
                )
    print(f"\n  {args.name} stored")


if __name__ == "__main__":
    main()
