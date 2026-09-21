#!/usr/bin/env python3
"""Hand the register's filenames over to the database, once.

    python3 pipeline/sync_books.py            # report; writes nothing
    python3 pipeline/sync_books.py --apply    # the writes decided below, by name

Neon is the one place that says which PDF belongs to which work. This compares
what books.csv knows with what Neon holds, and is deleted along with books.csv
once the pipeline reads the database instead.

WHAT --apply WRITES

    Only the works named in CLEAR and REPLACE below, decided by a person on
    20 Sept after reading the report. Nothing is copied from the register on
    the register's say-so: its four "copy" rows were judged wrong, and its
    verdicts are not trusted, so neither is written. Before any write, each
    named work is checked against the state the decision was made on; if one
    has changed, nothing is written.

    A work has a file only if its PDF is in corpus/ACCOUNTED. That rule decides
    every mark in the report and every pdf_state written.

    The note column is not read. Nothing in it is trusted.

EVERY WORK FALLS INTO ONE OF THESE

    copy       the register names a file, the database has none   not written
    agree      both name the same file                             nothing
    differ     both name a file, and not the same one              listed
    app only   the database names a file the register does not     listed
    unknown    a work_id in the register that names no work        listed

pdf_state is derived for every work except those in LEAVE_ALONE, from what the
database holds after the writes — filename, verdict, pages.

FILENAMES ARE COMPARED AS FILES, NOT AS SPELLINGS

    The first run of this reported 88 disagreements, nearly all false. The
    database held many names as pipeline/corpus/<name>; books.csv, saved at
    20:37 on 20 Sept by a spreadsheet that guessed its encoding, held them as
    MacRoman mojibake — teoriÃÅa for teoría, ‚Äô for ’. Both sides now go
    through dbconn.clean_filenames: directory stripped, damage reversed where
    the reversal names a real file, composed. What is written is the cleaned
    form, so no mangled name reaches the database.

    Each side of a disagreement is marked with whether its file is on disk,
    which settles most of them at a glance.
"""

from __future__ import annotations

import argparse
import csv
import unicodedata
from pathlib import Path

from dbconn import accounted_names, clean_filenames, connect, corpus_names, filename_key

BOOKS = Path(__file__).parent.parent / "books.csv"

# Decided on 20 Sept, by name, after reading the report. Nothing here is
# inferred, and nothing outside these lists is written except pdf_state.

# The database names a file that is not a PDF in ACCOUNTED, and there is no
# copy that is: source_path is emptied and source_format set to none.
CLEAR = [
    "fong-ethnic-studies-research-approaches-and-2008",      # an EPUB, DRM beside it
    "keetley-folk-horror-new-global-pathways-2023",          # an EPUB
    "mendez-catalogo-de-textos-marginados-novohispan-1992",
    "williams-the-other-side-of-the-2002",
]

# The database names a file outside ACCOUNTED; the register names the right
# one, which is in ACCOUNTED. Gerhard's is the OCR'd copy.
REPLACE = [
    "gerhard-la-frontera-norte-de-la-1996",
    "flores-relatos-populares-de-la-inquisicion-2010",
    "grande-a-traves-de-cien-montanas-2007",
    "rivera-garza-los-muertos-indociles-necroescrituras-y-2013",
]

# Not touched at all, pdf_state included. Lotman's file sits outside
# ACCOUNTED but was added by hand and is the right book.
LEAVE_ALONE = {"lotman-estructura-texto-artistico-1982"}

# Campra needs no write: its database filename already names the OCR'd copy,
# which becomes viable when the PDF is moved into ACCOUNTED.


def on_disk(value: str, accounted: set[str]) -> bool:
    """Every piece of a cleaned filename cell is a PDF in corpus/ACCOUNTED —
    the only thing that counts as the work having a file."""
    pieces = [p.strip() for p in value.split("|") if p.strip()]
    return bool(pieces) and all(filename_key(p) in accounted for p in pieces)


def mark(value: str, accounted: set[str]) -> str:
    return "ACCOUNTED " if on_disk(value, accounted) else "NOT VIABLE"


def state_of(source_path: str, verdict: str, pages: int) -> str:
    """'queued' means a file exists and waits for OCR: a copy in hand, which is
    a different thing from having none."""
    if not source_path:
        return "none"
    if pages > 0:
        return "loaded"
    if "ocr" in verdict.casefold():
        return "queued"
    return "ready"


def read_register(names: set[str]) -> tuple[dict[str, dict], list[tuple[str, str, str]], int]:
    """work_id -> {pdf, verdict}. A work on two lists has two rows; if their pdf
    cells disagree, the register contradicts itself and that is reported rather
    than resolved by whichever row came last. Also returns how many cells the
    mojibake repair changed."""
    register: dict[str, dict] = {}
    clashes: list[tuple[str, str, str]] = []
    repaired = 0
    with BOOKS.open(encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            work_id = (row.get("work_id") or "").strip()
            if not work_id:
                continue
            raw = " | ".join(
                unicodedata.normalize("NFC", p).strip()
                for p in (row.get("pdf") or "").split("|") if p.strip()
            )
            pdf = clean_filenames(row.get("pdf"), names)
            if pdf != raw:
                repaired += 1
            verdict = (row.get("pdf_verdict") or "").strip()
            entry = register.setdefault(work_id, {"pdf": "", "verdict": ""})
            if entry["pdf"] and pdf and entry["pdf"] != pdf:
                clashes.append((work_id, entry["pdf"], pdf))
                continue
            entry["pdf"] = entry["pdf"] or pdf
            entry["verdict"] = entry["verdict"] or verdict
    return register, clashes, repaired


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="write CLEAR and REPLACE; without it, report only")
    args = parser.parse_args()

    if not BOOKS.exists():
        raise SystemExit(f"{BOOKS} not found")

    names = corpus_names()
    if not names:
        raise SystemExit("no files under pipeline/corpus — cannot check any filename")
    accounted = accounted_names()
    if not accounted:
        raise SystemExit("no PDFs under pipeline/corpus/ACCOUNTED — cannot judge any file")

    register, clashes, repaired = read_register(names)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                select w.id,
                       coalesce(w.source_path, ''),
                       coalesce(w.pdf_verdict, ''),
                       coalesce(w.pdf_state, ''),
                       coalesce(p.n, 0)
                from works w
                left join (select work_id, count(*) as n from pages group by work_id) p
                  on p.work_id = w.id
                order by w.id
            """)
            rows = cur.fetchall()
            prefixed = sum(1 for r in rows if "/" in r[1] or "\\" in r[1])
            db = {
                r[0]: {"source": clean_filenames(r[1], names), "verdict": r[2].strip(),
                       "state": r[3], "pages": r[4]}
                for r in rows
            }

        clashed = {c[0] for c in clashes}
        copy: list[str] = []
        agree: list[str] = []
        differ: list[tuple[str, str, str]] = []
        unknown: list[tuple[str, str]] = []

        for work_id, reg in register.items():
            if work_id in clashed:
                continue
            if work_id not in db:
                unknown.append((work_id, reg["pdf"]))
                continue
            theirs, mine = reg["pdf"], db[work_id]["source"]
            if not theirs:
                continue
            if not mine:
                copy.append(work_id)
            elif mine == theirs:
                agree.append(work_id)
            else:
                differ.append((work_id, mine, theirs))

        app_only = [
            (work_id, w["source"]) for work_id, w in db.items()
            if w["source"] and not register.get(work_id, {}).get("pdf")
        ]

        # What each work will hold afterwards.
        def after(work_id: str, w: dict) -> str:
            if work_id in CLEAR:
                return ""
            if work_id in REPLACE:
                return register.get(work_id, {}).get("pdf", "")
            return w["source"]

        states: list[tuple[str, str, str]] = []
        for work_id, w in db.items():
            if work_id in LEAVE_ALONE:
                continue
            source = after(work_id, w)
            state = state_of(source if on_disk(source, accounted) else "",
                             w["verdict"], w["pages"])
            if state != w["state"]:
                states.append((work_id, w["state"] or "(empty)", state))

        # Each decision checked against the state it was made on. A work that
        # has changed since — renamed, edited in the app, file moved — stops
        # the whole run rather than being written over.
        problems: list[str] = []
        for work_id in CLEAR:
            w = db.get(work_id)
            if w is None:
                problems.append(f"{work_id}: no such work")
            elif not w["source"]:
                problems.append(f"{work_id}: already has no filename")
            elif on_disk(w["source"], accounted):
                problems.append(f"{work_id}: its file is now in ACCOUNTED — not clearing")
        for work_id in REPLACE:
            w = db.get(work_id)
            new = register.get(work_id, {}).get("pdf", "")
            if w is None:
                problems.append(f"{work_id}: no such work")
            elif not new or not on_disk(new, accounted):
                problems.append(f"{work_id}: the register's file is not in ACCOUNTED")
            elif on_disk(w["source"], accounted):
                problems.append(f"{work_id}: the database's file is now in ACCOUNTED — not replacing")

        # ------------------------------------------------------------------
        # The report. Lists first, counts last, so the counts are what is on
        # the screen when it finishes.

        if differ:
            print(f"\n  DIFFER — both name a file, not the same one ({len(differ)})")
            print("  Nothing written. Settle each in the application.\n")
            for work_id, mine, theirs in differ:
                print(f"    {work_id}")
                print(f"      database  {mark(mine, accounted)} {mine[:150]}")
                print(f"      register  {mark(theirs, accounted)} {theirs[:150]}")

        if clashes:
            print(f"\n  REGISTER CONTRADICTS ITSELF — two rows, two files ({len(clashes)})\n")
            for work_id, first, second in clashes:
                print(f"    {work_id}")
                print(f"      {first[:100]}")
                print(f"      {second[:100]}")

        if unknown:
            print(f"\n  UNKNOWN — work_id in the register, no such work ({len(unknown)})\n")
            for work_id, pdf in unknown:
                print(f"    {work_id:<56} {pdf[:60] or '(no file named)'}")

        if app_only:
            print(f"\n  APP ONLY — filename in the database, none in the register ({len(app_only)})\n")
            for work_id, source in app_only:
                print(f"    {work_id:<56} {mark(source, accounted)} {source[:60]}")

        if copy:
            print(f"\n  COPY — register names a file, database has none ({len(copy)})")
            print("  Not written.\n")
            for work_id in copy:
                pdf = register[work_id]["pdf"]
                print(f"    {work_id:<56} {mark(pdf, accounted)} {pdf[:60]}")

        not_viable = [
            (work_id, w["source"]) for work_id, w in db.items()
            if w["source"] and not on_disk(w["source"], accounted)
        ]
        if not_viable:
            print(f"\n  NOT VIABLE — the database names a file that is not a PDF in ACCOUNTED "
                  f"({len(not_viable)})")
            print("  Every such work in Neon, whichever group above it fell in.\n")
            for work_id, source in not_viable:
                pages = db[work_id]["pages"]
                loaded = f"  [{pages} pages loaded]" if pages else ""
                print(f"    {work_id:<56} {source[:70]}{loaded}")

        print("\n  WHAT --apply WRITES\n")
        for work_id in CLEAR:
            print(f"    clear    {work_id}")
        for work_id in REPLACE:
            new = register.get(work_id, {}).get("pdf", "")
            print(f"    replace  {work_id}")
            print(f"               with  {new[:100]}")
        for work_id in sorted(LEAVE_ALONE):
            print(f"    untouched {work_id}")
        if problems:
            print("\n  STOPPED — the database no longer matches the decisions above:\n")
            for p in problems:
                print(f"    {p}")

        tally: dict[str, int] = {}
        for work_id, w in db.items():
            if work_id in LEAVE_ALONE:
                continue
            source = after(work_id, w)
            s = state_of(source if on_disk(source, accounted) else "",
                         w["verdict"], w["pages"])
            tally[s] = tally.get(s, 0) + 1

        print(f"\n  {len(db)} works in the database, {len(register)} in the register")
        print(f"  {repaired} register cells repaired from spreadsheet damage; "
              f"{prefixed} database values carried a directory\n")
        print(f"    {len(copy):>4}  copy          not written")
        print(f"    {len(agree):>4}  agree")
        print(f"    {len(differ):>4}  differ")
        print(f"    {len(app_only):>4}  app only")
        print(f"    {len(unknown):>4}  unknown")
        print(f"    {len(not_viable):>4}  not viable    database names a file outside ACCOUNTED")
        if clashes:
            print(f"    {len(clashes):>4}  register contradicts itself")
        print(f"\n    {len(CLEAR):>4}  filenames cleared")
        print(f"    {len(REPLACE):>4}  filenames replaced")
        print(f"    {len(states):>4}  pdf_state changes  (Lotman excluded)")
        print("\n  pdf_state afterwards:  " + " · ".join(
            f"{tally.get(s, 0)} {s}" for s in ("loaded", "ready", "queued", "none")))

        if not args.apply:
            print("\n  report only: nothing written.")
            return
        if problems:
            raise SystemExit("\n  nothing written.")

        # ------------------------------------------------------------------
        # The writes, in one transaction: all of them or none.

        with conn.transaction():
            with conn.cursor() as cur:
                cur.executemany(
                    """
                    update works
                    set source_path = null, source_format = 'none', updated_at = now()
                    where id = %s
                    """,
                    [(w,) for w in CLEAR],
                )
                cur.executemany(
                    """
                    update works set source_path = %s, updated_at = now()
                    where id = %s
                    """,
                    [(register[w]["pdf"], w) for w in REPLACE],
                )
                cur.executemany(
                    """
                    update works set pdf_state = %s, updated_at = now()
                    where id = %s and pdf_state is distinct from %s
                    """,
                    [(new, w, new) for w, _old, new in states],
                )

        print(f"\n  written: {len(CLEAR)} cleared, {len(REPLACE)} replaced, "
              f"{len(states)} states")


if __name__ == "__main__":
    main()
