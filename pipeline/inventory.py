#!/usr/bin/env python3
"""Write books.csv: every book on the lists, with its PDF and its state.

    python3 pipeline/inventory.py

One row per work on an examination list, with the code from the final document,
the bibliographic data, the filename of its PDF, and how far it has got through
the pipeline. Open it in a spreadsheet.

BOOKS.CSV IS EDITABLE, AND IT IS WHAT EXTRACTION OBEYS

    The pdf and note columns belong to a person. Type a filename into pdf and
    extract.py will use that file — exactly, by name, no matching, no scoring,
    no guessing. Re-running this script NEVER overwrites a value you typed
    there; it refreshes the derived columns around it.

    Everything else in the row is derived and will be rewritten: the code, the
    bibliographic data, the state, the counts. Edit those in the application or
    in the catalogue, not here.

    A row whose pdf is empty falls back to the match string in mapping.csv, so
    the eighty-odd works already mapped keep working untouched.

    code          I.C.13, from the department's October 2026 list
    pdf           EDITABLE — the filename in pipeline/corpus, or several,
                  separated by ' | ' for a book split across files
    pdf_verdict   check_pdf.py's reading of that file: citable, needs OCR, …
    state         loaded · mapped · decided · missing
    pages/chunks  what is in the database now
    note          EDITABLE — yours; never overwritten
"""

from __future__ import annotations

import csv
import unicodedata
from pathlib import Path

from dbconn import connect

ROOT = Path(__file__).parent
CORPUS = ROOT / "corpus"
MAPPING = ROOT / "mapping.csv"
CITABILITY = ROOT / "citability.csv"
OUT = ROOT.parent / "books.csv"


def fold(value: str) -> str:
    d = unicodedata.normalize("NFKD", value or "")
    return "".join(c for c in d if not unicodedata.combining(c)).casefold()


def read(path: Path) -> list[dict]:
    if not path.exists():
        return []
    # utf-8-sig on read too, so the BOM this script writes is consumed rather
    # than arriving as a stray character on the first column name.
    with path.open(encoding="utf-8-sig") as fh:
        return list(csv.DictReader(l for l in fh if not l.lstrip().startswith("#")))


def repair_mojibake(name: str, names: set, key) -> str:
    """Undo a UTF-8 file read as MacRoman, verified against the corpus.

    A spreadsheet that guesses the encoding on open turns a curly apostrophe
    and a combining accent into runs of Latin-1 punctuation, then saves the
    garbage back as real characters. The damage is mechanical and exactly
    reversible: those characters are the UTF-8 bytes of the original, so
    encoding back and decoding as UTF-8 returns the filename.

    An earlier version looked for the damage by its characters and never fired,
    because I guessed the wrong ones. This does not guess. It tries the
    reversal and keeps the result only if it names a file that exists: a repair
    that produces nothing real is not a repair, and one that produces a real
    file is right whatever the damage looked like.
    """
    if not name or key(name) in names:
        return name
    for encoding in ("mac_roman", "cp1252", "latin-1"):
        try:
            fixed = name.encode(encoding).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if key(fixed) in names:
            return fixed
    return name


def main() -> None:
    corpus = sorted(p for p in CORPUS.rglob("*.pdf") if not p.name.startswith("."))

    # macOS stores filenames decomposed — á as a plus a combining accent — while
    # a CSV written by a spreadsheet holds them composed. Comparing the raw
    # strings fails on every Spanish title, which flagged three quarters of the
    # catalogue as NOT IN CORPUS.
    def key(name: str) -> str:
        return unicodedata.normalize("NFC", name).strip().casefold()

    names = {key(p.name) for p in corpus}

    # What a person has already typed into books.csv. Read before anything else
    # and written back untouched: an edit here is a decision, and a script that
    # discards decisions is worse than no script.
    kept: dict[str, dict] = {}
    damaged = 0
    for row in read(OUT):
        work_id = (row.get("work_id") or "").strip()
        if not work_id:
            continue
        raw = (row.get("pdf") or "").strip()
        pieces = [p.strip() for p in raw.split("|") if p.strip()]
        pdf = " | ".join(repair_mojibake(p, names, key) for p in pieces)
        if pdf != raw:
            damaged += 1
        kept[work_id] = {"pdf": pdf, "note": (row.get("note") or "").strip()}

    if damaged:
        print(f"  repaired {damaged} filenames mangled by a spreadsheet's encoding")

    # work_id -> [filenames], resolved from the match strings.
    files: dict[str, list[str]] = {}
    for row in read(MAPPING):
        work_id = (row.get("work_id") or "").strip()
        match = (row.get("match") or "").strip()
        if not work_id or not match:
            continue
        needle = fold(match)
        files.setdefault(work_id, []).extend(
            p.name for p in corpus if needle in fold(p.name)
        )

    verdicts = {
        (r.get("filename") or "").strip(): (r.get("verdict") or "").strip()
        for r in read(CITABILITY)
    }

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                select w.id, w.author, w.title, w.year, w.kind, w.priority,
                       coalesce(el.name, '') as list_name,
                       coalesce(s.letter, '') as letter,
                       coalesce(s.title, '') as section,
                       li.ordinal,
                       coalesce(el.sort, 99) as list_sort
                from list_items li
                join works w on w.id = li.work_id
                join exam_lists el on el.id = li.list_id
                left join list_sections s on s.id = li.section_id
                order by el.sort, li.ordinal, w.id
            """)
            rows = cur.fetchall()

            cur.execute("select work_id, count(*) from pages group by work_id")
            pages = dict(cur.fetchall())
            cur.execute("select work_id, count(*) from sections group by work_id")
            sections = dict(cur.fetchall())
            cur.execute("select work_id, count(*) from chunks group by work_id")
            chunks = dict(cur.fetchall())
            cur.execute(
                "select work_id, count(*) from chunks "
                "where embedding is not null group by work_id"
            )
            embedded = dict(cur.fetchall())

    out = []
    for (wid, author, title, year, kind, priority,
         list_name, letter, section, ordinal, _sort) in rows:

        pdfs = files.get(wid, [])

        # A filename typed into books.csv wins over anything matched. Flagged
        # when it names a file that is not in the corpus, since a typo here
        # would otherwise look like a book with no copy.
        typed = [f.strip() for f in kept.get(wid, {}).get("pdf", "").split("|") if f.strip()]
        if typed:
            pdfs = typed
        missing_named = [f for f in typed if key(f) not in names]
        supplementary = section == "Supplementary"
        numeral = {"I. Theory": "I", "II. Dissertation": "II",
                   "III. Teaching": "III"}.get(list_name, list_name[:3])
        code = (f"{numeral}.Supl.{ordinal}" if supplementary
                else f"{numeral}.{letter}.{ordinal}" if letter
                else f"{numeral}.{ordinal}")

        # Three states, and the pdf column decides all three. A filename is the
        # decision that this work has that copy; an empty cell is the statement
        # that it has none. A separate file recording the same thing went stale
        # the moment a PDF arrived, and then contradicted the register.
        if pages.get(wid):
            state = "loaded"
        elif pdfs:
            state = "mapped"
        else:
            state = "missing"

        out.append({
            "code": code,
            "list": list_name,
            "section": section,
            "ordinal": ordinal,
            "supplementary": "yes" if supplementary else "",
            "author": author or "",
            "title": title,
            "year": year or "",
            "kind": kind,
            "stars": priority or "",
            "work_id": wid,
            "pdf": " | ".join(pdfs),
            "pdf_verdict": " | ".join(
                filter(None, (verdicts.get(p, "") for p in pdfs))
            ),
            "state": ("NOT IN CORPUS" if missing_named else state),
            "pages": pages.get(wid, 0),
            "sections": sections.get(wid, 0),
            "chunks": chunks.get(wid, 0),
            "embedded": embedded.get(wid, 0),
            "note": kept.get(wid, {}).get("note", ""),
        })

    # utf-8-sig writes a byte-order mark, which is the signal Excel and Numbers
    # look for when deciding how to read a CSV. Without it they guess, guess
    # MacRoman, and turn ’ into ‘Äô and á into aÃ… — then save the garbage back
    # as real characters, which is how seventy-five filenames in this file were
    # destroyed. This file is meant to be opened in a spreadsheet and corrected
    # by hand; writing it in a form a spreadsheet mangles defeats its purpose.
    with OUT.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(out[0].keys()))
        writer.writeheader()
        writer.writerows(out)

    tally: dict[str, int] = {}
    for row in out:
        tally[row["state"]] = tally.get(row["state"], 0) + 1

    print(f"\n  {len(out)} books on the lists\n")
    # Every state, not a list of the ones expected. Printing only known states
    # is how seventy-five rows went missing from this summary while the file
    # itself was correct.
    for state, n in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"    {n:>4}  {state}")
    if sum(tally.values()) != len(out):
        print(f"    {len(out) - sum(tally.values()):>4}  unaccounted — a bug")
    print(f"\n  Wrote {OUT}")


if __name__ == "__main__":
    main()
