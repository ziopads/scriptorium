#!/usr/bin/env python3
"""Can this PDF support a page citation? Check before adding it to the corpus.

    python3 pipeline/check_pdf.py ~/Downloads/some-book.pdf
    python3 pipeline/check_pdf.py ~/Downloads            # a whole folder
    python3 pipeline/check_pdf.py pipeline/corpus --quiet  # only the problems

A file is citable when its pages correspond to a published edition's pages, so
that a reader can follow a footnote to page 187 and find the passage. An ebook
conversion has page numbers, but they belong to whatever rendered it — nobody
can follow that citation, because no printed copy has a page 187 in that place.

FOUR SIGNALS, AND THE ONE THAT DECIDES

    printed folios      Decisive. A real book has front matter, so its printed
                        page 1 sits several file pages in. Consistent folios at
                        a non-zero offset mean the pages correspond to a
                        published edition — which is the definition. No folios
                        at all means nothing was paginated for print.

    producer metadata   Circumstantial, and only when folios are absent or the
                        offset is zero. Calibre is often used to strip DRM from
                        a publisher's PDF without touching its pages, and macOS
                        stamps Quartz PDFContext on anything re-saved through
                        Preview.

    copyright page      ISBN, "All rights reserved", a publisher's imprint in
                        the first pages. Conversions usually drop it.

    running heads       A line repeating across pages in the same position. A
                        product of print typesetting; reflowed text has none.

None of these is conclusive on its own except the first, and the tool says so.
It reports evidence and a verdict, and a person decides.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF is not installed. Run: pip install pymupdf")

# Tools that reflow text into new pages. A file made by one of these has no
# relationship to any printed edition's pagination.
#
# NOT in this list, deliberately: Quartz PDFContext. That is what macOS stamps
# on anything re-saved through Preview or print-to-PDF, including scans and
# publisher PDFs, and treating it as a converter marked several citable books
# uncitable — including one whose producer string was "Quartz PDFContext
# QuarkXPress", where the second half names a typesetter.
CONVERTERS = re.compile(
    r"(calibre|pandoc|wkhtmltopdf|prince|weasyprint|sigil|"
    r"microsoft.{0,12}word|libreoffice|openoffice|reportlab|"
    r"tcpdf|fpdf|dompdf|epub)",
    re.I,
)

# Tools that typeset books.
TYPESETTERS = re.compile(
    r"(indesign|distiller|xpp|3b2|framemaker|quark|pdftex|xetex|luatex|"
    r"latex|arbortext|prepress|acrobat|pitstop|callas|ghostscript)",
    re.I,
)

COPYRIGHT = re.compile(
    r"(isbn|all rights reserved|library of congress|copyright ©|"
    r"deposito legal|derechos reservados|printed in|impreso en)",
    re.I,
)

BARE_FOLIO = re.compile(r"^\s*(\d{1,4})\s*$")

# A folio at the start or end of a line it shares with a running head:
# "47  Chapter Three" or "Red Medicine  •  47". Requiring a line of nothing but
# digits missed these entirely, and reported InDesign-typeset books with proper
# pagination as having none.
EDGE_FOLIO = re.compile(r"^(\d{1,4})\b|\b(\d{1,4})$")


def mask(line: str) -> str:
    return re.sub(r"\d+", "#", line).strip()


def folio_on(text: str) -> tuple[int | None, str]:
    """Returns (folio, how). `how` is 'bare' for a line of nothing but digits and
    'edge' for a number sharing a line with a running head.

    The two are kept apart because they differ enormously in quality. A bare
    folio is almost always a page number. An edge match also catches chapter
    numbers, years and footnote markers, and mixing the two into one pool let
    that noise swamp a genuine run of 97 agreeing pages."""
    lines = [l for l in text.split("\n") if l.strip()]
    if not lines:
        return None, ""

    candidates = lines[:2] + lines[-2:]

    for line in candidates:
        m = BARE_FOLIO.match(line)
        if m:
            v = int(m.group(1))
            if 0 < v < 2000:
                return v, "bare"

    for line in candidates:
        if len(line) > 90:
            continue
        m = EDGE_FOLIO.search(line.strip())
        if m:
            v = int(m.group(1) or m.group(2))
            if 0 < v < 2000:
                return v, "edge"

    return None, ""


def inspect(path: Path) -> dict:
    row: dict = {"file": path.name, "verdict": "", "why": [], "for": []}

    try:
        doc = fitz.open(path)
    except Exception as exc:  # noqa: BLE001
        return {**row, "verdict": "unreadable", "why": [str(exc)[:70]]}

    with doc:
        if doc.needs_pass:
            return {**row, "verdict": "encrypted", "why": ["password required"]}

        meta = doc.metadata or {}
        producer = f"{meta.get('producer', '')} {meta.get('creator', '')}".strip()
        pages = doc.page_count
        texts = []
        for i in range(pages):
            try:
                texts.append(doc[i].get_text("text"))
            except Exception:  # noqa: BLE001
                texts.append("")

    row["pages"] = pages
    row["producer"] = producer[:60]

    if pages == 0:
        return {**row, "verdict": "empty", "why": ["no pages"]}

    chars = sum(len(t.strip()) for t in texts) // max(pages, 1)
    row["chars_per_page"] = chars
    if chars < 50:
        return {**row, "verdict": "needs OCR",
                "why": ["no text layer; OCR before judging citability"]}

    # 1. Producer
    if CONVERTERS.search(producer):
        row["why"].append(f"produced by a converter: {producer[:40]}")
    elif TYPESETTERS.search(producer):
        row["for"].append(f"typeset: {producer[:40]}")
    elif not producer:
        row["why"].append("no producer recorded")

    # 2. Folios. Bare first; edge matches are only consulted when bare ones are
    # too few to judge.
    bare: Counter[int] = Counter()
    edge: Counter[int] = Counter()
    for index, text in enumerate(texts, start=1):
        f, how = folio_on(text)
        if f is None:
            continue
        (bare if how == "bare" else edge)[f - index] += 1

    pool = bare if sum(bare.values()) >= 8 else edge
    quality = "bare" if pool is bare else "edge"
    found = sum(pool.values())
    row["folios"] = found

    if found < max(8, pages * 0.05):
        row["why"].append(f"only {found} printed page numbers in {pages} pages")
    else:
        offset, agreeing = pool.most_common(1)[0]
        share = agreeing / found

        # Either a clear majority, or a long absolute run. A book whose folios
        # agree on one offset across 97 of its pages is paginated for print,
        # however many stray numbers were scraped from elsewhere.
        solid = share >= 0.6 or agreeing >= max(12, pages * 0.2)

        if not solid:
            row["why"].append(
                f"page numbers found but inconsistent: {agreeing} of {found} "
                f"agree on {offset:+d}"
            )
        else:
            row["offset"] = offset
            row["agreement"] = round(share, 2)
            if offset == 0:
                row["why"].append(
                    "printed page numbers equal the file pages — no front matter"
                )
            else:
                row["for"].append(
                    f"consistent print pagination, offset {offset:+d} "
                    f"({agreeing} of {found} {quality} folios)"
                )

    # 3. Copyright page
    if COPYRIGHT.search("\n".join(texts[:16])):
        row["for"].append("copyright page present")
    else:
        row["why"].append("no copyright page")

    # 4. Running heads
    heads: Counter[str] = Counter()
    for text in texts:
        lines = [l for l in text.split("\n") if l.strip()]
        if lines:
            heads[mask(lines[0])] += 1
            if len(lines) > 1:
                heads[mask(lines[-1])] += 1
    if heads and heads.most_common(1)[0][1] >= pages * 0.25:
        row["for"].append("running heads")
    else:
        row["why"].append("no running heads")

    strikes, support = len(row["why"]), len(row["for"])
    typeset = bool(TYPESETTERS.search(producer))

    # Printed folios at a non-zero offset ARE what citable means: the pages
    # correspond to a published edition, with front matter shifting the count.
    # That settles it whatever produced the file — calibre is often used to
    # strip DRM from a publisher's PDF without touching its pages.
    if row.get("offset") not in (None, 0):
        row["verdict"] = "citable"

    # A book typeset in InDesign, with a copyright page, whose folios this tool
    # failed to read is a detection failure, not a property of the book. Saying
    # "not citable" there asserts something false about a real publisher PDF.
    elif typeset and "copyright page present" in row["for"]:
        row["verdict"] = "check by hand"
        row["why"].append("typeset and paginated, but no folios could be read")

    elif row.get("folios", 0) == 0:
        row["verdict"] = "NOT citable"
        row["why"].append("no printed pagination of any kind")
    elif CONVERTERS.search(producer) and row.get("offset") == 0:
        row["verdict"] = "NOT citable"
    elif strikes == 0:
        row["verdict"] = "citable"
    elif support >= 2:
        row["verdict"] = "probably citable"
    else:
        row["verdict"] = "check by hand"

    return row


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("target")
    parser.add_argument("--quiet", action="store_true",
                        help="only show anything that is not plainly citable")
    parser.add_argument("--no-write", action="store_true",
                        help="do not write pipeline/citability.csv")
    args = parser.parse_args()

    target = Path(args.target).expanduser()
    if target.is_dir():
        files = sorted(p for p in target.rglob("*.pdf") if not p.name.startswith("."))
    elif target.exists():
        files = [target]
    else:
        sys.exit(f"not found: {target}")

    if not files:
        sys.exit(f"no PDFs under {target}")

    counts: dict[str, int] = {}
    rows: list[dict] = []

    for path in files:
        row = inspect(path)
        counts[row["verdict"]] = counts.get(row["verdict"], 0) + 1

        rows.append({
            "filename": row["file"],
            "verdict": row["verdict"],
            "pages": row.get("pages", ""),
            "offset": row.get("offset", ""),
            "agreement": row.get("agreement", ""),
            "folios": row.get("folios", ""),
            "producer": row.get("producer", ""),
            "against": " | ".join(row["why"]),
            "for": " | ".join(row["for"]),
        })

        if args.quiet and row["verdict"] in {"citable", "probably citable"}:
            continue

        mark = {"citable": "  ", "probably citable": "  "}.get(row["verdict"], "! ")
        print(f"{mark}{row['verdict']:<18} {row.get('pages', 0):>4}p  {row['file'][:56]}")
        for reason in row["why"]:
            print(f"       against: {reason}")
        for reason in row["for"]:
            print(f"       for:     {reason}")

    if not args.no_write and target.is_dir():
        out = Path(__file__).parent / "citability.csv"
        with out.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        print(f"\n  Wrote {out}")

    print(f"\n  {len(files)} files")
    for verdict, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"    {verdict:<20} {count}")
    print("\n  A verdict is evidence, not a ruling. Open anything marked 'check'.")


if __name__ == "__main__":
    main()
