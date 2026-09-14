#!/usr/bin/env python3
"""Extract page text from the mapped PDFs into one JSON file per book.

    python3 pipeline/extract.py                  # every mapped book
    python3 pipeline/extract.py herrera-transmigracion-cuerpos-2013
    python3 pipeline/extract.py --dry-run        # report, write nothing

Output: pipeline/pages/{book_id}.json, keyed by book id rather than filename,
so that no accented, 200-character download name ever propagates past this
boundary. That is the durable artifact. Everything downstream — chunks, vectors,
the database — is derived from it and can be rebuilt without touching a PDF
again.

Deterministic and local. No network, no key, no database. Runs on files and
writes files, so it can be tested by reading its output beside the source (O-4).

WHAT IS REPAIRED, AND WHAT IS LEFT ALONE
    Repaired here: artifacts of typesetting and encoding — ligatures the font
    substituted, line-break hyphenation, decomposed Unicode, runs of whitespace,
    and repeating running heads. None of those are authorial.

    Left alone: accents, typographic quotation marks, capitalisation, and
    everything else the author or editor chose. Search folds accents away in
    chunks.text_search; the verbatim text is what gets quoted in a dissertation,
    and it should read as printed.
"""

# Postpones evaluation of type annotations, so newer syntax like `int | None`
# works on the macOS system Python 3.9 this runs against.
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF is not installed. Run: pip install pymupdf")

PIPELINE = Path(__file__).parent
CORPUS = PIPELINE / "corpus"
MAPPING = PIPELINE / "mapping.csv"
PAGES = PIPELINE / "pages"

# A first or last line appearing on at least this share of pages, once folios
# are masked, is a running head rather than text. Set high enough that a phrase
# repeated in the prose does not qualify.
HEADER_SHARE = 0.25
HEADER_MIN_PAGES = 12

# The share rule catches a head that runs the length of the book. It misses a
# head that changes at every chapter, because a chapter is a small fraction of
# a book: Adorno's "overview" sits at the top of about twenty of 449 pages, or
# four per cent, and survived into the reading pane as a word before the first
# sentence of every page of that chapter.
#
# So a second rule, on absolute count rather than share. A short line, with no
# sentence-ending punctuation, standing first or last on this many pages, is
# furniture. Prose does not repeat a line verbatim eight times in the same
# position. Every removal is printed at the end of the run — read that list
# before loading, because this rule is the one that could take a real line.
CHAPTER_HEAD_MIN = 8
CHAPTER_HEAD_MAX_CHARS = 60

LIGATURES = {
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\ufb05": "st",
    "\ufb06": "st",
}


def fold(value: str) -> str:
    """Accent- and case-insensitive form, for matching only."""
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def clean_page(text: str) -> str:
    # Compose accented characters into single code points. PDF extraction often
    # yields decomposed forms, and a decomposed á will not match a composed one
    # in any later comparison.
    text = unicodedata.normalize("NFC", text)

    for ligature, plain in LIGATURES.items():
        text = text.replace(ligature, plain)

    # Rejoin words broken across a line. The lowercase-only rule keeps genuine
    # compounds intact: "Franco-\nMexican" is a hyphenated word that happened to
    # break at its own hyphen, not a word split by the typesetter.
    text = re.sub(
        r"([a-z\u00e0-\u00ff])-\n([a-z\u00e0-\u00ff])",
        r"\1\2",
        text,
    )

    # Soft hyphens are invisible and break every search that crosses them.
    text = text.replace("\u00ad", "")

    # Trailing spaces on every line, and runs of blank lines beyond a paragraph
    # break, are noise the chunker would otherwise have to reason about.
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def mask_folios(line: str) -> str:
    """A running head differs page to page only by its folio. Mask digits so the
    two forms collapse into one for counting."""
    return re.sub(r"\d+", "#", line).strip()


def find_running_heads(pages: list[str]) -> set[str]:
    if len(pages) < HEADER_MIN_PAGES:
        return set()

    counts: Counter[str] = Counter()
    for text in pages:
        lines = [line for line in text.split("\n") if line.strip()]
        if not lines:
            continue
        counts[mask_folios(lines[0])] += 1
        if len(lines) > 1:
            counts[mask_folios(lines[-1])] += 1

    threshold = len(pages) * HEADER_SHARE
    heads = set()
    for line, count in counts.items():
        if not line or len(line) >= 120:
            continue
        if count >= threshold:
            heads.add(line)
        elif (
            count >= CHAPTER_HEAD_MIN
            and len(line) <= CHAPTER_HEAD_MAX_CHARS
            and not line.rstrip().endswith((".", "!", "?", ":", ";", ","))
        ):
            heads.add(line)
    return heads


def strip_running_heads(text: str, heads: set[str]) -> str:
    lines = text.split("\n")

    while lines and (not lines[0].strip() or mask_folios(lines[0]) in heads):
        lines.pop(0)
    while lines and (not lines[-1].strip() or mask_folios(lines[-1]) in heads):
        lines.pop()

    return "\n".join(lines).strip()


# The printed folio, read BEFORE the running heads are stripped.
#
# This has to happen here and cannot be recovered later, because stripping is
# what destroys it. A bare page number masks to "#", which repeats on every
# page and is therefore removed as furniture; and where the folio is set inside
# the running head — "47 • Red Medicine" — the whole line goes with it.
#
# Two shapes are recognised: a line that is nothing but a number, and a number
# sitting in a line already identified as a running head. Anything from 2000 up
# is a year in a copyright notice rather than a folio.
def folio_from(text: str, heads: set[str]) -> int | None:
    lines = [line for line in text.split("\n") if line.strip()]
    if not lines:
        return None

    for line in (lines[0], lines[-1]):
        stripped = line.strip()

        if re.fullmatch(r"\d{1,4}", stripped):
            value = int(stripped)
            if 0 < value < 2000:
                return value

        if mask_folios(line) in heads:
            for run in re.findall(r"\d{1,4}", stripped):
                value = int(run)
                if 0 < value < 2000:
                    return value

    return None


def read_mapping() -> dict[str, dict]:
    """book_id -> {files: [...], page_offset: int}"""
    with MAPPING.open(encoding="utf-8") as handle:
        rules = [r for r in csv.DictReader(handle) if r["match"].strip()]

    pdfs = sorted(p for p in CORPUS.rglob("*.pdf") if not p.name.startswith("."))

    books: dict[str, dict] = {}
    for rule in rules:
        book_id = rule["book_id"].strip()
        if not book_id:
            continue

        needle = fold(rule["match"].strip())
        hits = [p for p in pdfs if needle in fold(p.name)]

        entry = books.setdefault(book_id, {"files": [], "page_offset": 0})
        entry["files"].extend(hits)

        offset = (rule.get("page_offset") or "").strip()
        if offset:
            entry["page_offset"] = int(offset)

    for entry in books.values():
        # Sorted so that a book split across several files assembles in a stable
        # order rather than whatever the filesystem returned.
        entry["files"] = sorted(set(entry["files"]), key=lambda p: p.name)

    return books


def extract_book(book_id: str, entry: dict, dry_run: bool) -> dict:
    raw_pages: list[str] = []
    provenance: list[dict] = []

    for path in entry["files"]:
        with fitz.open(path) as doc:
            start = len(raw_pages) + 1
            for page in doc:
                raw_pages.append(clean_page(page.get_text("text")))
            provenance.append(
                {
                    "file": path.name,
                    "first_page": start,
                    "last_page": len(raw_pages),
                }
            )

    heads = find_running_heads(raw_pages)
    offset = entry["page_offset"]

    pages = []
    for index, text in enumerate(raw_pages, start=1):
        folio = folio_from(text, heads)
        body = strip_running_heads(text, heads) if heads else text
        pages.append(
            {
                "page": index,
                "printed_page": index + offset,
                "folio": folio,
                "chars": len(body),
                "text": body,
            }
        )

    document = {
        "book_id": book_id,
        "extracted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "extractor": f"pymupdf {getattr(fitz, '__version__', 'unknown')}",
        "page_offset": offset,
        "sources": provenance,
        "running_heads_removed": sorted(heads),
        "pages": pages,
    }

    if not dry_run:
        PAGES.mkdir(exist_ok=True)
        out = PAGES / f"{book_id}.json"
        out.write_text(
            json.dumps(document, ensure_ascii=False, indent=1), encoding="utf-8"
        )

    return document


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("book_id", nargs="*", help="limit to these books")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not MAPPING.exists():
        sys.exit(f"{MAPPING} not found.")

    books = read_mapping()
    if args.book_id:
        missing = [b for b in args.book_id if b not in books]
        if missing:
            sys.exit(f"not in mapping.csv: {', '.join(missing)}")
        books = {k: v for k, v in books.items() if k in args.book_id}

    if not books:
        sys.exit("nothing to extract")

    total_pages = 0
    total_chars = 0
    empty_warnings = []

    for book_id, entry in sorted(books.items()):
        if not entry["files"]:
            print(f"  {book_id}: no file found, skipped")
            continue

        doc = extract_book(book_id, entry, args.dry_run)

        pages = doc["pages"]
        chars = sum(p["chars"] for p in pages)
        empty = sum(1 for p in pages if p["chars"] < 50)

        total_pages += len(pages)
        total_chars += chars

        offset_note = (
            f"  offset {doc['page_offset']:+d}" if doc["page_offset"] else ""
        )
        print(
            f"  {book_id:<44} {len(pages):>4}p  "
            f"{chars // max(len(pages), 1):>5} ch/p{offset_note}"
        )

        if doc["running_heads_removed"]:
            for head in doc["running_heads_removed"]:
                print(f"       removed running head: {head[:64]}")

        if empty > len(pages) * 0.2:
            empty_warnings.append((book_id, empty, len(pages)))

    print(f"\n  {total_pages:,} pages, {total_chars:,} characters")

    for book_id, empty, pages in empty_warnings:
        print(f"  ! {book_id}: {empty} of {pages} pages nearly empty — check it")

    if args.dry_run:
        print("\n  dry run: nothing written")
    else:
        print(f"\n  Wrote {PAGES}/")
        print("  Read one beside its PDF before trusting any of it.")


if __name__ == "__main__":
    main()
