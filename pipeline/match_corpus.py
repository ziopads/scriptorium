#!/usr/bin/env python3
"""Match reading-list items to files in the corpus.

    python3 pipeline/match_corpus.py
    python3 pipeline/match_corpus.py --show-scores

Reads pipeline/list.csv (from parse_list.py), pipeline/overrides.csv, and the
files in pipeline/corpus. Writes pipeline/matches.csv.

TWO SOURCES OF TRUTH, IN ORDER

    overrides.csv is authoritative and hand-maintained. A pair recorded there
    can never be lost, whatever the matcher does. This exists because it was
    lost once: an earlier pass had 27 verified pairs in a curated table, the
    matcher replaced them, and a book we had held all along came back on her
    still-needed list. Verification is data, not a step.

    The matcher fills the rest and is deliberately conservative. It proposes;
    anything it is unsure of goes to a review list rather than into the result.

WHAT THE MATCHER CANNOT DO, AND WHY OVERRIDES EXIST
    It compares title tokens and author surnames. That fails completely on:

      cross-language editions   an English list entry and a Spanish translation
                                share no title tokens. Specters of Marx against
                                Espectros de Marx scores zero.
      misspelled filenames      "Polemics of Possesion" — one letter short, and
                                the token no longer matches.
      bare filenames            a file with no " -- " separators has no author
                                field, so the surname check cannot help.

    Each of those is a judgement about whether two things are the same work.
    That belongs to a person, and once made it belongs in overrides.csv.

NEVER RECORD A NEGATIVE IN overrides.csv
    A blank filename_contains asserts "not held", and overrides beat the
    matcher. So a line saying Don Chipote was not held survived the arrival of
    Don Chipote and suppressed the file. Absence is what the matcher concludes
    when it finds nothing; it is also the fact most likely to change. Overrides
    should only ever assert a pairing.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from pathlib import Path

PIPELINE = Path(__file__).parent
CORPUS = PIPELINE / "corpus"
LIST = PIPELINE / "list.csv"
OVERRIDES = PIPELINE / "overrides.csv"
OUT = PIPELINE / "matches.csv"

EXTENSIONS = {".pdf", ".epub", ".azw3", ".lcpdf", ".zip", ".txt"}

# Formats with no fixed page model: searchable, but not citable to a page.
NO_PAGES = {".epub", ".azw3", ".txt", ".zip"}

STOP = {
    "the", "a", "an", "of", "and", "in", "on", "to", "for", "from", "with", "its",
    "el", "la", "los", "las", "un", "una", "de", "del", "y", "e", "en", "que",
    "su", "sus", "al", "lo", "por", "o", "sobre", "essays", "stories", "poems",
    "novel", "new", "tales",
}

# Files that are working documents rather than works.
NOT_A_WORK = re.compile(
    r"(calendario|^comps 2026|lista|cuadro|literatura chicana para comps|\.ds_store)",
    re.I,
)

ACCEPT = 70          # score at or above which a match is taken
REVIEW = 45          # between REVIEW and ACCEPT: reported, not taken


def fold(s: str) -> str:
    d = unicodedata.normalize("NFKD", s or "")
    d = "".join(c for c in d if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", " ", d.casefold())


def toks(s: str) -> list[str]:
    return [w for w in fold(s).split() if w and w not in STOP and len(w) > 2]


def surname(author: str) -> str:
    a = (author or "").strip()
    if not a:
        return ""
    if "," in a:
        return fold(a.split(",")[0]).strip()
    parts = fold(a).split()
    return parts[-1] if parts else ""


def parse_filename(path: Path) -> dict:
    """Anna's Archive names are 'Title -- Author -- ... -- isbn13 N -- ...'."""
    stem = path.stem
    parts = [p.strip() for p in re.split(r"\s+--\s+", stem)]
    m = re.search(r"isbn13\s*(\d{13})|(?<!\d)(97[89]\d{10})(?!\d)", stem)
    return {
        "path": path,
        "name": path.name,
        "title": parts[0] if parts else stem,
        "author": parts[1] if len(parts) > 1 else "",
        "isbn": (m.group(1) or m.group(2)) if m else "",
        "ext": path.suffix.lower(),
    }


def score(item: dict, f: dict) -> int:
    if item.get("isbn") and f["isbn"] and item["isbn"] == f["isbn"]:
        return 100

    it = toks(item["title"]) + toks(item.get("other_titles", ""))
    ft = toks(f["title"])
    if not it or not ft:
        return 0

    overlap = len(set(it) & set(ft))
    ratio = overlap / min(len(it), len(ft))

    isn, fsn = surname(item["author"]), surname(f["author"])
    author_hit = bool(isn) and bool(fsn) and (isn in fsn or fsn in isn)

    # A surname in a bare filename, where the author field is empty.
    if not author_hit and isn and isn in fold(f["title"]):
        author_hit = True

    # Short titles cannot reach the bands below, because after stopwords they
    # leave one or two tokens and every band wants two overlapping. Cartucho,
    # Naufragios, Poética, Tomóchic, Los de abajo and The Guardians all scored
    # zero against files sitting in the corpus. For these the test is that every
    # token is present and the author agrees — which is stricter, not looser.
    if len(it) <= 2:
        if set(it) <= set(ft) and author_hit:
            return 90
        if set(it) <= set(ft) and len(ft) <= 3:
            return 65
        return 0

    s = 0
    lead = " ".join(it[:3])
    if lead and lead in " ".join(ft):
        s = 85
    elif ratio >= 0.75 and overlap >= 2:
        s = 65
    elif ratio >= 0.5 and overlap >= 2:
        s = 45
    elif overlap >= 3:
        s = 40

    if author_hit:
        s += 25
    return s


# Preference when one work has several files. A PDF can be cited to a page; an
# EPUB cannot. A DRM-locked file cannot even be opened.
RANK = {".pdf": 0, ".epub": 1, ".azw3": 2, ".txt": 3, ".zip": 4, ".lcpdf": 5}


def prefer(a: dict, b: dict) -> dict:
    return a if RANK.get(a["ext"], 9) <= RANK.get(b["ext"], 9) else b


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--show-scores", action="store_true")
    args = parser.parse_args()

    for path in (LIST, OVERRIDES):
        if not path.exists():
            sys.exit(f"{path} not found")

    with LIST.open(encoding="utf-8") as handle:
        items = list(csv.DictReader(handle))

    with OVERRIDES.open(encoding="utf-8") as handle:
        rules = [r for r in csv.DictReader(handle) if r["list_title_contains"].strip()]

    files = [
        parse_filename(p)
        for p in sorted(CORPUS.rglob("*"))
        if p.suffix.lower() in EXTENSIONS and not NOT_A_WORK.search(p.name)
    ]
    if not files:
        sys.exit(f"no files under {CORPUS}")

    claimed: dict[str, list[str]] = {}
    review: list[tuple[dict, dict, int]] = []

    for item in items:
        item["file"], item["how"], item["note"] = "", "", ""

        # 1. Overrides win, always.
        for rule in rules:
            needle = fold(rule["list_title_contains"].strip())
            if needle and needle in fold(item["title"]):
                target = rule["filename_contains"].strip()
                if not target:
                    # A negative override. Kept working only for historical
                    # rows; see the warning at the top of this file.
                    item["how"] = "override: not held"
                    item["note"] = rule.get("note", "")
                    break
                for f in files:
                    if fold(target) in fold(f["name"]):
                        item["file"] = f["name"]
                        item["ext"] = f["ext"]
                        item["file_isbn"] = f["isbn"]
                        item["how"] = "override"
                        item["note"] = rule.get("note", "")
                        break
                break

        if item["file"] or item["how"]:
            if item["file"]:
                claimed.setdefault(item["file"], []).append(item["id"])
            continue

        # 2. Otherwise the matcher, conservatively. Where several files tie,
        # the one that can be cited wins.
        best, best_score = None, 0
        for f in files:
            s = score(item, f)
            if s > best_score:
                best, best_score = f, s
            elif s == best_score and best is not None and s > 0:
                best = prefer(best, f)

        if best and best_score >= ACCEPT:
            item["file"] = best["name"]
            item["ext"] = best["ext"]
            item["file_isbn"] = best["isbn"]
            item["how"] = f"matched ({best_score})"
            claimed.setdefault(best["name"], []).append(item["id"])
        elif best and best_score >= REVIEW:
            review.append((item, best, best_score))

    for item in items:
        item.setdefault("ext", "")
        item.setdefault("file_isbn", "")
        item["citable"] = (
            "" if not item["file"] else "no" if item["ext"] in NO_PAGES else "yes"
        )

    fields = list(items[0].keys())
    with OUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(items)

    exam = [i for i in items if i["examinable"] == "yes"]
    held = [i for i in exam if i["file"]]
    no_pages = [i for i in held if i["citable"] == "no"]
    overridden = [i for i in items if i["how"].startswith("override") and i["file"]]
    unclaimed = [f["name"] for f in files if f["name"] not in claimed]

    print(f"\n  {len(items)} list items, {len(files)} files")
    print(f"  examinable: {len(held)} of {len(exam)} held, "
          f"{len(exam) - len(held)} still needed")
    print(f"  of those held, {len(no_pages)} have no page numbers")
    print(f"  {len(overridden)} pairs came from overrides.csv")

    if review:
        print(f"\n  {len(review)} near misses — add to overrides.csv or ignore:")
        for item, f, s in sorted(review, key=lambda r: -r[2]):
            print(f"    [{s:>3}] {item['title'][:44]:<44} ?  {f['name'][:52]}")

    doubled = {k: v for k, v in claimed.items() if len(v) > 1}
    if doubled:
        print(f"\n  {len(doubled)} files claimed by more than one item:")
        for name, ids in doubled.items():
            print(f"    {name[:56]}")
            for i in ids:
                print(f"        {i}")

    print(f"\n  {len(unclaimed)} files match no list item")
    if args.show_scores:
        for name in unclaimed:
            print(f"    {name[:92]}")

    print(f"\n  Wrote {OUT}")


if __name__ == "__main__":
    main()
