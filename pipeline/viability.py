#!/usr/bin/env python3
"""Is each mapped file actually the whole book?

    python3 pipeline/viability.py
    python3 pipeline/viability.py --show     # print the evidence lines

Answers one question per file: could this be cited from, or is it an excerpt
wearing a book's name? Seeding an excerpt as "have it" hides a gap, and the gap
surfaces when she goes to cite page 180 of a file that stops at page 40.

WHAT IT LOOKS FOR
    Page count alone is weak — a 90-page monograph is normal and a 90-page
    excerpt of a 400-page one is not. What separates them is apparatus:

      front matter   a copyright page. ISBN, "All rights reserved", ©,
                     "Library of Congress", "Depósito legal".
      back matter    an index, bibliography, works cited, or notes section.
      folio span     the first and last printed page numbers. A file whose
                     folios run 1–312 is a book; one running 87–129 is a chapter.

    A file with both ends present and a folio span starting near 1 is almost
    certainly complete. Missing either end is the signal to look.

Reads the PDFs directly, so it needs no prior extraction. Writes
pipeline/viability.csv.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF is not installed. Run: pip install pymupdf")

PIPELINE = Path(__file__).parent
CORPUS = PIPELINE / "corpus"
MAPPING = PIPELINE / "mapping.csv"
OUT = PIPELINE / "viability.csv"

FRONT_PAGES = 16
BACK_PAGES = 20

COPYRIGHT = re.compile(
    r"(isbn|all rights reserved|library of congress|copyright ©|"
    r"deposito legal|derechos reservados|printed in|impreso en|"
    r"todos los derechos)",
    re.I,
)

BACK_MATTER = re.compile(
    r"^\s*(index|indice|bibliography|bibliografia|works cited|obras citadas|"
    r"references|referencias|notes|notas|about the author|sobre el autor|"
    r"glossary|glosario)\s*$",
    re.I | re.M,
)

BARE_FOLIO = re.compile(r"^\s*(\d{1,4})\s*$", re.M)

# Filenames that announce themselves as partial.
PARTIAL_NAME = re.compile(r"(part[_ ]?[ivx\d]|vol[_ .]?\s*\d|cap[ií]tulo|chapter\s*\d|\b\d\.pdf)", re.I)


def fold(s: str) -> str:
    d = unicodedata.normalize("NFKD", s)
    return "".join(c for c in d if not unicodedata.combining(c)).casefold()


def read_mapping() -> list[tuple[str, Path]]:
    with MAPPING.open(encoding="utf-8") as handle:
        rules = [r for r in csv.DictReader(handle) if r["match"].strip()]

    files = sorted(
        p for p in CORPUS.rglob("*")
        if p.suffix.lower() in {".pdf", ".epub"} and not p.name.startswith(".")
    )

    pairs = []
    for rule in rules:
        needle = fold(rule["match"].strip())
        for path in files:
            if needle in fold(path.name):
                pairs.append((rule["book_id"].strip(), path))
    return pairs


def inspect(path: Path) -> dict:
    row = {
        "book_id": "", "filename": path.name, "pages": 0, "chars_per_page": 0,
        "copyright_page": "", "back_matter": "", "first_folio": "",
        "last_folio": "", "isbn_in_file": "", "verdict": "", "why": "",
    }

    try:
        doc = fitz.open(path)
    except Exception as exc:  # noqa: BLE001
        row["verdict"] = "unreadable"
        row["why"] = str(exc)[:80]
        return row

    with doc:
        if doc.needs_pass:
            row["verdict"] = "encrypted"
            return row

        pages = doc.page_count
        row["pages"] = pages
        if pages == 0:
            row["verdict"] = "empty"
            return row

        texts = []
        for index in range(pages):
            try:
                texts.append(doc[index].get_text("text"))
            except Exception:  # noqa: BLE001
                texts.append("")

    total = sum(len(t.strip()) for t in texts)
    row["chars_per_page"] = total // pages

    front = "\n".join(texts[:FRONT_PAGES])
    back = "\n".join(texts[-BACK_PAGES:])

    row["copyright_page"] = "yes" if COPYRIGHT.search(front) else "no"
    row["back_matter"] = "yes" if BACK_MATTER.search(back) else "no"
    row["isbn_in_file"] = "yes" if re.search(r"isbn", front, re.I) else "no"

    folios = []
    for index, text in enumerate(texts, start=1):
        lines = [l for l in text.split("\n") if l.strip()]
        for line in (lines[:1] + lines[-1:]):
            m = BARE_FOLIO.match(line)
            if m:
                value = int(m.group(1))
                if 0 < value < 2000:
                    folios.append(value)
                    break

    if folios:
        row["first_folio"] = min(folios)
        row["last_folio"] = max(folios)

    # ---------------------------------------------------------------- verdict
    reasons = []

    if row["chars_per_page"] < 50:
        row["verdict"] = "no text layer"
        row["why"] = "needs OCR before it can be cited or searched"
        return row

    if PARTIAL_NAME.search(path.name):
        reasons.append("filename says partial")
    if row["copyright_page"] == "no":
        reasons.append("no copyright page")
    if row["back_matter"] == "no":
        reasons.append("no index or bibliography")
    if pages < 60:
        reasons.append(f"only {pages} pages")
    if row["first_folio"] != "" and int(row["first_folio"]) > 20:
        reasons.append(f"folios start at {row['first_folio']}")

    if not reasons:
        row["verdict"] = "looks complete"
    elif len(reasons) == 1:
        row["verdict"] = "check"
    else:
        row["verdict"] = "likely excerpt"

    row["why"] = "; ".join(reasons)
    return row


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--show", action="store_true")
    args = parser.parse_args()

    pairs = read_mapping()
    if not pairs:
        sys.exit("no mapped files — run link.py first")

    rows = []
    for book_id, path in pairs:
        row = inspect(path)
        row["book_id"] = book_id
        rows.append(row)

        mark = {"looks complete": "  ", "check": "? ", "likely excerpt": "! "}.get(
            row["verdict"], "! "
        )
        span = (
            f"{row['first_folio']}–{row['last_folio']}"
            if row["first_folio"] != "" else "no folios"
        )
        print(
            f"{mark}{row['verdict']:<16} {row['pages']:>4}p  folios {span:<12} "
            f"{book_id[:40]}"
        )
        if row["why"]:
            print(f"     {row['why']}")
        if args.show:
            print(
                f"     copyright page: {row['copyright_page']}  "
                f"back matter: {row['back_matter']}"
            )

    with OUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    counts: dict[str, int] = {}
    for row in rows:
        counts[row["verdict"]] = counts.get(row["verdict"], 0) + 1

    print(f"\n  {len(rows)} mapped files")
    for verdict, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"    {verdict:<18} {count}")

    print(f"\n  Wrote {OUT}")
    print("  Anything not 'looks complete' should be seeded as source_format")
    print("  'none' and listed as still needed, so the gap stays visible.")


if __name__ == "__main__":
    main()
