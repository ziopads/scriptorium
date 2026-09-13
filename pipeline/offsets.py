#!/usr/bin/env python3
"""Propose a page_offset for each extracted book by reading its printed folios.

    python3 pipeline/extract.py            # first pass, offsets all zero
    python3 pipeline/offsets.py            # read the folios, propose offsets
    # put the accepted values in mapping.csv, then:
    python3 pipeline/extract.py            # second pass, offsets applied

Reads pipeline/pages/*.json. Writes nothing: it prints proposals and the
evidence for them, and the numbers go into mapping.csv by hand.

WHY NOT WRITE THEM DIRECTLY
    page_offset is what makes every citation in the project right or wrong. A
    number arrived at by pattern-matching, applied without anyone looking, is
    the kind of error that surfaces at a defence rather than in a test. So this
    proposes, and a person accepts.

HOW IT WORKS
    extract.py records the printed folio on each page, read before running heads
    are stripped. It has to be captured there: a bare page number masks to "#",
    repeats on every page, and is removed as furniture; and a folio set inside a
    running head goes when the head does.

    The offset a page implies is (folio - file page). Confidence is agreement
    among pages WHERE A FOLIO WAS FOUND, not among all pages — a book whose
    folios are only legible on half its pages can still have an unambiguous
    offset, and dividing by the page count would reject it.

    Offsets are reported as contiguous runs. A book with one numbering sequence
    produces one long run. Two runs separated by a constant difference mean an
    unnumbered insert — a plate section, or front matter counted differently —
    after which every folio shifts. Those books cannot be described by a single
    page_offset, and saying so is more useful than averaging them.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

PIPELINE = Path(__file__).parent
PAGES = PIPELINE / "pages"

# Agreement among found folios, above which a single offset is trustworthy.
CONFIDENT = 0.9

# Fewer folios than this is not evidence, however consistent they look.
MIN_FOLIOS = 8

# Runs shorter than this are stray matches — a number that happened to sit
# alone on a line — rather than a numbering sequence.
MIN_RUN = 5


def measure(document: dict) -> dict:
    observations = []
    for page in document["pages"]:
        folio = page.get("folio")
        if folio is not None:
            observations.append((page["page"], folio - page["page"]))

    diffs = Counter(diff for _, diff in observations)

    # Contiguous stretches sharing one offset, in page order. Pages where no
    # folio was read do not end a run — only a change of offset does, which is
    # the thing worth seeing.
    runs: list[list[int]] = []  # [offset, first_page, last_page]
    for page, diff in observations:
        if runs and runs[-1][0] == diff:
            runs[-1][2] = page
        else:
            runs.append([diff, page, page])

    return {
        "found": len(observations),
        "total": len(document["pages"]),
        "diffs": diffs,
        "runs": [tuple(r) for r in runs if r[2] - r[1] >= MIN_RUN],
        "example": next(
            ((p, p + d) for p, d in observations if d == (diffs.most_common(1)[0][0] if diffs else None)),
            None,
        ),
    }


def main() -> None:
    if not PAGES.is_dir():
        sys.exit(f"{PAGES} not found. Run extract.py first.")

    files = sorted(PAGES.glob("*.json"))
    if not files:
        sys.exit(f"no extracted books in {PAGES}")

    accept: list[tuple[str, int]] = []

    for path in files:
        document = json.loads(path.read_text(encoding="utf-8"))
        book_id = document["book_id"]
        m = measure(document)

        print(f"\n  {book_id}")
        print(f"    {m['found']} folios read from {m['total']} pages")

        if m["found"] < MIN_FOLIOS:
            print("    not enough evidence — open the PDF and read one page number")
            continue

        offset, agreeing = m["diffs"].most_common(1)[0]
        confidence = agreeing / m["found"]

        for run_offset, first, last in m["runs"]:
            print(f"    offset {run_offset:+5d}  file pages {first}–{last}")

        if m["example"]:
            page, folio = m["example"]
            print(f"    file p.{page} prints {folio}")

        if len(m["runs"]) > 1 and len({r[0] for r in m["runs"]}) > 1:
            print(
                "    ! more than one numbering sequence. A single page_offset "
                "cannot describe this book —"
            )
            print(
                "      an unnumbered insert shifts every folio after it. Check "
                "the PDF before accepting."
            )
            continue

        if confidence >= CONFIDENT:
            print(f"    {confidence:.0%} agreement — proposing {offset:+d}")
            if offset != document.get("page_offset", 0):
                accept.append((book_id, offset))
        else:
            spread = ", ".join(
                f"{d:+d} on {n}" for d, n in m["diffs"].most_common(4)
            )
            print(f"    only {confidence:.0%} agreement: {spread}")
            print("    open the PDF and read one page number")

    if accept:
        print("\n  Add a page_offset column to mapping.csv with these values:\n")
        for book_id, offset in accept:
            print(f"    {book_id}: {offset}")

    print("\n  An offset is wrong silently. Check one against the PDF.")


if __name__ == "__main__":
    main()
