#!/usr/bin/env python3
"""Apply the numbered migrations in db/ and record what has been applied.

    python3 pipeline/migrate.py --status      # what is applied, what is pending
    python3 pipeline/migrate.py --dry-run     # name what would run, change nothing
    python3 pipeline/migrate.py               # apply everything pending
    python3 pipeline/migrate.py --baseline 8  # record 001-008 as already applied

WHY THIS EXISTS

    Nine SQL files were applied by hand in a browser console, and nothing
    anywhere recorded which of them any given database had seen. That is how a
    repository and a database drift apart without anyone noticing, and how a
    deploy comes to assume a column that is not there. On 14 September a view
    was replaced by hand and there was no way to tell, from inside the system,
    whether it had taken.

WHAT COUNTS AS A MIGRATION

    db/[0-9]*.sql, in filename order. Which excludes, deliberately:

      schema.sql        the starting point, before the numbering began
      seed-*.sql        data, not schema, and two of them are gitignored
      link-sources.sql  a one-off

    A migration must be safe to run twice — if not exists, or conflict do
    nothing — because that is what makes recovering from a half-applied state
    possible at all.

THE CHECKSUM

    Each applied file is recorded with a hash of its contents. Editing a file
    that has already run is the mistake that produces a database nobody can
    reason about: the repository says one thing, the database holds another,
    and the two look consistent. The runner refuses and names the file. To
    change applied schema, write the next migration.

TRANSACTIONS

    The runner owns the transaction, so a file that fails halfway leaves
    nothing behind. The existing files wrap themselves in begin/commit, which
    would nest — so a leading begin and a trailing commit are stripped before
    execution. They stay in the files, because being able to paste one into a
    console and have it behave is worth keeping.

Requires DATABASE_URL_UNPOOLED (read from .env.local) and psycopg.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

from dbconn import connect

DB = Path(__file__).parent.parent / "db"

LEADING_BEGIN = re.compile(r"\A\s*begin\s*;", re.IGNORECASE)
TRAILING_COMMIT = re.compile(r"commit\s*;\s*(--[^\n]*\n?|\s)*\Z", re.IGNORECASE)

TABLE = """
create table if not exists schema_migrations (
  filename   text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
)
"""


def migrations() -> list[Path]:
    return sorted(p for p in DB.glob("[0-9]*.sql"))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def body(path: Path) -> str:
    """The file without its own transaction control; the runner supplies that."""
    text = path.read_text(encoding="utf-8")
    text = LEADING_BEGIN.sub("", text, count=1)
    # Only the final commit, and only when the file opened with a begin.
    return TRAILING_COMMIT.sub("", text)


def applied(cur) -> dict[str, str]:
    cur.execute("select filename, checksum from schema_migrations")
    return {row[0]: row[1] for row in cur.fetchall()}


def number(path: Path) -> int:
    match = re.match(r"(\d+)", path.name)
    return int(match.group(1)) if match else 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--baseline",
        type=int,
        metavar="N",
        help="record every migration up to N as applied, without running it; "
        "for a database that already carries them",
    )
    args = parser.parse_args()

    files = migrations()
    if not files:
        sys.exit("no migrations in db/")

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(TABLE)
        conn.commit()

        with conn.cursor() as cur:
            done = applied(cur)

        # A file that ran and has since been edited.
        changed = [
            f for f in files if f.name in done and done[f.name] != digest(f)
        ]
        if changed and not args.baseline:
            print("  These have been applied and then edited:\n")
            for f in changed:
                print(f"    {f.name}")
            sys.exit(
                "\n  The database holds the earlier version. Write the next\n"
                "  migration instead of changing an applied one. If the edit is\n"
                "  only a comment, re-baseline with --baseline."
            )

        pending = [f for f in files if f.name not in done]

        if args.status:
            for f in files:
                mark = "applied " if f.name in done else "PENDING "
                when = done.get(f.name, "")
                print(f"  {mark} {f.name:<32} {when}")
            print(f"\n  {len(done)} applied, {len(pending)} pending")
            return

        if args.baseline is not None:
            stamped = [f for f in files if number(f) <= args.baseline]
            with conn.cursor() as cur:
                for f in stamped:
                    cur.execute(
                        """
                        insert into schema_migrations (filename, checksum)
                        values (%s, %s)
                        on conflict (filename) do update set
                          checksum = excluded.checksum, applied_at = now()
                        """,
                        (f.name, digest(f)),
                    )
            conn.commit()
            print(f"  recorded {len(stamped)} as applied, up to {args.baseline}")
            for f in stamped:
                print(f"    {f.name}")
            print("\n  Nothing was run. Confirm the database really carries these.")
            return

        if not pending:
            print("  Up to date.")
            return

        if args.dry_run:
            for f in pending:
                print(f"  would apply  {f.name}")
            print("\n  dry run: nothing written")
            return

        for f in pending:
            sql = body(f)
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(sql)
                    cur.execute(
                        "insert into schema_migrations (filename, checksum) values (%s, %s)",
                        (f.name, digest(f)),
                    )
            print(f"  applied  {f.name}")

        print(f"\n  {len(pending)} applied")


if __name__ == "__main__":
    main()
