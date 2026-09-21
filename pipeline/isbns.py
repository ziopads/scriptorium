#!/usr/bin/env python3
"""Harvest ISBNs from the works' own PDFs.

    python3 pipeline/isbns.py                 # every work with a file in ACCOUNTED
    python3 pipeline/isbns.py <work id> ...   # just these
    python3 pipeline/isbns.py --show          # print context lines as well

Writes pipeline/isbns.csv. Touches nothing in Neon: pipeline/enrich.py
--by-isbn reads the file, looks each pick up, and proposes the imprint.

WHICH FILES
    Neon's works.source_path says which PDF is which work, and a work has a
    file only if that PDF is in corpus/ACCOUNTED (dbconn.py). Until 21
    September this scanned every PDF under corpus/ and keyed its output by
    filename, for joining through mapping.csv; both are retired.

WHICH ISBN TO CITE
    A copyright page normally prints several: cloth, paper, ebook, sometimes a
    PDF-specific one. They identify different objects. The one to cite is the
    print edition whose folios she is quoting, because that is the pagination
    page_offset maps to. So every candidate is captured with the words around
    it and a guess at its kind, and the pick per work follows these rules:

        ebook, pdf and epub ISBNs are never picked;
        if one print ISBN remains, it is the pick;
        if several remain, nothing is picked and the work is marked
        "several": cloth and paper usually share a pagination, but that is a
        person's call, not a script's.

    A work split across several files is read from its first file, which holds
    the front matter. An essay borrows its container's ISBN, which is what the
    container-aware citation already does.

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

from dbconn import accounted_paths, connect, pdf_paths, resolve, source_paths

PIPELINE = Path(__file__).parent
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
NOT_PRINT = {"ebook", "pdf", "epub"}


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
                # The filename's "isbn13 978…" is a label, not a binding.
                "kind": "" if where == "filename" else guess_kind(context),
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


def pick(best: dict[str, dict]) -> tuple[str, str]:
    """The ISBN to propose for the work, and a word on how it was chosen."""
    printed = [h for h in best.values() if h["kind"] not in NOT_PRINT]
    if not printed:
        return "", "only ebook ISBNs" if best else "none found"
    if len(printed) == 1:
        return printed[0]["isbn13"], "one print ISBN"
    return "", "several"


def current_isbns(ids: list[str]) -> dict[str, str]:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select id, coalesce(isbn, '') from works where id = any(%s)", (ids,))
            return dict(cur.fetchall())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("work", nargs="*", help="full work ids; none means every work with a file")
    parser.add_argument("--show", action="store_true", help="print context lines")
    args = parser.parse_args()

    wanted = [resolve(n) for n in args.work] or None
    sources = source_paths(wanted)
    accounted = accounted_paths()

    files: dict[str, Path] = {}
    refused: list[tuple[str, str]] = []
    for work_id, source in sorted(sources.items()):
        found, problems = pdf_paths(source, accounted)
        if problems or not found:
            refused.append((work_id, problems[0].split("\n")[0] if problems else "no file"))
            continue
        files[work_id] = found[0]

    if not files:
        sys.exit("no work has a file in ACCOUNTED")

    recorded = current_isbns(list(files))
    rows = []
    summary = {"one print ISBN": 0, "several": 0, "only ebook ISBNs": 0, "none found": 0}
    agree = differ = 0

    for work_id, path in files.items():
        hits = scan_pdf(path)

        # One row per distinct ISBN, keeping the most informative sighting: a
        # labelled one beats an unlabelled one, and the copyright page beats the
        # filename because it says which binding.
        best: dict[str, dict] = {}
        for hit in hits:
            existing = best.get(hit["isbn13"])
            if existing is None or (not existing["kind"] and hit["kind"]):
                best[hit["isbn13"]] = hit

        choice, how = pick(best)
        summary[how] += 1
        now = recorded.get(work_id, "")
        if now and choice:
            if now == choice:
                agree += 1
            else:
                differ += 1

        for hit in best.values():
            rows.append(
                {
                    "work_id": work_id,
                    "isbn13": hit["isbn13"],
                    "kind": hit["kind"],
                    "found_in": hit["where"],
                    "pick": "yes" if hit["isbn13"] == choice else "",
                    "why": how,
                    "recorded": now,
                    "as_printed": hit["raw"],
                    "context": hit["context"],
                }
            )
        if not best:
            rows.append({"work_id": work_id, "why": how, "recorded": now})

        mark = {"one print ISBN": " ", "several": "?", "only ebook ISBNs": "e", "none found": "-"}[how]
        shown = choice or ", ".join(
            f"{h['isbn13']}{' (' + h['kind'] + ')' if h['kind'] else ''}" for h in best.values()
        )
        note = ""
        if now and choice and now != choice:
            note = f"   record has {now}"
        print(f"  {mark} {work_id[:52]:<52} {shown}{note}")
        if args.show:
            for hit in best.values():
                print(f"      {hit['where']}: …{hit['context'][:96]}…")

    fields = ["work_id", "isbn13", "kind", "found_in", "pick", "why", "recorded",
              "as_printed", "context"]
    with OUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n  {len(files)} works with a file in ACCOUNTED")
    print(f"    {summary['one print ISBN']:>3} one print ISBN: picked")
    print(f"    {summary['several']:>3} several print ISBNs: marked ?, nothing picked")
    print(f"    {summary['only ebook ISBNs']:>3} only ebook ISBNs: marked e, nothing picked")
    print(f"    {summary['none found']:>3} no valid ISBN: marked -")
    if agree or differ:
        print(f"  against the record: {agree} agree, {differ} differ")
    if refused:
        print(f"\n  {len(refused)} works whose source_path names no usable file in ACCOUNTED:")
        for work_id, why in refused:
            print(f"    {work_id}: {why[:70]}")

    print(f"\n  Wrote {OUT}")
    print("  Next: python3 pipeline/enrich.py --by-isbn, which looks each pick up.")


if __name__ == "__main__":
    main()
