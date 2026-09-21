#!/usr/bin/env python3
"""Check each loaded work's page offset against its printed folios.

    python3 pipeline/offsets.py --pending 5 --list I    # loaded, not yet checked
    python3 pipeline/offsets.py <work id> ...           # named works, by full id
    python3 pipeline/offsets.py --apply --pending 5     # write what the report says

Without --apply it writes nothing. With no work named and no --pending it
refuses. Run after load_pages.py and before load_sections.py; a batch reads

    extract → chunk → load_pages → offsets --apply → load_sections
            → load_chunks → embed

WHAT --apply WRITES, PER WORK

    confirmed   the printed pages already match the folios. Records the check.
    corrected   one numbering runs through the book and the stored offset is
                wrong. Writes works.page_offset and records the check.
    problem     anything else. Records the check and writes offset_problem in
                words, and changes nothing else. load_sections, load_chunks and
                embed skip the work until it is fixed by hand and this is run on
                it again. The Gaps page lists every such work.

    A work with no pages loaded is reported and left alone.

WHY IT WRITES

    This file used to print proposals only, on the ground that page_offset
    makes every citation right or wrong and a number applied without anyone
    looking surfaces at a defence. That still holds for anything ambiguous,
    which is flagged. What gets written is the unambiguous case: at least
    MIN_FOLIOS folios read, one numbering sequence, and CONFIDENT agreement on a
    single offset. Of six works loaded on 21 Sept, two held a wrong stored
    offset of exactly this kind, found only by a query run by hand.

HOW IT JUDGES

    Folios come from the pages table, where extract.py recorded them before
    running heads were stripped. The test is agreement among pages WHERE A
    FOLIO WAS FOUND: a book with legible numbers on a fifth of its pages can
    still have an unambiguous offset.

    Not every number read is a folio. A note number standing alone on the
    last line of a page reads as one, and Pimentel's notes gave 63 such
    readings against 36 real folios. A note number rises more slowly than the
    page, so each implies a different offset. Any offset implied by fewer than
    MIN_REPEAT pages is therefore set aside as a stray reading before anything
    is measured, and the report says how many were.

    First, do the printed pages the view already resolves (printed_pages,
    which applies page_offsets ranges before works.page_offset) match the
    folios? If so, the numbering is confirmed, whatever produced it; this is
    also how a work fixed by hand clears its flag.

    If not, the offset each folio implies (folio - file page) is grouped into
    contiguous runs. Runs spanning fewer than MIN_RUN pages are single
    misreads (Pimentel's page 17 read as "1") and are ignored. Two runs with
    different offsets mean an unnumbered insert, after which every folio
    shifts; one page_offset cannot describe that book, and page_offsets ranges
    are entered by hand.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter

from dbconn import LEAVE_ALONE, announce_pending, connect, pending, resolve

# Agreement among found folios, above which an offset is trustworthy.
CONFIDENT = 0.9

# Fewer folios than this is not evidence, however consistent they look.
MIN_FOLIOS = 8

# A run spanning fewer file pages than this is a stray reading, not a sequence.
MIN_RUN = 5

# An offset implied by fewer pages than this is a stray reading (a note
# number, a misrecognised digit) and is set aside before measuring.
MIN_REPEAT = 3


def judge(rows: list[tuple[int, int, int | None]], ranges: int) -> dict:
    """rows are (page_index, printed_page, folio). Returns the verdict: one of
    confirmed, corrected (with offset), problem (with problem text), or empty."""
    total = len(rows)
    if total == 0:
        return {"verdict": "empty", "detail": "no pages loaded"}

    read = [(index, printed, folio) for index, printed, folio in rows if folio is not None]
    implied = Counter(folio - index for index, _, folio in read)
    found = [r for r in read if implied[r[2] - r[0]] >= MIN_REPEAT]
    strays = len(read) - len(found)
    aside = f"; {strays} stray readings set aside" if strays else ""

    if len(found) < MIN_FOLIOS:
        return {
            "verdict": "problem",
            "problem": (
                f"only {len(found)} consistent folios from {total} pages"
                f" ({len(read)} numbers read{aside}); "
                "read a page number in the PDF and set the offset by hand"
            ),
        }

    agreeing = sum(1 for _, printed, folio in found if printed == folio)
    agreement = agreeing / len(found)
    if agreement >= CONFIDENT:
        return {
            "verdict": "confirmed",
            "detail": f"{agreement:.0%} of {len(found)} folios match the printed pages{aside}",
        }

    diffs = [(index, folio - index) for index, _, folio in found]
    counts = Counter(d for _, d in diffs)

    runs: list[list[int]] = []  # [offset, first_page, last_page]
    for index, diff in diffs:
        if runs and runs[-1][0] == diff:
            runs[-1][2] = index
        else:
            runs.append([diff, index, index])
    sequences = [r for r in runs if r[2] - r[1] >= MIN_RUN]
    offsets = {r[0] for r in sequences}
    described = "; ".join(f"{o:+d} on file pages {a}\u2013{b}" for o, a, b in sequences)

    if ranges:
        return {
            "verdict": "problem",
            "problem": (
                f"page_offsets ranges disagree with the folios "
                f"({agreement:.0%} agreement). Folios read: {described or 'no sequence'}"
            ),
        }

    if len(offsets) > 1:
        return {
            "verdict": "problem",
            "problem": (
                f"{len(offsets)} numbering sequences, so one page offset cannot "
                f"describe the book: {described}. Enter page_offsets ranges."
            ),
        }

    offset, count = counts.most_common(1)[0]
    confidence = count / len(found)
    if confidence >= CONFIDENT:
        return {
            "verdict": "corrected",
            "offset": offset,
            "detail": f"{confidence:.0%} of {len(found)} folios agree on {offset:+d}{aside}",
        }

    spread = ", ".join(f"{d:+d} on {n}" for d, n in counts.most_common(4))
    return {
        "verdict": "problem",
        "problem": (
            f"only {confidence:.0%} of {len(found)} folios agree on one offset "
            f"({spread}{aside}); read a page number in the PDF"
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("work", nargs="*", help="full work ids")
    parser.add_argument(
        "--pending",
        type=int,
        metavar="N",
        help="the next N works with pages loaded, no chunks, and no check yet",
    )
    parser.add_argument(
        "--list",
        dest="which",
        metavar="CODE",
        help="limit --pending to a list or section: I, II, II.C, Supl. III",
    )
    parser.add_argument("--apply", action="store_true",
                        help="write offsets, checks and problems; without it, report only")
    args = parser.parse_args()

    if args.pending and args.work:
        parser.error("--pending chooses the works itself; do not also name works")
    if not args.pending and not args.work:
        parser.error("name the works by full id, or use --pending N")

    if args.pending:
        works = pending("offsets", args.pending, args.which)
        if not works:
            print("  nothing pending \u2014 every loaded work without chunks has been checked")
            return
        announce_pending(works, set(works), "")
    else:
        works = [resolve(n) for n in args.work]

    left_alone = [w for w in works if w in LEAVE_ALONE]
    for work_id in left_alone:
        print(f"  {work_id}: left alone by decision, skipped")
    works = [w for w in works if w not in LEAVE_ALONE]
    if not works:
        sys.exit("nothing to check")

    tally: Counter[str] = Counter()
    with connect() as conn:
        for work_id in works:
            with conn.cursor() as cur:
                cur.execute("select page_offset from works where id = %s", (work_id,))
                stored = cur.fetchone()[0]
                cur.execute("select count(*) from page_offsets where work_id = %s", (work_id,))
                ranges = cur.fetchone()[0]
                cur.execute(
                    "select page_index, printed_page, folio from printed_pages"
                    " where work_id = %s order by page_index",
                    (work_id,),
                )
                rows = cur.fetchall()

            result = judge(rows, ranges)
            verdict = result["verdict"]
            tally[verdict] += 1

            where = f"{ranges} ranges" if ranges else f"offset {stored:+d}"
            print(f"\n  {work_id}  ({len(rows)} pages, {where})")
            if verdict == "corrected":
                if result["offset"] == stored:
                    # The view disagrees with an offset the folios confirm:
                    # something other than works.page_offset is in play.
                    verdict = "problem"
                    tally["corrected"] -= 1
                    tally["problem"] += 1
                    result = {
                        "verdict": "problem",
                        "problem": (
                            f"folios agree on {stored:+d}, which is the stored offset, "
                            "yet the printed pages disagree with them; check printed_pages"
                        ),
                    }
                else:
                    print(f"    corrected  {stored:+d} \u2192 {result['offset']:+d}  ({result['detail']})")
            if verdict == "confirmed":
                print(f"    confirmed  {result['detail']}")
            elif verdict == "problem":
                print(f"    PROBLEM    {result['problem']}")
            elif verdict == "empty":
                print("    no pages loaded \u2014 run load_pages.py first; nothing written")

            if not args.apply or verdict == "empty":
                continue

            with conn.transaction():
                with conn.cursor() as cur:
                    if verdict == "confirmed":
                        cur.execute(
                            "update works set offset_checked_at = now(), offset_problem = null"
                            " where id = %s",
                            (work_id,),
                        )
                    elif verdict == "corrected":
                        cur.execute(
                            "update works set page_offset = %s, offset_checked_at = now(),"
                            " offset_problem = null, updated_at = now() where id = %s",
                            (result["offset"], work_id),
                        )
                    else:
                        cur.execute(
                            "update works set offset_checked_at = now(), offset_problem = %s"
                            " where id = %s",
                            (result["problem"], work_id),
                        )

    print(
        f"\n  {tally['confirmed']} confirmed, {tally['corrected']} corrected, "
        f"{tally['problem']} with a problem"
        + (f", {tally['empty']} with no pages" if tally["empty"] else "")
    )
    if tally["problem"]:
        print("  Works with a problem get no sections, chunks or embeddings until the")
        print("  numbering is fixed and this is run on them again. The Gaps page lists them.")
    if not args.apply:
        print("\n  report only: nothing written. Rerun with --apply to write.")


if __name__ == "__main__":
    main()
