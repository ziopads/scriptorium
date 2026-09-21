#!/usr/bin/env python3
"""Look up bibliographic data for the catalogue against public catalogues.

    python3 pipeline/enrich.py --by-isbn                  # by ISBN; writes proposals
    python3 pipeline/enrich.py --apply --dry-run          # what --apply would write
    python3 pipeline/enrich.py --apply                    # write the accepted proposals
    python3 pipeline/enrich.py --in pipeline/list.csv     # by title and author (see below)

Queries Open Library first, then Google Books for anything it missed. Every
lookup writes proposals to a CSV; nothing reaches the database until --apply,
and --apply fills only fields that are blank.

WHY IT PROPOSES RATHER THAN WRITES
    A wrong ISBN is worse than no ISBN. It looks authoritative, it sends her to
    the wrong edition, and edition decides pagination. Blank beats a guess is
    the standing rule here, and an automated match is exactly the kind of guess
    that reads as fact once it is in a field.

BY ISBN FIRST
    An ISBN names one edition, so a lookup by ISBN returns that edition's
    publisher, place and year, not the nearest title a search engine found.
    --by-isbn takes each examinable book's ISBN from the record, or failing
    that from the pick in pipeline/isbns.csv (read from the book's own PDF by
    pipeline/isbns.py), and writes:

        pipeline/imprints.csv    one row per book looked up: the record's
                                 values, the catalogue's, the title each gives,
                                 and an accept column. accept is filled with y
                                 when the catalogue's title matches the
                                 record's; otherwise it is left for a person.
        pipeline/outstanding.csv every examinable book still missing a
                                 citation field after the lookup, and why: no
                                 ISBN, several ISBNs, nothing in the catalogues.

    Read imprints.csv, change accept where you disagree, then --apply.

BY TITLE ONLY ON PURPOSE
    --in runs the older search by title and author, which proposes candidates
    with a confidence. It is weak for Spanish-language editions from Mexican
    and Spanish presses (Fondo de Cultura Económica, Siglo XXI, Era), which is
    most of this list. It is kept for the books outstanding.csv lists, to be
    run once that list has been read, and never as part of --by-isbn.

    Both APIs are free and need no key. Open Library asks for a User-Agent that
    identifies you; leave it set.
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
ISBNS = PIPELINE / "isbns.csv"
IMPRINTS = PIPELINE / "imprints.csv"
OUTSTANDING = PIPELINE / "outstanding.csv"

UA = "Scriptorium/0.1 (doctoral reading-list tool; contact via github.com/ziopads)"

# Open Library asks for roughly one request a second and returns 429 above that.
# 0.6s was too fast and got nine refusals in ten calls.
PAUSE = 1.5
RETRIES = 4

# A catalogue title this close to the record's is taken as the same book, and
# its proposal is marked accepted for review. Below it, a person decides.
TITLE_MATCH = 0.5


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


def year_of(value) -> str:
    m = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", str(value or ""))
    return m.group(1) if m else ""


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


# --------------------------------------------------------------------------
# By ISBN

def open_library_isbn(isbn: str) -> dict | None:
    data = fetch(
        "https://openlibrary.org/api/books?"
        + urllib.parse.urlencode({"bibkeys": f"ISBN:{isbn}", "format": "json", "jscmd": "data"})
    )
    record = (data or {}).get(f"ISBN:{isbn}")
    if not record:
        return None
    return {
        "source": "openlibrary",
        "title": record.get("title", ""),
        "publisher": ((record.get("publishers") or [{}])[0]).get("name", ""),
        "place": ((record.get("publish_places") or [{}])[0]).get("name", ""),
        "year": year_of(record.get("publish_date")),
        "ref": record.get("url", ""),
    }


def google_books_isbn(isbn: str) -> dict | None:
    data = fetch(
        "https://www.googleapis.com/books/v1/volumes?"
        + urllib.parse.urlencode({"q": f"isbn:{isbn}", "maxResults": 1})
    )
    items = (data or {}).get("items") or []
    if not items:
        return None
    info = items[0].get("volumeInfo", {})
    return {
        "source": "googlebooks",
        "title": info.get("title", ""),
        "publisher": info.get("publisher", ""),
        "place": "",
        "year": year_of(info.get("publishedDate")),
        "ref": info.get("infoLink", ""),
    }


def isbn_picks() -> dict[str, tuple[str, str]]:
    """work_id -> (isbn picked from its PDF, or '', and why), from isbns.csv."""
    if not ISBNS.exists():
        return {}
    out: dict[str, tuple[str, str]] = {}
    with ISBNS.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            work_id = row.get("work_id", "")
            if not work_id:
                continue
            if row.get("pick") == "yes":
                out[work_id] = (row["isbn13"], row.get("why", ""))
            else:
                out.setdefault(work_id, ("", row.get("why", "")))
    return out


def by_isbn() -> None:
    from dbconn import connect

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select w.id, coalesce(w.author, w.editor, ''), w.title,
                       coalesce(w.publisher, ''), coalesce(w.place, ''),
                       coalesce(w.year::text, ''), coalesce(w.isbn, ''),
                       w.source_path is not null
                from works w
                where w.container_id is null and w.kind <> 'film'
                  and exists (select 1 from examinable_works e where e.id = w.id)
                order by coalesce(w.author, w.title)
                """
            )
            works = cur.fetchall()

    if not ISBNS.exists():
        print(f"  {ISBNS.name} not found: only ISBNs already in the record will be looked up.")
        print("  Run pipeline/isbns.py first to read ISBNs from the PDFs.\n")
    picks = isbn_picks()

    proposals: list[dict] = []
    outstanding: list[dict] = []

    for (work_id, author, title, publisher, place, year, isbn_now, has_file) in works:
        missing = [f for f, v in (("publisher", publisher), ("place", place), ("year", year)) if not v]
        pdf_isbn, why = picks.get(work_id, ("", ""))
        isbn = isbn_now or pdf_isbn
        isbn_from = "record" if isbn_now else ("pdf" if pdf_isbn else "")

        if not missing and isbn_now:
            continue

        if not isbn:
            reason = (
                "no file, so no ISBN from a PDF" if not has_file
                else f"no ISBN from the PDF ({why})" if why
                else "PDF not scanned by isbns.py"
            )
            if missing or not isbn_now:
                outstanding.append({"work_id": work_id, "author": author, "title": title,
                                    "missing": ", ".join(missing + ["isbn"]), "reason": reason})
            continue

        print(f"  {work_id[:56]:<56} {isbn}", end="", flush=True)
        found = open_library_isbn(isbn)
        time.sleep(PAUSE)
        if not found or not (found["publisher"] and found["year"]):
            more = google_books_isbn(isbn)
            time.sleep(PAUSE)
            if more and not found:
                found = more
            elif more and found:
                found = {**more, **{k: v for k, v in found.items() if v}}

        if not found:
            print("  nothing in the catalogues")
            outstanding.append({"work_id": work_id, "author": author, "title": title,
                                "missing": ", ".join(missing), "reason": f"ISBN {isbn} not in the catalogues"})
            if isbn_from == "pdf":
                proposals.append({"work_id": work_id, "accept": "", "title_match": "",
                                  "isbn": isbn, "isbn_from": isbn_from,
                                  "title_record": title, "title_found": "",
                                  "publisher_record": publisher, "publisher_found": "",
                                  "place_record": place, "place_found": "",
                                  "year_record": year, "year_found": "",
                                  "source": "", "ref": ""})
            continue

        match = round(similarity(title, found["title"]), 2)
        accept = "y" if match >= TITLE_MATCH else ""
        print(f"  {found['source']}  title match {match}{'' if accept else '  (check)'}")
        proposals.append({
            "work_id": work_id, "accept": accept, "title_match": match,
            "isbn": isbn, "isbn_from": isbn_from,
            "title_record": title, "title_found": found["title"],
            "publisher_record": publisher, "publisher_found": found["publisher"],
            "place_record": place, "place_found": found["place"],
            "year_record": year, "year_found": found["year"],
            "source": found["source"], "ref": found["ref"],
        })

        still = [f for f in missing if not found.get(f)]
        if still:
            outstanding.append({"work_id": work_id, "author": author, "title": title,
                                "missing": ", ".join(still),
                                "reason": f"{found['source']} has no {', '.join(still)}"})

    fields = ["work_id", "accept", "title_match", "isbn", "isbn_from",
              "title_record", "title_found",
              "publisher_record", "publisher_found",
              "place_record", "place_found",
              "year_record", "year_found", "source", "ref"]
    with IMPRINTS.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(proposals)
    with OUTSTANDING.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["work_id", "author", "title", "missing", "reason"])
        writer.writeheader()
        writer.writerows(outstanding)

    accepted = sum(1 for p in proposals if p["accept"] == "y")
    print(f"\n  {len(proposals)} books looked up by ISBN: {accepted} marked y, "
          f"{len(proposals) - accepted} left for you to decide")
    print(f"  {len(outstanding)} books still outstanding")
    reasons: dict[str, int] = {}
    for o in outstanding:
        key = re.sub(r"\(.*\)|ISBN \d+|openlibrary|googlebooks", "", o["reason"]).strip()
        reasons[key] = reasons.get(key, 0) + 1
    for reason, count in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print(f"    {count:>3}  {reason}")
    print(f"\n  Wrote {IMPRINTS} and {OUTSTANDING}")
    print("  Read imprints.csv and set accept to y or blank, then --apply --dry-run.")


# --------------------------------------------------------------------------
# Apply

def apply(dry_run: bool) -> None:
    """Write the accepted rows of imprints.csv into Neon, filling only fields
    that are blank. A field already recorded is never overwritten, whatever
    the catalogue says: a disagreement is for a person to settle on the
    Citations tab."""
    from dbconn import connect

    if not IMPRINTS.exists():
        sys.exit(f"{IMPRINTS.name} not found: run --by-isbn first")
    with IMPRINTS.open(encoding="utf-8") as handle:
        rows = [r for r in csv.DictReader(handle)
                if r.get("accept", "").strip().lower() in ("y", "yes")]
    if not rows:
        sys.exit("no rows marked y in imprints.csv")

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select id, coalesce(isbn, ''), coalesce(publisher, ''), coalesce(place, ''),"
                " year from works where id = any(%s)",
                ([r["work_id"] for r in rows],),
            )
            now = {r[0]: r[1:] for r in cur.fetchall()}

        changes: list[tuple[str, dict]] = []
        for r in rows:
            if r["work_id"] not in now:
                print(f"  ! {r['work_id']}: no such work, skipped")
                continue
            isbn, publisher, place, year = now[r["work_id"]]
            fill = {}
            if not isbn and r.get("isbn"):
                fill["isbn"] = r["isbn"]
            if not publisher and r.get("publisher_found"):
                fill["publisher"] = r["publisher_found"]
            if not place and r.get("place_found"):
                fill["place"] = r["place_found"]
            if year is None and year_of(r.get("year_found")):
                fill["year"] = int(year_of(r["year_found"]))
            if fill:
                changes.append((r["work_id"], fill))

        for work_id, fill in changes:
            shown = "; ".join(f"{k} = {v}" for k, v in fill.items())
            print(f"  {work_id[:52]:<52} {shown}")
        print(f"\n  {len(changes)} books, "
              f"{sum(len(f) for _, f in changes)} blank fields to fill")
        if dry_run:
            print("  dry run: nothing written")
            return

        with conn.transaction():
            with conn.cursor() as cur:
                for work_id, fill in changes:
                    cur.execute(
                        """
                        update works set
                          isbn = coalesce(nullif(isbn, ''), %s),
                          publisher = coalesce(nullif(publisher, ''), %s),
                          place = coalesce(nullif(place, ''), %s),
                          year = coalesce(year, %s),
                          updated_at = now()
                        where id = %s
                        """,
                        (fill.get("isbn"), fill.get("publisher"), fill.get("place"),
                         fill.get("year"), work_id),
                    )
    print(f"  {len(changes)} books updated")


# --------------------------------------------------------------------------
# By title and author: the older search, for outstanding books only

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


def by_title(source: str, only_missing: bool, restart: bool) -> None:
    with Path(source).open(encoding="utf-8") as handle:
        items = list(csv.DictReader(handle))

    # Resumable. Lookups across two rate-limited APIs will be interrupted
    # sooner or later, and redoing the completed ones wastes the quota that
    # caused the interruption.
    done: dict[str, dict] = {}
    if OUT.exists() and not restart:
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
        if only_missing and item.get("isbn", "").strip():
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--by-isbn", action="store_true",
                        help="look up each examinable book by its ISBN; writes imprints.csv")
    parser.add_argument("--apply", action="store_true",
                        help="write the accepted rows of imprints.csv, blank fields only")
    parser.add_argument("--dry-run", action="store_true",
                        help="with --apply: report, write nothing")
    parser.add_argument("--in", dest="source",
                        help="by title and author: CSV with columns id,author,title,year")
    parser.add_argument("--only-missing", action="store_true",
                        help="by title: skip rows that already have an isbn column filled")
    parser.add_argument("--restart", action="store_true",
                        help="by title: ignore previous results and look everything up again")
    args = parser.parse_args()

    if args.by_isbn:
        by_isbn()
    elif args.apply:
        apply(args.dry_run)
    elif args.source:
        by_title(args.source, args.only_missing, args.restart)
    else:
        parser.error("choose --by-isbn, --apply, or --in FILE")


if __name__ == "__main__":
    main()
