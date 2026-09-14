#!/usr/bin/env python3
"""Look up bibliographic data for the reading list against public catalogues.

    python3 pipeline/enrich.py --in pipeline/list.csv
    python3 pipeline/enrich.py --in pipeline/list.csv --only-missing

Queries Open Library first, then Google Books for anything it missed. Writes
pipeline/catalogue.csv with one row per candidate — never straight to the
database.

WHY IT PROPOSES RATHER THAN WRITES
    A wrong ISBN is worse than no ISBN. It looks authoritative, it sends her to
    the wrong edition, and edition decides pagination. Blank beats a guess is
    the standing rule here, and an automated title match is exactly the kind of
    guess that reads as fact once it is in a field.

    So every candidate carries a confidence and the matched title as the
    catalogue spells it, and a person accepts or rejects.

WHAT IT IS GOOD FOR AND WHAT IT IS NOT
    Good: English-language academic monographs and anything with a recent
    edition. Open Library's coverage there is strong and the data is clean.

    Weak: Spanish-language editions from Mexican and Spanish presses, older
    imprints, and university press reprints. Expect gaps on Fondo de Cultura
    Económica, Siglo XXI, Ediciones Era. That is most of this list, so treat a
    miss as normal rather than as a failure.

    Both APIs are free and need no key. Open Library asks for a User-Agent that
    identifies you; be a good citizen and leave it set.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PIPELINE = Path(__file__).parent
OUT = PIPELINE / "catalogue.csv"

UA = "Scriptorium/0.1 (doctoral reading-list tool; contact via github.com/ziopads)"

# Open Library asks for roughly one request a second and returns 429 above that.
# 0.6s was too fast and got nine refusals in ten calls.
PAUSE = 1.5
RETRIES = 4


def fold(s: str) -> str:
    d = unicodedata.normalize("NFKD", s or "")
    d = "".join(c for c in d if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", " ", d.casefold()).strip()


def toks(s: str) -> set[str]:
    stop = {"the", "a", "an", "of", "and", "in", "on", "el", "la", "los", "las",
            "un", "una", "de", "del", "y", "en", "que"}
    return {w for w in fold(s).split() if w and w not in stop and len(w) > 2}


def similarity(a: str, b: str) -> float:
    ta, tb = toks(a), toks(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def surname(author: str) -> str:
    a = (author or "").strip()
    if "," in a:
        return fold(a.split(",")[0])
    parts = fold(a).split()
    return parts[-1] if parts else ""


def fetch(url: str) -> dict | None:
    """With backoff. A 429 is not a failure, it is a request to wait — and the
    Retry-After header says how long, when the server bothers to send one."""
    request = urllib.request.Request(url, headers={"User-Agent": UA})

    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                wait = float(exc.headers.get("Retry-After") or 0) or (2 ** attempt) * 3
                print(f"    rate limited, waiting {wait:.0f}s")
                time.sleep(wait)
                continue
            print(f"    ! {exc}")
            return None
        except Exception as exc:  # noqa: BLE001
            print(f"    ! {exc}")
            time.sleep(2)
    return None


def open_library(title: str, author: str) -> list[dict]:
    query = urllib.parse.urlencode(
        {"title": title, "author": author, "limit": 5,
         "fields": "title,author_name,first_publish_year,publisher,isbn,"
                   "publish_place,language,edition_count,key"}
    )
    data = fetch(f"https://openlibrary.org/search.json?{query}")
    if not data:
        return []

    out = []
    for doc in data.get("docs", []):
        isbns = [i for i in (doc.get("isbn") or []) if len(i) == 13] or (doc.get("isbn") or [])
        out.append({
            "source": "openlibrary",
            "title": doc.get("title", ""),
            "author": ", ".join(doc.get("author_name") or []),
            "year": doc.get("first_publish_year") or "",
            "publisher": (doc.get("publisher") or [""])[0],
            "place": (doc.get("publish_place") or [""])[0],
            "isbn": isbns[0] if isbns else "",
            "language": ",".join(doc.get("language") or []),
            "ref": f"https://openlibrary.org{doc.get('key', '')}",
        })
    return out


def google_books(title: str, author: str) -> list[dict]:
    q = f'intitle:"{title}"'
    if author:
        q += f' inauthor:"{author}"'
    query = urllib.parse.urlencode({"q": q, "maxResults": 5})
    data = fetch(f"https://www.googleapis.com/books/v1/volumes?{query}")
    if not data:
        return []

    out = []
    for item in data.get("items", []):
        info = item.get("volumeInfo", {})
        isbn = ""
        for ident in info.get("industryIdentifiers", []):
            if ident.get("type") == "ISBN_13":
                isbn = ident.get("identifier", "")
                break
        out.append({
            "source": "googlebooks",
            "title": info.get("title", ""),
            "author": ", ".join(info.get("authors") or []),
            "year": (info.get("publishedDate") or "")[:4],
            "publisher": info.get("publisher", ""),
            "place": "",
            "isbn": isbn,
            "language": info.get("language", ""),
            "ref": info.get("infoLink", ""),
        })
    return out


def best(item: dict, candidates: list[dict]) -> tuple[dict | None, float]:
    want_surname = surname(item["author"])
    scored = []
    for c in candidates:
        score = similarity(item["title"], c["title"])
        if want_surname and want_surname in fold(c["author"]):
            score += 0.35
        # A listed year that disagrees by more than a couple of years usually
        # means a different edition, which is the thing we care most about.
        if item.get("year") and c.get("year"):
            try:
                if abs(int(item["year"]) - int(c["year"])) <= 2:
                    score += 0.15
            except ValueError:
                pass
        scored.append((c, score))
    if not scored:
        return None, 0.0
    return max(scored, key=lambda pair: pair[1])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="source", required=True,
                        help="CSV with columns: id,author,title,year")
    parser.add_argument("--only-missing", action="store_true",
                        help="skip rows that already have an isbn column filled")
    parser.add_argument("--restart", action="store_true",
                        help="ignore previous results and look everything up again")
    args = parser.parse_args()

    with Path(args.source).open(encoding="utf-8") as handle:
        items = list(csv.DictReader(handle))

    # Resumable. 156 lookups across two rate-limited APIs will be interrupted
    # sooner or later, and redoing the completed ones wastes the quota that
    # caused the interruption.
    done: dict[str, dict] = {}
    if OUT.exists() and not args.restart:
        with OUT.open(encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                if row.get("id"):
                    done[row["id"]] = row
        if done:
            print(f"  resuming: {len(done)} already looked up\n")

    rows = list(done.values())

    def flush() -> None:
        fields = sorted({k for r in rows for k in r})
        with OUT.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)

    for index, item in enumerate(items, start=1):
        if item.get("id") in done:
            continue
        if args.only_missing and item.get("isbn", "").strip():
            continue

        title = item.get("title", "").strip()
        author = item.get("author", "").strip()
        if not title:
            continue

        print(f"  [{index}/{len(items)}] {title[:56]}")

        candidates = open_library(title, author)
        time.sleep(PAUSE)
        pick, score = best(item, candidates)

        if score < 0.8:
            more = google_books(title, author)
            time.sleep(PAUSE)
            pick2, score2 = best(item, more)
            if score2 > score:
                pick, score = pick2, score2

        if not pick:
            rows.append({"id": item.get("id", ""), "list_title": title,
                         "list_author": author, "verdict": "nothing found",
                         "confidence": 0})
            flush()
            continue

        rows.append({
            "id": item.get("id", ""),
            "list_author": author,
            "list_title": title,
            "list_year": item.get("year", ""),
            "found_title": pick["title"],
            "found_author": pick["author"],
            "found_year": pick["year"],
            "publisher": pick["publisher"],
            "place": pick["place"],
            "isbn": pick["isbn"],
            "language": pick["language"],
            "source": pick["source"],
            "ref": pick["ref"],
            "confidence": round(score, 2),
            "verdict": (
                "accept" if score >= 1.1 else "check" if score >= 0.75 else "doubtful"
            ),
        })

        print(f"        {rows[-1]['verdict']:<10} {score:.2f}  {pick['title'][:52]}")
        flush()

    if not rows:
        sys.exit("nothing to write")

    counts: dict[str, int] = {}
    for row in rows:
        counts[row.get("verdict", "")] = counts.get(row.get("verdict", ""), 0) + 1

    print(f"\n  {len(rows)} looked up")
    for verdict, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"    {verdict:<14} {count}")
    print(f"\n  Wrote {OUT}")
    print("  Read the 'check' rows before accepting. A wrong ISBN points at the")
    print("  wrong edition, and edition decides pagination.")


if __name__ == "__main__":
    main()
