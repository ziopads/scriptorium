"""Shared plumbing for the loaders: the connection string, and the map from the
pipeline's book ids to the catalogue's work ids.

Read DATABASE_URL_UNPOOLED from .env.local at the repo root. The unpooled string
is required: each loader replaces one work's rows inside a single transaction,
which the pooled endpoint does not guarantee.

Nothing here prints a connection string, ever.
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


def work_ids() -> dict[str, str]:
    """book_id (pipeline) -> work_id (catalogue), from mapping.csv. Rows with an
    empty work_id are unmapped and the loaders refuse them by name rather than
    guessing."""
    out: dict[str, str] = {}
    with MAPPING.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            book_id = (row.get("book_id") or "").strip()
            work_id = (row.get("work_id") or "").strip()
            if book_id and work_id:
                out[book_id] = work_id
    return out


def resolve(book_id: str) -> str:
    mapping = work_ids()
    if book_id not in mapping:
        sys.exit(
            f"{book_id}: no work_id in pipeline/mapping.csv. Add the catalogue id "
            f"to that row (it is the id on the work's page under Record)."
        )
    return mapping[book_id]
