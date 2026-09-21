#!/usr/bin/env python3
"""Coverage: for every examinable work, is there a PDF, and is it usable.

    python3 pipeline/coverage.py                  # every examinable work, by state
    python3 pipeline/coverage.py --missing        # only works with no candidate
    python3 pipeline/coverage.py --ready          # one strong candidate, no row yet
    python3 pipeline/coverage.py --ambiguous      # several candidates, needs a person
    python3 pipeline/coverage.py --decided        # works already judged, and why
    python3 pipeline/coverage.py --list theory    # one exam list
    python3 pipeline/coverage.py --leftovers      # PDFs matching no work at all

WHY THIS RUNS FROM THE CATALOGUE AND NOT FROM THE FILES

    status.py --new asks, of each PDF, which work is this. That direction has a
    cost that took a while to see: a file with no work looks like a problem, and
    a WORK WITH NO FILE looks like nothing at all. It produced a list of 109
    files and never once said how many of the 125 examinable works she can
    actually read.

    This asks the question the other way. Every examinable work is a line that
    is satisfied or it is not, and the answer is a number she needs: how much of
    her reading list exists on disk, how much of it is legible, and what is
    still to find. The works with nothing are a shopping list. The works with
    two candidates are a judgement — which is made by opening both PDFs, not by
    a score.

STATES

    loaded       mapped, extracted, and in the database: she can read it now
    mapped       has a row in mapping.csv but is not loaded yet
    ready        exactly one strong candidate and no row: write the line and go
    ambiguous    several candidates; open them and delete the ones that lose
    poor         the only candidate needs OCR or re-OCR before it is worth loading
    missing      nothing in the corpus resembles this work

    Judgement never happens here. A candidate is proposed, never chosen.
"""

from __future__ import annotations

import argparse
import csv
import re
import unicodedata
from pathlib import Path

from dbconn import connect

ROOT = Path(__file__).parent
CORPUS = ROOT / "corpus"
MAPPING = ROOT / "mapping.csv"
CITABILITY = ROOT / "citability.csv"
DECISIONS = ROOT / "decisions.csv"

# Folders inside the corpus that are not a pool of candidates.
#
#   ACCOUNTED  files already spoken for. Moving one here is how a person says
#              "dealt with", and it is a better record than any report: the
#              folder shrinks as the work is done, visibly, without a command.
#   OCR        files queued for re-recognition. Still the work's PDF, so still
#              extractable, but not something to propose as a fresh candidate.
#
# Extraction still reads both — a file's location says nothing about which book
# it is. This only stops the scorer offering files whose question is settled.
SET_ASIDE = {"ACCOUNTED", "OCR"}


def candidate_pdfs() -> list[Path]:
    """PDFs still looking for a work."""
    return sorted(
        p for p in CORPUS.rglob("*.pdf")
        if not p.name.startswith(".")
        and not SET_ASIDE & set(p.relative_to(CORPUS).parts[:-1])
    )

STOP = {
    "the", "a", "an", "of", "and", "in", "to", "for", "from", "on", "with", "at",
    "la", "el", "los", "las", "de", "del", "y", "en", "un", "una", "al", "por",
    "university", "press", "editorial", "ediciones", "books", "edition", "ed",
    "spanish", "english", "archive", "annas", "anna", "pdf", "vol", "volume",
}

STRONG = 0.6     # one candidate at or above this, and nothing near it, is ready
NEAR = 0.15      # a second candidate within this of the first makes it ambiguous


def fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value or "")
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def words(value: str) -> set[str]:
    cleaned = "".join(c if c.isalnum() or c.isspace() else " " for c in fold(value))
    return {w for w in cleaned.split() if len(w) > 2 and w not in STOP}


def surname(author: str) -> str:
    first = fold(author).split(",")[0]
    first = re.sub(r"[^a-z\s-]", " ", first)
    bits = [b for b in re.split(r"[\s-]+", first)
            if b and b not in {"de", "del", "la", "y", "von"}]
    return bits[-1] if bits else ""


def file_parts(name: str) -> tuple[str, str]:
    """Title and author from a corpus filename. These come from a download
    service as 'Title -- Author -- publisher, year -- isbn -- hash -- source';
    everything past the second segment is provenance and only adds noise."""
    stem = Path(name).stem
    parts = [p.strip() for p in stem.split(" -- ")]
    return (parts[0] if parts else stem), (parts[1] if len(parts) > 1 else "")


def score(work: dict, path: Path) -> float:
    """How much of this work the file's name accounts for.

    The share of the WORK's words covered, not of the filename's: a catalogue
    record is a handful of words and a filename is that plus forty of
    provenance, so scoring the other way buried every real match."""
    hay = words(f"{work['author'] or ''} {work['title']}")
    if not hay:
        return 0.0
    title, author = file_parts(path.name)
    needle = words(title) | words(author)
    shared = needle & hay
    if not shared:
        return 0.0
    value = len(shared) / len(hay)
    if surname(work["author"] or "") and surname(work["author"] or "") in fold(path.name):
        value += 0.3
    return min(round(value, 2), 1.0)


def decisions() -> dict[str, dict]:
    """work_id -> {state, note}, from decisions.csv.

    A judgement made once should not be made again. Without this the scorer
    re-proposes the same wrong candidate on every run — Rama's La ciudad
    letrada against the Transculturación file, Urrea's Devil's Highway against
    a book about Santa Teresa Urrea — and a person re-reads past it each time.
    """
    if not DECISIONS.exists():
        return {}
    out: dict[str, dict] = {}
    with DECISIONS.open(encoding="utf-8") as fh:
        for row in csv.DictReader(l for l in fh if not l.lstrip().startswith("#")):
            work_id = (row.get("work_id") or "").strip()
            if work_id:
                out[work_id] = {
                    "state": (row.get("state") or "none").strip(),
                    "note": (row.get("note") or "").strip(),
                }
    return out


def verdicts() -> dict[str, str]:
    """filename -> verdict, from check_pdf.py's citability.csv, so that a work
    whose only candidate is an unreadable scan is not reported as ready."""
    if not CITABILITY.exists():
        return {}
    out = {}
    with CITABILITY.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            name = (row.get("filename") or "").strip()
            if name:
                out[name] = (row.get("verdict") or "").strip()
    return out


def mapping_rows() -> tuple[dict[str, list[str]], list[str]]:
    """work_id -> match strings, and every match string."""
    by_work: dict[str, list[str]] = {}
    every: list[str] = []
    if not MAPPING.exists():
        return by_work, every
    with MAPPING.open(encoding="utf-8") as fh:
        for row in csv.DictReader(l for l in fh if not l.lstrip().startswith("#")):
            match = (row.get("match") or "").strip()
            work_id = (row.get("work_id") or "").strip()
            if match:
                every.append(match)
            if match and work_id:
                by_work.setdefault(work_id, []).append(match)
    return by_work, every


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--missing", action="store_true")
    parser.add_argument("--ready", action="store_true")
    parser.add_argument("--ambiguous", action="store_true")
    parser.add_argument("--decided", action="store_true",
                        help="works already judged in decisions.csv, and why")
    parser.add_argument("--leftovers", action="store_true")
    parser.add_argument("--list", dest="which",
                        help="one exam list by name: theory, dissertation, teaching, film")
    parser.add_argument("--all-works", action="store_true",
                        help="include works that are not examinable")
    args = parser.parse_args()

    by_work, all_matches = mapping_rows()
    judged = verdicts()
    decided = decisions()
    pdfs = candidate_pdfs()

    with connect() as conn:
        with conn.cursor() as cur:
            # Examinability is a view, not a column (migration 004): a work is
            # examinable if it is on an examinable list OR its container is, so
            # an essay inside the Sanjek volume counts.
            #
            # There is no code column. The [I.C.15] codes on screen are composed
            # in the app from the list, the section letter and the ordinal, so
            # they are composed here too.
            cur.execute(f"""
                select w.id, w.author, w.title, w.year,
                       coalesce(min(el.name), '') as list_name,
                       coalesce(min(el.sort), 99) as list_sort,
                       coalesce(min(s.letter), '') as letter,
                       min(li.ordinal) as ordinal
                from works w
                {'' if args.all_works else 'join examinable_works ew on ew.id = w.id'}
                left join list_items li on li.work_id = w.id
                left join exam_lists el on el.id = li.list_id
                left join list_sections s on s.id = li.section_id
                group by w.id, w.author, w.title, w.year
                order by 6, 7, 8 nulls last, w.id
            """)
            works = [
                {"id": r[0], "author": r[1], "title": r[2], "year": r[3],
                 "list": r[4], "letter": r[6], "ordinal": r[7],
                 "code": f"{r[6]}{r[7]}" if r[6] or r[7] else ""}
                for r in cur.fetchall()
            ]
            cur.execute("select work_id, count(*) from pages group by work_id")
            pages_db = dict(cur.fetchall())

    claimed: set[str] = set()
    buckets: dict[str, list] = {
        "loaded": [], "mapped": [], "ready": [],
        "ambiguous": [], "poor": [], "missing": [], "decided": [],
    }

    for work in works:
        if args.which and args.which.casefold() not in fold(work["list"]):
            continue

        if work["id"] in by_work:
            # A mapped work's file may well be in ACCOUNTED by now, so this
            # looks across the whole corpus rather than the candidate pool.
            for needle in by_work[work["id"]]:
                for p in CORPUS.rglob("*.pdf"):
                    if fold(needle) in fold(p.name):
                        claimed.add(p.name)
            state = "loaded" if pages_db.get(work["id"], 0) else "mapped"
            buckets[state].append((work, [], pages_db.get(work["id"], 0)))
            continue

        # Already judged. Scoring it again would only re-propose the candidate
        # a person has already looked at and rejected.
        if work["id"] in decided:
            buckets["decided"].append((work, [], 0))
            continue

        scored = sorted(
            ((score(work, p), p) for p in pdfs),
            key=lambda s: -s[0],
        )
        scored = [(s, p) for s, p in scored if s > 0][:4]

        if not scored or scored[0][0] < 0.35:
            buckets["missing"].append((work, [], 0))
            continue

        for _, p in scored:
            claimed.add(p.name)

        best, best_path = scored[0]
        runner = scored[1][0] if len(scored) > 1 else 0.0
        verdict = judged.get(best_path.name, "")

        if best >= STRONG and (best - runner) > NEAR:
            state = "poor" if verdict in {"needs OCR", "re-OCR"} else "ready"
        else:
            state = "ambiguous"
        buckets[state].append((work, scored, 0))

    order = ["missing", "ambiguous", "poor", "ready", "decided", "mapped", "loaded"]
    only = [k for k in ("missing", "ready", "ambiguous", "decided") if getattr(args, k, False)]

    if args.leftovers:
        unclaimed = [p for p in pdfs if p.name not in claimed
                     and not any(fold(m) in fold(p.name) for m in all_matches)]
        print(f"\n  {len(unclaimed)} PDFs matching no work in the catalogue.\n")
        print("  Either the work is not catalogued, or the file is not a book.\n")
        for p in unclaimed:
            print(f"    {p.name[:100]}")
        return

    total = sum(len(v) for v in buckets.values())
    print(f"\n  {total} {'works' if args.all_works else 'examinable works'}"
          f"{' on list ' + args.which if args.which else ''}\n")
    for key in order:
        n = len(buckets[key])
        if n:
            print(f"    {n:>4}  {key}")

    for key in (only or order):
        rows = buckets[key]
        if not rows or key in {"loaded", "mapped"} and only:
            continue
        print(f"\n\n  {key.upper()}  ({len(rows)})")
        if key == "missing":
            print("  Nothing in the corpus resembles these. A shopping list.\n")
        elif key == "ambiguous":
            print("  Several candidates. Open them, keep one, delete the rest.\n")
        elif key == "poor":
            print("  The best candidate needs OCR before it is worth loading.\n")
        elif key == "ready":
            print("  One clear candidate and no row yet. Paste the csv line.\n")
        elif key == "decided":
            print("  Judged already, in pipeline/decisions.csv. Remove a line there")
            print("  when a copy turns up.\n")

        for work, scored, pages in rows:
            who = (work["author"] or "\u2014")[:30]
            code = f"{work['list'][:6]} {work['code']}".strip()
            head = f"    {code:<12} {who:<30} {work['title'][:44]}"
            if key == "loaded":
                print(f"{head}  {pages:,}p")
                continue
            print(head)
            if key == "decided":
                d = decided[work["id"]]
                print(f"               {d['state']}: {d['note'][:76]}")
                continue
            print(f"               {work['id']}")
            for value, path in scored:
                mark = "\u2192" if value >= STRONG else " "
                note = judged.get(path.name, "")
                print(f"             {mark} [{value:>4}] {path.name[:76]}"
                      + (f"   [{note}]" if note else ""))
            if key == "ready" and scored:
                title, _ = file_parts(scored[0][1].name)
                clean = re.sub(r"[_\s]+", " ", title).strip()[:56]
                print(f"               csv: {clean},{work['id']},")


if __name__ == "__main__":
    main()
