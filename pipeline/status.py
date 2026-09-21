#!/usr/bin/env python3
"""Where every book stands: file, catalogue record, and what is loaded.

    python3 pipeline/status.py                 # everything
    python3 pipeline/status.py --unmapped      # rows whose work_id names no work
    python3 pipeline/status.py --new           # PDFs in the corpus with no rule
    python3 pipeline/status.py --files         # work id and filename, nothing else
    python3 pipeline/status.py anzaldua        # anything whose id or title matches

WHY THIS EXISTS

    Three different names for one book, and no single place showed all three:

      the file      "Cuentos_ Tales from the Hispanic Southwest -- ….pdf"
      the book_id   anaya-cuentos-hispanic-southwest-1980      (from the file)
      the work_id   griego-y-maestas-cuentos-tales-from-the-hispanic-1980
                                                               (from the catalogue)

    The book_id was built from a filename that names Anaya; the catalogue files
    it under Griego y Maestas, who is the first author. Nothing connects them
    but the work_id column of mapping.csv, and where that column is empty there
    was no way to get from one to the other short of guessing at SQL.

    For an unmapped row this proposes candidates from the catalogue by title
    and author overlap. Read them, put the right id in mapping.csv, and the
    book flows through the rest of the pipeline without re-extraction.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from pathlib import Path

from dbconn import connect

ROOT = Path(__file__).parent
PAGES = ROOT / "pages"
CHUNKS = ROOT / "chunks"
CORPUS = ROOT / "corpus"
MAPPING = ROOT / "mapping.csv"

STOP = {
    "the", "a", "an", "of", "and", "in", "to", "for", "from", "on", "with",
    "la", "el", "los", "las", "de", "del", "y", "en", "un", "una", "al",
}


def fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def words(value: str) -> set[str]:
    cleaned = "".join(c if c.isalnum() or c.isspace() else " " for c in fold(value))
    return {w for w in cleaned.split() if len(w) > 2 and w not in STOP}


def rows_of_mapping() -> list[dict]:
    with MAPPING.open(encoding="utf-8") as fh:
        return list(csv.DictReader(l for l in fh if not l.lstrip().startswith("#")))


def name_parts(name: str) -> tuple[str, str]:
    """Title and author out of a corpus filename. These come from a download
    service and read

        Title -- Author -- Publisher, edition, year -- isbn -- hash -- source

    Everything after the second segment is provenance, and feeding it to the
    matcher is what made the scores useless: 'Cartucho -- Nellie Campobello --
    1931 -- faccd0da… -- Anna's Archive' scored 0.43 against the record for
    Cartucho by Nellie Campobello, because the hash and the publisher counted
    against it."""
    stem = Path(name).stem
    parts = [p.strip() for p in stem.split(" -- ")]
    title = parts[0] if parts else stem
    author = parts[1] if len(parts) > 1 else ""
    return title, author


def surname(author: str) -> str:
    first = fold(author).split(",")[0]
    first = re.sub(r"[^a-z\s-]", " ", first)
    bits = [b for b in re.split(r"[\s-]+", first) if b and b not in {"de", "del", "la", "y", "von"}]
    return bits[-1] if bits else ""


def candidates(name: str, catalogue: list[dict], limit: int = 3):
    """Catalogue records that might be this file.

    Scored as the share of the CATALOGUE RECORD the filename accounts for, not
    the share of the filename matched. A record is a handful of words; a
    filename is that plus forty words of provenance. Asking how much of the
    record is covered makes a full match score 1.0 whatever noise surrounds it.

    A shared surname is worth a great deal on its own, so it adds to the score
    rather than merely contributing a word."""
    title, author = name_parts(name)
    needle = words(title) | words(author)
    if not needle:
        return []
    sur = surname(author)

    scored = []
    for work in catalogue:
        hay = words(f"{work['author'] or ''} {work['title']}")
        if not hay:
            continue
        shared = needle & hay
        if not shared:
            continue
        score = len(shared) / len(hay)
        if sur and sur in fold(work["author"] or ""):
            score += 0.3
        scored.append((min(round(score, 2), 1.0), work))

    scored.sort(key=lambda s: -s[0])
    return scored[:limit]


def unmatched_pdfs(rules: list[str]) -> list[Path]:
    """Every PDF in the corpus that no rule in mapping.csv would find.

    Files under ACCOUNTED or OCR are left out. Moving a file into one of those
    folders is how a person records "dealt with", and a report that keeps
    offering it afterwards makes the folder pointless."""
    if not CORPUS.exists():
        return []
    needles = [fold(r) for r in rules if r]
    out = []
    for path in sorted(CORPUS.rglob("*.pdf")):
        if path.name.startswith("."):
            continue
        if {"ACCOUNTED", "OCR"} & set(path.relative_to(CORPUS).parts[:-1]):
            continue
        name = fold(path.name)
        if not any(n in name for n in needles):
            out.append(path)
    return out


def match_string(path: Path) -> str:
    """A rule that finds this file and, with luck, no other. Corpus names come
    from a download service and read

        Title -- Author -- Publisher, edition, year -- isbn -- hash -- source.pdf

    so the part before the first ' -- ' is the title: the most distinctive
    thing in the name and the most legible thing to put in the CSV."""
    stem = path.stem.split(" -- ")[0].strip()
    stem = re.sub(r"[_\s]+", " ", stem).strip()
    return stem[:56].strip(" -\u2013\u2014,") or path.stem[:56]


def report_new(catalogue: list[dict], rules: list[str], limit: int) -> None:
    files = unmatched_pdfs(rules)
    if not files:
        print("  every PDF in the corpus is named by a rule")
        return

    print(f"\n  {len(files)} PDFs in the corpus that no rule in mapping.csv finds.\n")
    print("  Read each proposal, then paste the accepted csv lines into mapping.csv.")
    print("  A blank work_id means nothing in the catalogue looked close enough:")
    print("  add the work in the app first, or leave the file out.\n")

    for path in files[:limit]:
        found = candidates(path.name, catalogue, limit=3)
        print(f"  {path.name[:96]}")
        for score, cand in found:
            who = (cand["author"] or "\u2014")[:30]
            mark = "\u2192" if score >= 0.6 else " "
            print(f"    {mark} [{score:>4}] {who:<30} {cand['title'][:50]}")
            print(f"             {cand['id']}")
        if not found:
            print("      nothing in the catalogue resembles this")
        best = found[0] if found and found[0][0] >= 0.6 else None
        print(f'    csv: {match_string(path)},{best[1]["id"] if best else ""},\n')

    if len(files) > limit:
        print(f"  … and {len(files) - limit} more. Raise --limit to see them.\n")

    print(
        "  Every proposal is a guess from the filename. The one that mattered\n"
        "  most was wrong in the obvious way: a file naming Anaya is catalogued\n"
        "  under Griego y Maestas, its first author. Read before pasting."
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("needle", nargs="?", help="filter by work id, filename, or title")
    parser.add_argument("--unmapped", action="store_true",
                        help="rows whose work_id names no work in the catalogue")
    parser.add_argument("--new", action="store_true",
                        help="PDFs no rule finds, with proposed mapping.csv rows")
    parser.add_argument("--limit", type=int, default=40,
                        help="how many to propose at once, with --new")
    parser.add_argument("--files", action="store_true",
                        help="work id and filename for every mapped work; · marks not yet extracted")
    args = parser.parse_args()

    mapping = rows_of_mapping()

    # One entry per work; a work split across several files has several rows.
    books: dict[str, dict] = {}
    for row in mapping:
        work_id = (row.get("work_id") or "").strip()
        if not work_id:
            continue
        entry = books.setdefault(work_id, {"matches": [], "note": ""})
        entry["matches"].append((row.get("match") or "").strip())
        if (row.get("note") or "").strip():
            entry["note"] = row["note"].strip()

    # The extract knows which file it read; mapping.csv knows which file it
    # WILL read. Reporting only the former meant --files said "(not extracted)"
    # for fifty works whose PDF is perfectly well known — the question "which
    # file is this book?" has an answer long before anything is extracted.
    corpus = sorted(p for p in CORPUS.rglob("*.pdf") if not p.name.startswith(".")) \
        if CORPUS.exists() else []

    for work_id, entry in books.items():
        path = PAGES / f"{work_id}.json"
        entry["files"] = []
        entry["pages_file"] = 0
        entry["chapters"] = 0
        entry["extracted"] = path.exists()
        if path.exists():
            doc = json.loads(path.read_text(encoding="utf-8"))
            entry["files"] = [s["file"] for s in doc.get("sources", [])]
            entry["pages_file"] = len(doc.get("pages", []))
            entry["chapters"] = len(doc.get("chapters", []))
        else:
            for needle in entry["matches"]:
                folded = fold(needle)
                entry["files"].extend(
                    p.name for p in corpus if folded in fold(p.name)
                )
        chunk_path = CHUNKS / f"{work_id}.json"
        entry["chunks_file"] = (
            len(json.loads(chunk_path.read_text(encoding="utf-8"))["chunks"])
            if chunk_path.exists()
            else 0
        )

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select id, author, title, year from works order by id")
            catalogue = [
                {"id": r[0], "author": r[1], "title": r[2], "year": r[3]}
                for r in cur.fetchall()
            ]
            by_id = {w["id"]: w for w in catalogue}

            cur.execute("select work_id, count(*) from pages group by work_id")
            pages_db = dict(cur.fetchall())
            cur.execute("select work_id, count(*) from chunks group by work_id")
            chunks_db = dict(cur.fetchall())
            cur.execute(
                "select work_id, count(*) from chunks where embedding is not null group by work_id"
            )
            embedded_db = dict(cur.fetchall())
            cur.execute("select work_id, count(*) from sections group by work_id")
            sections_db = dict(cur.fetchall())

    if args.new:
        report_new(catalogue, [r.get("match", "") for r in mapping], args.limit)
        return

    shown = 0
    for work_id in sorted(books):
        entry = books[work_id]
        work = by_id.get(work_id)

        if args.unmapped and work:
            continue
        if args.needle:
            needle = fold(args.needle)
            hay = fold(
                f"{work_id} {' '.join(entry['files'])} "
                f"{work['title'] if work else ''}"
            )
            if needle not in hay:
                continue

        shown += 1

        if args.files:
            mark = " " if entry.get("extracted") else "·"
            for f in entry["files"] or ["(no file in the corpus matches this rule)"]:
                print(f"  {mark} {work_id:<52} {f}")
            continue

        print(f"\n  {work_id}")
        for f in entry["files"] or ["(not extracted \u2014 run extract.py)"]:
            print(f"      file      {f}")

        if work:
            who = work["author"] or "\u2014"
            print(f"      catalogue {who}. {work['title']} ({work['year'] or 'n.d.'})")
            print(
                f"      loaded    {pages_db.get(work_id, 0):,} pages, "
                f"{sections_db.get(work_id, 0)} sections, "
                f"{chunks_db.get(work_id, 0):,} chunks, "
                f"{embedded_db.get(work_id, 0):,} embedded"
            )
        else:
            print("      catalogue NONE \u2014 no work in the catalogue has this id")
            print(
                f"      extracted {entry['pages_file']:,} pages, "
                f"{entry['chapters']} chapters, {entry['chunks_file']:,} chunks"
            )
            for score, cand in candidates(entry["files"][0] if entry["files"] else work_id, catalogue):
                who = cand["author"] or "\u2014"
                print(f"      maybe     {cand['id']}")
                print(f"                {who}. {cand['title'][:64]} ({cand['year'] or 'n.d.'})  [{score}]")

        if entry["note"]:
            print(f"      note      {entry['note']}")

    if shown == 0:
        print("  nothing matched")
    elif not args.files:
        known = sum(1 for k in books if k in by_id)
        print(f"\n  {len(books)} works in mapping.csv, {known} present in the catalogue")


if __name__ == "__main__":
    main()
