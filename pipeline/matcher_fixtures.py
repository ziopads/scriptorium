#!/usr/bin/env python3
"""Fixtures for the quotation matcher, shared by the Python and TypeScript sides.

    pipeline/.venv/bin/python3 pipeline/matcher_fixtures.py
        tests/matcher/cases.json -> tests/matcher/expected.json

    pipeline/.venv/bin/python3 pipeline/matcher_fixtures.py --corpus <work id> ...
        tests/matcher/corpus.json, built from Neon (reads only). Gitignored:
        it holds the books' page text.

dossier.py is the specification. expected.json is what its normalize, key and
Book.find return for the hand-written cases, and lib/matcher.ts must return
the same; read expected.json's diff whenever it changes. corpus.json carries
its own expected values, computed the same way.

Both files are checked by pipeline/test_matcher.py (this matcher) and by
tests/matcher.test.ts (lib/matcher.ts).

THE CORPUS CASES, per named work, all deterministic (seeded by the work id):

    every quotation anchored to the work in note_anchors (up to 40), as
    stored, with no page, with the page three off, with one character
    dropped, with accents removed, and broken across a line with a hyphen;
    passages cut from random pages as the page text has them, line breaks
    and all, named on their page, on the next page, and not at all;
    passages running from the end of one page into the next;
    quotations the dossier run could not find (quotes_not_found), if the
    work has a dossier file.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import unicodedata
import zlib
from datetime import datetime, timezone
from pathlib import Path

from dossier import FUZZY_RATIO, Book, key, normalize

ROOT = Path(__file__).parent.parent
FIXTURES = ROOT / "tests" / "matcher"
CASES = FIXTURES / "cases.json"
EXPECTED = FIXTURES / "expected.json"
CORPUS = FIXTURES / "corpus.json"
DOSSIERS = Path(__file__).parent / "dossiers"

MAX_ANCHORS = 40
SPANS = 20
CROSSINGS = 5
MAX_NOT_FOUND = 30


def percent_labels(spec: dict) -> dict[str, str]:
    """The close-match label for every ratio at or above the threshold, for
    quotations of min_length to max_length characters."""
    out = {}
    for length in range(spec["min_length"], spec["max_length"] + 1):
        for matched in range(length + 1):
            ratio = matched / length
            if ratio >= FUZZY_RATIO:
                out[f"{matched}/{length}"] = f"close ({ratio:.0%})"
    return out


def run_find(books: dict[str, Book], case: dict):
    return books[case["book"]].find(case["quote"], case.get("near"), case.get("unit") or [])


def run_cases(cases: dict) -> dict:
    books = {name: Book(pages) for name, pages in cases["books"].items()}
    return {
        "normalize": {c["id"]: normalize(c["input"]) for c in cases["normalize"]},
        "key": {c["id"]: key(c["input"]) for c in cases["key"]},
        "find": {c["id"]: run_find(books, c) for c in cases["find"]},
        "percent": percent_labels(cases["percent"]),
    }


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".json.part")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(path)


# --------------------------------------------------------------------------
# The corpus

def without_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return unicodedata.normalize(
        "NFC", "".join(c for c in decomposed if not unicodedata.combining(c))
    )


def drop_one(text: str, rng: random.Random) -> str:
    third = len(text) // 3
    if third < 1:
        return text
    at = rng.randrange(third, 2 * third)
    return text[:at] + text[at + 1:]


def broken_across_line(text: str, rng: random.Random) -> str:
    words = [(i, w) for i, w in enumerate(text.split(" ")) if len(w) >= 6 and w.isalpha()]
    if not words:
        return text
    i, w = rng.choice(words)
    parts = text.split(" ")
    parts[i] = w[: len(w) // 2] + "-\n" + w[len(w) // 2:]
    return " ".join(parts)


def not_found_quotes(work_id: str) -> list[dict]:
    path = DOSSIERS / f"{work_id}.json"
    if not path.exists():
        return []
    doc = json.loads(path.read_text(encoding="utf-8"))
    records = list(doc.get("claims", {}).values()) + doc.get("dropped_claims", [])
    out = []
    for r in records:
        for q in r.get("quotes_not_found", []):
            if q.get("text"):
                out.append({"text": q["text"], "page": q.get("page")})
    return out[:MAX_NOT_FOUND]


def cases_for(work_id: str, pages: list[dict], anchors: list[tuple]) -> list[dict]:
    rng = random.Random(zlib.crc32(work_id.encode("utf-8")))
    cases: list[dict] = []

    def add(why: str, quote: str, near) -> None:
        cases.append({
            "id": f"{work_id}:{len(cases) + 1}", "why": why,
            "book": work_id, "quote": quote, "near": near,
        })

    for page, quote in anchors:
        add("anchor as stored", quote, page)
        add("anchor, no page", quote, None)
        if page is not None:
            add("anchor, page three off", quote, page + 3)
        add("anchor, one character dropped", drop_one(quote, rng), page)
        folded = without_accents(quote)
        if folded != quote:
            add("anchor, accents removed", folded, page)
        broken = broken_across_line(quote, rng)
        if broken != quote:
            add("anchor, broken across a line", broken, page)

    long_pages = [p for p in pages if len(p["text"]) >= 400]
    for p in rng.sample(long_pages, min(SPANS, len(long_pages))):
        length = rng.randint(40, 160)
        start = rng.randrange(0, len(p["text"]) - length)
        span = p["text"][start:start + length]
        add("passage as the page has it", span, p["printed"])
        add("passage, named on the next page", span, p["printed"] + 1)
        add("passage, no page", span, None)

    for _ in range(min(CROSSINGS, max(len(pages) - 1, 0))):
        n = rng.randrange(0, len(pages) - 1)
        a, b = pages[n]["text"], pages[n + 1]["text"]
        if len(a) < 100 or len(b) < 100:
            continue
        add("passage across a page break", a[-80:] + "\n" + b[:80], pages[n]["printed"])

    for q in not_found_quotes(work_id):
        add("quotation the dossier run did not find", q["text"], q["page"])
    return cases


def corpus(names: list[str]) -> None:
    from dbconn import connect, resolve

    ids = [resolve(n) for n in names]
    books: dict[str, list[dict]] = {}
    cases: list[dict] = []
    with connect() as conn, conn.cursor() as cur:
        for work_id in ids:
            cur.execute(
                "select page_index, printed_page, text from printed_pages"
                " where work_id = %s order by page_index",
                (work_id,),
            )
            pages = [{"index": i, "printed": p, "text": t} for i, p, t in cur.fetchall()]
            if not pages:
                print(f"  {work_id}: no pages loaded, left out")
                continue
            cur.execute(
                "select printed_page, quote from note_anchors"
                " where work_id = %s and quote is not null and quote <> ''"
                " order by note_id, ordinal limit %s",
                (work_id, MAX_ANCHORS),
            )
            anchors = cur.fetchall()
            books[work_id] = pages
            before = len(cases)
            cases.extend(cases_for(work_id, pages, anchors))
            print(f"  {work_id}: {len(pages)} pages, {len(anchors)} anchors,"
                  f" {len(cases) - before} cases")

    built = {w: Book(p) for w, p in books.items()}
    expected = {c["id"]: run_find(built, c) for c in cases}
    found = sum(1 for v in expected.values() if v)
    close = sum(1 for v in expected.values() if v and v["match"] != "exact")
    write_json(CORPUS, {
        "about": "Real pages from Neon and quotations looked up in them by pipeline/dossier.py."
                 " Gitignored: it holds the books' text. Rebuilt by pipeline/matcher_fixtures.py --corpus.",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "works": list(books),
        "books": books,
        "find": cases,
        "expected": expected,
    })
    print(f"\n  {len(cases)} cases: {found} found ({close} close), {len(cases) - found} not found")
    print(f"  Wrote {CORPUS.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", nargs="+", metavar="WORK_ID",
                        help="build corpus.json from these works, by full id")
    args = parser.parse_args()

    if args.corpus:
        corpus(args.corpus)
        return
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    out = run_cases(cases)
    write_json(EXPECTED, {
        "about": "What pipeline/dossier.py returns for cases.json. Generated by"
                 " pipeline/matcher_fixtures.py; do not edit by hand.",
        **out,
    })
    found = sum(1 for v in out["find"].values() if v)
    print(f"  {len(out['normalize'])} normalize, {len(out['key'])} key,"
          f" {len(out['find'])} find ({found} found), {len(out['percent'])} labels")
    print(f"  Wrote {EXPECTED.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
