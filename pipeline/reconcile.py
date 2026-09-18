#!/usr/bin/env python3
"""Compare a reading-list document against the catalogue. Reports; writes nothing.

    python3 pipeline/reconcile.py "$HOME/Desktop/Lists_Zazil_Collins_Octubre_2026.pdf"
    python3 pipeline/reconcile.py <doc> --csv       # also write pipeline/reconcile.csv
    python3 pipeline/reconcile.py <doc> --new       # only what the catalogue lacks
    python3 pipeline/reconcile.py <doc> --moved     # only what changed list or section

Takes .pdf or .docx. The list arrives as whichever the department last sent.

WHY THIS EXISTS

    Lotman's Estructura del texto artístico was number 19 on a theory list and
    was not in the catalogue. Nobody knew, because nothing had ever compared the
    document to the database. Two ways that happened, and both are structural:

    parse_list.py drops an entry whose title it cannot find — no italics, no
    quotation marks, no colon — with one printed warning that scrolls past. A
    silent loss at the only point where a loss is unrecoverable, since a work
    that never enters the catalogue can never be noticed missing from it.

    And the document moves. Sections are dissolved and their works pushed into
    Supplementary; a whole section is cut and everything after it renumbers; new
    works arrive. A parser written against one version produces nonsense from
    the next, and the catalogue silently describes a list that no longer exists.

    So this never parses in order to load. It parses to ask four questions:

      new           in the document, absent from the catalogue
      gone          on a list in the catalogue, absent from the document
      moved         matched, but the list, the section or the ordinal changed
      demoted       matched, but now under Supplementary

    Matching is by author surname and title words, scored. It is meant to be
    read by a person, which is why nothing here writes to the database.

REQUIRES python-docx for .docx, pymupdf for .pdf, and dbconn for the catalogue.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from pathlib import Path

from dbconn import connect

OUT = Path(__file__).parent / "reconcile.csv"

# A list heading is a roman numeral and a name in capitals; a section heading is
# a single letter and a name in title case. Both begin "X. ", and Dissertation's
# section I would otherwise read as list I, so the case of what follows decides.
LIST_HEADING = re.compile(r"^(I{1,3}|IV|V)\.\s+(.{4,})$")
SECTION_HEADING = re.compile(r"^([A-Z])\.\s+(.{4,})$")
ITEM = re.compile(r"^(\d{1,3})\.\s+(.+)$")

# The unnumbered blocks. Each may carry a subtitle after a colon — "WORKING
# FILMOGRAPHY: HAUNTING AND THE BORDER" — and missing that colon was worth
# twelve false moves: the filmography's heading went unrecognised, so its
# thirteen films were counted as a continuation of the bibliography and every
# one of them appeared to have changed list.
UNNUMBERED_LIST = re.compile(r"^(WORKING\s+[A-Z]+|Supplementary)\b", re.IGNORECASE)

STOP = {
    "the", "a", "an", "of", "and", "in", "to", "for", "from", "on", "with", "at",
    "la", "el", "los", "las", "de", "del", "y", "en", "un", "una", "al", "por",
    "university", "press", "editorial", "ediciones", "books", "edition", "ed",
    "traduccion", "traduccion", "edicion", "translated", "prologo",
}


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
            if b and b not in {"de", "del", "la", "y", "von", "van"}]
    return bits[-1] if bits else ""


# --------------------------------------------------------------------------
# Reading the document
# --------------------------------------------------------------------------

def lines_from_pdf(path: Path) -> list[str]:
    try:
        import fitz
    except ImportError:
        sys.exit("pymupdf is not installed. Run: pipeline/.venv/bin/pip install pymupdf")
    out: list[str] = []
    with fitz.open(path) as doc:
        for page in doc:
            out.extend(page.get_text("text").split("\n"))
    return out


def lines_from_docx(path: Path) -> list[str]:
    try:
        from docx import Document
    except ImportError:
        sys.exit("python-docx is not installed. Run: pipeline/.venv/bin/pip install python-docx")

    document = Document(str(path))
    out: list[str] = []
    for paragraph in document.paragraphs:
        text = " ".join(paragraph.text.split())
        if not text:
            continue
        # Word's automatic numbering is not in the text, so a numbered item
        # arrives without its number. Restore one so both formats parse the
        # same way; the ordinal is recomputed per section below regardless.
        numbered = bool(paragraph._p.findall(".//{*}numPr"))
        if numbered and not ITEM.match(text):
            text = f"0. {text}"
        out.append(text)
    return out


def parse(path: Path) -> list[dict]:
    raw = lines_from_pdf(path) if path.suffix.lower() == ".pdf" else lines_from_docx(path)

    rows: list[dict] = []
    list_name = "(before any list)"
    section = ""
    supplementary = False
    counter = 0

    for line in raw:
        text = " ".join(line.split())
        if not text or len(text) < 3:
            continue

        # A line that only says what the pages hold, not an entry.
        if text.startswith("Count:") or "COMPREHENSIVE EXAMINATION" in text:
            continue
        if re.match(r"^(Chapter-level|Not examinable|Sixteenth|Department of|Teaching el)", text):
            continue

        bare = UNNUMBERED_LIST.match(text)
        if bare and len(text) < 80:
            if text.lower().startswith("supplementary"):
                section, supplementary, counter = "Supplementary", True, 0
            else:
                # Working bibliography and working filmography are their own
                # lists and neither is examinable.
                list_name = text.split(":")[0].title().strip()
                section, supplementary, counter = "", False, 0
            continue

        heading = LIST_HEADING.match(text)
        if heading and heading.group(2).isupper():
            list_name = text
            section, supplementary, counter = "", False, 0
            continue

        item = ITEM.match(text)
        if item:
            body = item.group(2).strip()
            counter += 1
            rows.append({
                "list": list_name,
                "section": section,
                "supplementary": supplementary,
                "ordinal": counter,
                "printed_ordinal": int(item.group(1)) or counter,
                "entry": body,
            })
            continue

        section_head = SECTION_HEADING.match(text)
        if section_head and not section_head.group(2).isupper() and len(text) < 100:
            section = text
            counter = 0
            continue

        # Anything else is the continuation of the entry above it, which is how
        # a PDF returns a citation that wrapped across lines.
        if rows:
            rows[-1]["entry"] += " " + text

    for row in rows:
        row["author"] = row["entry"].split(".")[0].strip()[:90]
        row["title"] = title_of(row["entry"])
        years = re.findall(r"\b(1[5-9]\d\d|20[0-2]\d)\b", row["entry"])
        row["year"] = years[-1] if years else ""
    return rows


def title_of(entry: str) -> str:
    """Never empty. parse_list.py dropped an entry whose title it could not
    find; losing the entry is far worse than mis-titling it."""
    quoted = re.search(r'[\u201c\u201d"]([^\u201c\u201d"]{4,})[\u201c\u201d"]', entry)
    parts = [p.strip() for p in re.split(r"(?<!\w\.)\.\s+", entry) if p.strip()]
    if len(parts) >= 2:
        after_author = parts[1].strip(" .,;:")
        # A quoted piece before the title is an essay inside the volume; the
        # volume's title is what the catalogue holds.
        if quoted and len(after_author) < 4:
            return quoted.group(1).strip(" .")
        return after_author
    if quoted:
        return quoted.group(1).strip(" .")
    return entry[:80]


# --------------------------------------------------------------------------
# Matching
# --------------------------------------------------------------------------

def best_match(row: dict, catalogue: list[dict]):
    needle = words(f"{row['author']} {row['title']}")
    sur = surname(row["author"])
    best, best_score = None, 0.0
    for work in catalogue:
        hay = words(f"{work['author'] or ''} {work['title']}")
        if not hay:
            continue
        shared = needle & hay
        if not shared:
            continue
        score = len(shared) / len(hay)
        if sur and sur == surname(work["author"] or ""):
            score += 0.35
        if row["year"] and str(work["year"] or "") == row["year"]:
            score += 0.1
        if score > best_score:
            best, best_score = work, min(score, 1.0)
    return best, round(best_score, 2)


def assign(rows: list[dict], catalogue: list[dict], threshold: float):
    """Match entries to works, one apiece, best pairs first.

    Entry-by-entry matching let two entries claim one work. The document lists
    Lacan's Escritos 1 and an essay inside it, and Castillo's Massacre of the
    Dreamers and The Guardians; taking each entry's best match in turn gave both
    Lacan entries the same work and both Castillo entries the same work, which
    then reported the losers as cut from the list. Six works were about to come
    off the comps list on the strength of that.

    So: score every pair, sort, and assign greedily. A work can be claimed once
    and an entry can claim once, so the second-best pairing gets its turn.
    """
    pairs = []
    for i, row in enumerate(rows):
        needle = words(f"{row['author']} {row['title']}")
        sur = surname(row["author"])
        for work in catalogue:
            hay = words(f"{work['author'] or ''} {work['title']}")
            if not hay:
                continue
            shared = needle & hay
            if not shared:
                continue
            score = len(shared) / len(hay)
            if sur and sur == surname(work["author"] or ""):
                score += 0.35
            if row["year"] and str(work["year"] or "") == row["year"]:
                score += 0.1
            # Coverage alone ties when one author has two books and each
            # title's words are wholly inside the other entry's text: Keetley's
            # Folk Gothic and Folk Horror: New Global Pathways scored level and
            # the greedy pass swapped them, putting the wrong book in section F.
            # Overlap in both directions breaks it, because the entry that also
            # says the fewest OTHER things about a work is the entry for it.
            union = needle | hay
            jaccard = len(shared) / len(union) if union else 0.0
            pairs.append((min(round(score, 2), 1.0), round(jaccard, 3), i, work))

    pairs.sort(key=lambda p: (-p[0], -p[1]))

    taken_rows: dict[int, tuple[dict, float]] = {}
    taken_works: set[str] = set()
    for score, _, i, work in pairs:
        if score < threshold or i in taken_rows or work["id"] in taken_works:
            continue
        taken_rows[i] = (work, score)
        taken_works.add(work["id"])

    # An entry that names two works — "Pedro Páramo ; y El llano en llamas",
    # "Cajas de cartón … Senderos fronterizos" — can only claim one of them, so
    # the other looks cut. Where an unclaimed work's title appears in an entry
    # that is already matched, it is the second half of that entry and shares
    # its place on the list. make_seed.py carries a hand-written SPLITS table
    # for the same reason; this derives it from the text instead.
    splits: list[tuple[int, dict, float]] = []
    for work in catalogue:
        if work["id"] in taken_works or not work["on_a_list"]:
            continue
        title = words(work["title"] or "")
        if len(title) < 2:
            continue
        for i, row in enumerate(rows):
            if i not in taken_rows:
                continue
            if title <= words(row["entry"]):
                splits.append((i, work, 1.0))
                taken_works.add(work["id"])
                break

    return taken_rows, splits, taken_works


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("document")
    parser.add_argument("--csv", action="store_true")
    parser.add_argument("--new", action="store_true", help="only what the catalogue lacks")
    parser.add_argument("--gone", action="store_true", help="only what the document lacks")
    parser.add_argument("--moved", action="store_true", help="only what changed place")
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()

    path = Path(args.document).expanduser()
    if not path.exists():
        sys.exit(f"not found: {path}")

    rows = parse(path)
    if not rows:
        sys.exit("nothing parsed — the document's structure is not what this expects")

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                select w.id, w.author, w.title, w.year,
                       coalesce(min(el.name), '') as list_name,
                       coalesce(min(s.letter), '') as letter,
                       coalesce(min(s.title), '') as section_title,
                       min(li.ordinal) as ordinal,
                       count(li.work_id) as on_a_list
                from works w
                left join list_items li on li.work_id = w.id
                left join exam_lists el on el.id = li.list_id
                left join list_sections s on s.id = li.section_id
                group by w.id, w.author, w.title, w.year
                order by w.id
            """)
            catalogue = [
                {"id": r[0], "author": r[1], "title": r[2], "year": r[3],
                 "list": r[4], "letter": r[5], "section": r[6],
                 "ordinal": r[7], "on_a_list": r[8]}
                for r in cur.fetchall()
            ]

    matched: list[tuple[dict, dict, float]] = []
    new: list[tuple[dict, dict | None, float]] = []

    taken_rows, splits, claimed = assign(rows, catalogue, args.threshold)

    for i, row in enumerate(rows):
        if i in taken_rows:
            work, score = taken_rows[i]
            matched.append((row, work, score))
        else:
            near, score = best_match(row, catalogue)
            new.append((row, near, score))

    # A work sharing an entry with another takes that entry's place on the list,
    # written immediately after it so relist.py can give the pair one number.
    by_parent: dict[int, list[dict]] = {}
    for i, work, score in splits:
        by_parent.setdefault(i, []).append(work)

    ordered: list[tuple[dict, dict, float, str]] = []
    for i, row in enumerate(rows):
        if i not in taken_rows:
            continue
        work, score = taken_rows[i]
        state = "supplementary" if row["supplementary"] else "matched"
        ordered.append((row, work, score, state))
        for extra in by_parent.get(i, []):
            ordered.append((row, extra, 1.0, "split"))

    matched = [(r, w, s) for r, w, s, _ in ordered]
    gone = [w for w in catalogue if w["id"] not in claimed and w["on_a_list"]]

    moved = []
    demoted = []
    for row, work, _ in matched:
        doc_list = row["list"].split(".")[0].strip()
        cat_list = work["list"].split(".")[0].strip()
        if row["supplementary"]:
            demoted.append((row, work))
        elif fold(doc_list) != fold(cat_list) or row["section"][:1] != (work["letter"] or "")[:1]:
            moved.append((row, work))

    counts: dict[str, list[int]] = {}
    for row in rows:
        key = row["list"][:46]
        counts.setdefault(key, [0, 0])
        counts[key][1 if row["supplementary"] else 0] += 1

    print(f"\n  {path.name}\n")
    print(f"    {'list':<48} {'main':>5} {'supp':>5}")
    for name, (main, supp) in counts.items():
        print(f"    {name:<48} {main:>5} {supp:>5}")
    print(f"\n  {len(rows)} entries, {len(catalogue)} works in the catalogue")
    print(f"  {len(matched)} matched · {len(new)} new · {len(gone)} gone · "
          f"{len(moved)} moved · {len(demoted)} now supplementary\n")

    only = [k for k in ("new", "gone", "moved") if getattr(args, k)]

    if not only or args.new:
        print(f"\n  NEW — in the document, not in the catalogue  ({len(new)})\n")
        for row, near, score in new:
            place = f"{row['list'].split('.')[0]}.{row['section'][:1]}{row['ordinal']}"
            print(f"    {place:<10} {row['author'][:38]}")
            print(f"               {row['title'][:70]}  ({row['year'] or 'n.d.'})")
            if near:
                print(f"               nearest: {near['id']}  [{score}]")

    if not only or args.gone:
        print(f"\n\n  GONE — on a list in the catalogue, not in the document  ({len(gone)})\n")
        print("  Either cut from the list, or a match this could not make.\n")
        for work in gone:
            who = (work["author"] or "—")[:32]
            print(f"    {work['list'][:12]:<12} {who:<32} {(work['title'] or '')[:46]}")
            print(f"                 {work['id']}")

    if not only or args.moved:
        print(f"\n\n  MOVED — different list or section  ({len(moved)})\n")
        for row, work in moved:
            print(f"    {work['id']}")
            print(f"      document:  {row['list'].split(':')[0]} · {row['section'][:44]} · {row['ordinal']}")
            print(f"      catalogue: {work['list'][:20]} · {work['letter']}. {work['section'][:40]} · {work['ordinal']}")

        print(f"\n\n  NOW SUPPLEMENTARY — examinable in the catalogue  ({len(demoted)})\n")
        for row, work in demoted:
            print(f"    {row['list'].split(':')[0]:<16} {(work['author'] or '—')[:30]:<30} {work['title'][:40]}")
            print(f"                     {work['id']}")

    if args.csv:
        with OUT.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["status", "list", "section", "supplementary", "ordinal",
                             "printed_ordinal", "author", "title", "year",
                             "work_id", "score", "entry"])
            for row, work, score, state in ordered:
                writer.writerow([state, row["list"], row["section"], row["supplementary"],
                                 row["ordinal"], row["printed_ordinal"], row["author"],
                                 row["title"], row["year"], work["id"], score, row["entry"]])
            for row, near, score in new:
                writer.writerow(["new", row["list"], row["section"], row["supplementary"],
                                 row["ordinal"], row["printed_ordinal"], row["author"],
                                 row["title"], row["year"],
                                 near["id"] if near else "", score, row["entry"]])
            for work in gone:
                writer.writerow(["gone", work["list"], work["letter"], "", work["ordinal"],
                                 "", work["author"], work["title"], work["year"],
                                 work["id"], "", ""])
        print(f"\n  Wrote {OUT}")


if __name__ == "__main__":
    main()
