"""Shared plumbing for the pipeline: the connection string, and the map from a
file in the corpus to the catalogue work it is.

Read DATABASE_URL_UNPOOLED from .env.local at the repo root. The unpooled string
is required: each loader replaces one work's rows inside a single transaction,
which the pooled endpoint does not guarantee.

Nothing here prints a connection string, ever.

ONE KEY, NOT TWO

    There used to be a pipeline book_id alongside the catalogue work_id, and
    every script existed partly to translate between them. The book_id came
    from a filename, the work_id from a bibliography, and they disagreed
    whenever the two named different people:

        file       "Cuentos_ Tales from the Hispanic Southwest -- … Griego …"
        book_id    anaya-cuentos-hispanic-southwest-1980
        work_id    griego-y-maestas-cuentos-tales-from-the-hispanic-1980

    Nothing connected them but a column, and where that column was empty there
    was no way from one to the other but guesswork. So the book_id is gone.
    mapping.csv is now match → work_id, the JSON files are named for the work,
    and the catalogue id is the only identifier in the pipeline.

    Work ids are long, so every script takes a substring instead: `anzaldua`,
    `lotman`, `saldana`. An ambiguous one lists what it matched and stops.
"""

from __future__ import annotations

import csv
import os
import re
import sys
from pathlib import Path

PIPELINE = Path(__file__).parent
ROOT = PIPELINE.parent
MAPPING = PIPELINE / "mapping.csv"
BOOKS = ROOT / "books.csv"


def database_url() -> str:
    value = os.environ.get("DATABASE_URL_UNPOOLED")
    if not value:
        env = ROOT / ".env.local"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                m = re.match(r'^\s*DATABASE_URL_UNPOOLED\s*=\s*"?([^"\s]+)"?\s*$', line)
                if m:
                    value = m.group(1)
                    break
    if not value:
        sys.exit("DATABASE_URL_UNPOOLED is not set and was not found in .env.local")
    return value


def connect():
    try:
        import psycopg
    except ImportError:
        sys.exit('psycopg is not installed. Run: .venv/bin/pip install "psycopg[binary]"')
    return psycopg.connect(database_url())


def books() -> dict[str, dict]:
    """work_id -> {matches: [str], note: str}, from books.csv and mapping.csv.

    books.csv is the register a person edits: one row per book on the lists,
    with the filename of its PDF in the pdf column. A filename there is the
    decision, and it wins — exactly, by name, with no matching.

    mapping.csv holds match strings, which is how most works were mapped before
    books.csv existed. Still read, so nothing that works today stops working.

    A work in neither is skipped here and reported by status.py, because a file
    nobody has identified should be visible rather than silently processed."""
    out: dict[str, dict] = {}

    if MAPPING.exists():
        with MAPPING.open(encoding="utf-8") as handle:
            rows = csv.DictReader(l for l in handle if not l.lstrip().startswith("#"))
            for row in rows:
                work_id = (row.get("work_id") or "").strip()
                match = (row.get("match") or "").strip()
                if not work_id or not match:
                    continue
                entry = out.setdefault(work_id, {"matches": [], "note": ""})
                entry["matches"].append(match)
                if (row.get("note") or "").strip():
                    entry["note"] = row["note"].strip()

    if BOOKS.exists():
        # utf-8-sig: inventory.py writes books.csv with a byte-order mark so a
        # spreadsheet reads it as UTF-8 instead of guessing. Reading it back
        # without -sig puts the mark on the first column name.
        with BOOKS.open(encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                work_id = (row.get("work_id") or "").strip()
                pdf = (row.get("pdf") or "").strip()
                if not work_id or not pdf:
                    continue
                entry = out.setdefault(work_id, {"matches": [], "note": ""})
                # Replaces rather than adds: a filename typed into books.csv is
                # a decision about which file this book is, not another guess to
                # put alongside the old one.
                entry["matches"] = [f.strip() for f in pdf.split("|") if f.strip()]
                if (row.get("note") or "").strip():
                    entry["note"] = row["note"].strip()

    return out


def work_ids() -> list[str]:
    return sorted(books())


def resolve(needle: str) -> str:
    """A work id from a substring of one. Exact wins; otherwise a single
    substring match wins; anything else prints the candidates and stops, since
    guessing which book someone meant is how the wrong one gets re-embedded."""
    ids = work_ids()
    if needle in ids:
        return needle

    folded = needle.casefold()
    hits = [i for i in ids if folded in i.casefold()]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        sys.exit(
            f"{needle!r} matches no work in pipeline/mapping.csv.\n"
            f"    pipeline/status.py lists every book and its catalogue id."
        )
    listing = "\n      ".join(hits)
    sys.exit(f"{needle!r} matches {len(hits)} works:\n      {listing}\n    Be more specific.")


def resolve_all(needles: list[str]) -> list[str]:
    """Every work when nothing is named \u2014 which is how twenty books once got
    extracted in one afternoon, so the caller should say what it is about to
    do."""
    return [resolve(n) for n in needles] if needles else work_ids()
