#!/usr/bin/env python3
"""Harvest ISBNs from the corpus PDFs.

    python3 pipeline/isbns.py            # every PDF in pipeline/corpus
    python3 pipeline/isbns.py --show     # print context lines as well

Reads the PDFs directly rather than the extracted pages, so it works on the
whole corpus before anything has been extracted. Writes pipeline/isbns.csv.

KEYED BY FILENAME, NOT BOOK ID
    Same reasoning as triage.csv: the reading list is being re-seeded and work
    ids will move. A harvest keyed to filenames survives that and joins through
    mapping.csv, which is the durable record.

WHICH ISBN TO CITE
    A copyright page normally prints several — cloth, paper, ebook, sometimes a
    PDF-specific one. They identify different objects. The one to cite is the
    print edition whose folios she is quoting, because that is the pagination
    page_offset maps to. So every candidate is captured with the words around
    it, and a guess at its kind, rather than the first match winning.

    An essay does not get its own ISBN. It borrows its container's, which is
    what the container-aware citation already does.

VALIDATION
    Both ISBN forms carry a check digit, so a candidate can be verified rather
    than merely matched. That is what separates a real ISBN from a Library of
    Congress control number, a phone number, or a barcode caption. Anything
    failing its checksum is discarded silently.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF is not installed. Run: pip install pymupdf")

PIPELINE = Path(__file__).parent
CORPUS = PIPELINE / "corpus"
OUT = PIPELINE / "isbns.csv"

# Copyright pages sit in the front matter; some presses repeat the ISBN on the
# last page or the back cover.
FRONT_PAGES = 14
BACK_PAGES = 6

CANDIDATE = re.compile(r"(?<![\d-])((?:97[89][\d\s-]{10,17}|[\dX][\d\s-]{8,16}))(?![\d-])", re.I)

KIND_HINTS = [
    ("ebook", ("ebook", "e-book", "electronic", "digital", "online")),
    ("pdf", ("pdf",)),
    ("epub", ("epub",)),
    ("paper", ("paperback", "pbk", "paper", "rústica", "rustica", "softcover")),
    ("cloth", ("hardcover", "hardback", "hbk", "cloth", "tapa dura", "encuadernado")),
]


def digits_of(raw: str) -> str:
    return re.sub(r"[^\dXx]", "", raw).upper()


def valid_isbn10(value: str) -> bool:
    if len(value) != 10:
        return False
    total = 0
    for i, char in enumerate(value):
        if char == "X":
            if i != 9:
                return False
            digit = 10
        elif char.isdigit():
            digit = int(char)
        else:
            return False
        total += digit * (10 - i)
    return total % 11 == 0


def valid_isbn13(value: str) -> bool:
    if len(value) != 13 or not value.isdigit():
        return False
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(value))
    return total % 10 == 0


def to_isbn13(value: str) -> str | None:
    """Canonical form. A 10-digit ISBN converts by prefixing 978 and recomputing
    the check digit, so one column can hold both and comparisons work."""
    if valid_isbn13(value):
        return value
    if valid_isbn10(value):
        body = "978" + value[:9]
        total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(body))
        return body + str((10 - total % 10) % 10)
    return None


def guess_kind(context: str) -> str:
    lowered = context.lower()
    for label, needles in KIND_HINTS:
        if any(needle in lowered for needle in needles):
            return label
    return ""


def scan_text(text: str, where: str) -> list[dict]:
    found = []
    for match in CANDIDATE.finditer(text):
        canonical = to_isbn13(digits_of(match.group(1)))
        if not canonical:
            continue

        start = max(0, match.start() - 70)
        context = " ".join(text[start : match.end() + 40].split())

        found.append(
            {
                "isbn13": canonical,
                "raw": match.group(1).strip(),
                "kind": guess_kind(context),
                "where": where,
                "context": context,
            }
        )
    return found


def scan_pdf(path: Path) -> list[dict]:
    found: list[dict] = []

    # The filename is a source in its own right: many of these downloads carry
    # "isbn13 9788413775821" in the name, which is often the cleanest evidence
    # in the whole file.
    found.extend(scan_text(path.name, "filename"))

    try:
        doc = fitz.open(path)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! {path.name[:60]}: {exc}")
        return found

    with doc:
        if doc.needs_pass:
            return found

        pages = doc.page_count
        indices = list(range(min(FRONT_PAGES, pages)))
        indices += [i for i in range(max(0, pages - BACK_PAGES), pages) if i not in indices]

        for index in indices:
            try:
                text = doc[index].get_text("text")
            except Exception:  # noqa: BLE001
                continue
            found.extend(scan_text(text, f"p{index + 1}"))

    return found


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--show", action="store_true", help="print context lines")
    args = parser.parse_args()

    if not CORPUS.is_dir():
        sys.exit(f"{CORPUS} not found")

    pdfs = sorted(p for p in CORPUS.rglob("*.pdf") if not p.name.startswith("."))
    if not pdfs:
        sys.exit(f"no PDFs under {CORPUS}")

    rows = []
    without = []

    for path in pdfs:
        hits = scan_pdf(path)

        # One row per distinct ISBN, keeping the most informative sighting: a
        # labelled one beats an unlabelled one, and the copyright page beats the
        # filename because it says which binding.
        best: dict[str, dict] = {}
        for hit in hits:
            existing = best.get(hit["isbn13"])
            if existing is None or (not existing["kind"] and hit["kind"]):
                best[hit["isbn13"]] = hit

        if not best:
            without.append(path.name)
            continue

        for hit in best.values():
            rows.append(
                {
                    "filename": path.name,
                    "isbn13": hit["isbn13"],
                    "kind": hit["kind"],
                    "found_in": hit["where"],
                    "as_printed": hit["raw"],
                    "context": hit["context"],
                }
            )

        labels = ", ".join(
            f"{h['isbn13']}{' (' + h['kind'] + ')' if h['kind'] else ''}"
            for h in best.values()
        )
        print(f"  {path.name[:52]:<52} {labels}")
        if args.show:
            for hit in best.values():
                print(f"      {hit['where']}: …{hit['context'][:96]}…")

    with OUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["filename", "isbn13", "kind", "found_in", "as_printed", "context"],
        )
        writer.writeheader()
        writer.writerows(rows)

    multiple = len({r["filename"] for r in rows if
                    sum(1 for x in rows if x["filename"] == r["filename"]) > 1})

    print(f"\n  {len(rows)} validated ISBNs across {len({r['filename'] for r in rows})} files")
    print(f"  {multiple} files print more than one — pick the print edition, not the ebook")

    if without:
        print(f"\n  {len(without)} files with no valid ISBN:")
        for name in without:
            print(f"    {name[:78]}")
        print("  Pre-ISBN editions, scans missing the copyright page, and excerpts.")

    print(f"\n  Wrote {OUT}")


if __name__ == "__main__":
    main()
