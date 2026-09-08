#!/usr/bin/env python3
"""Triage a folder of PDFs before any extraction is written.

Answers three questions, in order of how much they block:

  1. How many of these have a usable text layer, and how many are scans that
     need optical character recognition? This decides the schedule. A corpus
     that is mostly text-layer is a weekend; one that is mostly scans is weeks
     of OCR and quality checking.

  2. How big is the corpus, really? Every estimate so far has come from the
     original handoff's guess. Page counts and character counts replace it.

  3. Which files are broken, encrypted, or not what they claim to be?

Reads nothing but the files. Writes one CSV and prints a summary. No database,
no network, no API key.

    python3 pipeline/triage.py ~/path/to/pdfs

Output lands in pipeline/triage.csv with an empty book_id column. Filling that
in is a human pass — it is what binds a file to a catalogue record, and every
citation downstream depends on it being right.
"""

import csv
import statistics
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF is not installed. Run: pip install pymupdf")


# A page with fewer than this many characters is either an image, a plate, or a
# blank. Chosen low on purpose: a chapter-opening page with a single line of
# text is legitimate, and misclassifying it as a scan would be worse than
# letting a few blanks through.
SPARSE_PAGE_CHARS = 50

# Median characters per page above which the file is treated as having a real
# text layer. A typical trade paperback page runs 1,800 to 2,500 characters.
TEXT_LAYER_MEDIAN = 400


def classify(median_chars: float, sparse_ratio: float, pages: int) -> str:
    if pages == 0:
        return "empty"
    if median_chars >= TEXT_LAYER_MEDIAN and sparse_ratio < 0.2:
        return "pdf_text"
    if median_chars < SPARSE_PAGE_CHARS:
        return "pdf_ocr_needed"
    return "mixed"


def inspect(path: Path) -> dict:
    row = {
        "filename": path.name,
        "book_id": "",           # filled in by hand
        "classification": "",
        "pages": 0,
        "chars_total": 0,
        "chars_per_page_median": 0,
        "sparse_pages": 0,
        "sparse_ratio": 0.0,
        "mb": round(path.stat().st_size / 1_048_576, 1),
        "pdf_title": "",
        "pdf_author": "",
        "encrypted": "",
        "problem": "",
    }

    try:
        doc = fitz.open(path)
    except Exception as exc:                      # noqa: BLE001
        row["problem"] = f"could not open: {exc}"
        row["classification"] = "unreadable"
        return row

    with doc:
        if doc.needs_pass:
            row["encrypted"] = "yes"
            row["classification"] = "encrypted"
            row["problem"] = "password required"
            return row

        meta = doc.metadata or {}
        row["pdf_title"] = (meta.get("title") or "").strip()
        row["pdf_author"] = (meta.get("author") or "").strip()
        row["pages"] = doc.page_count

        counts = []
        for page in doc:
            try:
                counts.append(len(page.get_text("text").strip()))
            except Exception:                     # noqa: BLE001
                counts.append(0)

    if not counts:
        row["classification"] = "empty"
        return row

    sparse = sum(1 for c in counts if c < SPARSE_PAGE_CHARS)

    row["chars_total"] = sum(counts)
    row["chars_per_page_median"] = int(statistics.median(counts))
    row["sparse_pages"] = sparse
    row["sparse_ratio"] = round(sparse / len(counts), 2)
    row["classification"] = classify(
        row["chars_per_page_median"], row["sparse_ratio"], row["pages"]
    )

    return row


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(f"usage: {sys.argv[0]} <folder-of-pdfs>")

    folder = Path(sys.argv[1]).expanduser()
    if not folder.is_dir():
        sys.exit(f"not a directory: {folder}")

    pdfs = sorted(p for p in folder.rglob("*.pdf") if not p.name.startswith("."))
    if not pdfs:
        sys.exit(f"no PDFs under {folder}")

    print(f"Inspecting {len(pdfs)} files under {folder}\n")

    rows = []
    for path in pdfs:
        row = inspect(path)
        rows.append(row)
        flag = "  " if row["classification"] == "pdf_text" else "! "
        print(
            f"{flag}{row['classification']:<16} "
            f"{row['pages']:>5}p  "
            f"{row['chars_per_page_median']:>6} ch/p  "
            f"{row['filename'][:64]}"
        )

    out = Path(__file__).parent / "triage.csv"
    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    # ----------------------------------------------------------------- summary
    by_class: dict[str, int] = {}
    for row in rows:
        by_class[row["classification"]] = by_class.get(row["classification"], 0) + 1

    pages = sum(r["pages"] for r in rows)
    chars = sum(r["chars_total"] for r in rows)
    ocr_pages = sum(
        r["pages"] for r in rows if r["classification"] in {"pdf_ocr_needed", "mixed"}
    )

    print(f"\n{'-' * 60}")
    for name, count in sorted(by_class.items(), key=lambda kv: -kv[1]):
        print(f"  {name:<16} {count:>3} files")

    print(f"\n  {pages:,} pages total")
    print(f"  {chars:,} characters already extractable")
    print(f"  ~{chars // 4:,} tokens, ~{chars / 1_048_576:.0f} MB of text")
    print(f"  {ocr_pages:,} pages need OCR")

    # ocrmypdf on a laptop runs on the order of a second per page.
    print(f"  roughly {ocr_pages / 3600:.1f} hours of OCR at 1 page/second")
    print(f"\nWrote {out}")
    print("Next: fill in book_id for each row. That mapping is what binds a")
    print("file to a catalogue record, and every citation depends on it.")


if __name__ == "__main__":
    main()
