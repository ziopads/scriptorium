#!/usr/bin/env python3
"""Chunk page text into search windows.

    python3 pipeline/chunk.py                    # every page file
    python3 pipeline/chunk.py rael-cuentos-espanoles-1977
    python3 pipeline/chunk.py --dry-run          # report, write nothing
    python3 pipeline/chunk.py --show rael-cuentos-espanoles-1977 --page 40
                                                 # print the chunks touching a page

Input:  pipeline/pages/{book_id}.json   (the durable artifact)
Output: pipeline/chunks/{book_id}.json  (derived; rebuilt whenever the rules
                                         change, and stamped with the version)

Deterministic and local: no network, no key, no database. load_chunks.py
writes the result to Postgres.

WHAT A CHUNK IS
    A run of whole paragraphs, in one language, of roughly TARGET characters,
    never more than HARD_MAX, cut only at paragraph ends or, when a single
    paragraph is longer than HARD_MAX, at sentence ends. Consecutive chunks
    overlap by about OVERLAP characters of trailing text so that a claim
    straddling a cut is whole in at least one of them.

    Page boundaries are recorded (start/end page index) but not respected,
    except in one case: when the language changes between two adjacent pages,
    the chunk ends at the page. That is the facing-page case (Rael: Spanish on
    the left, English on the right). Each chunk carries one lang, decided by
    stopword counts on its own text, so a search in either language finds text
    in that language and the tsvector uses the right dictionary.

    Pages with fewer than MIN_PAGE_CHARS characters (plates, blanks, part
    titles) are skipped and never start or end a chunk.

WHAT IS NOT DECIDED HERE
    section_type (front / body / notes / bibliography / index) is left null.
    A heuristic that gets it wrong hides the notes she cites from search;
    leaving it blank hides nothing.

    The printed page is not computed. The loader adds works.page_offset.

SIZES
    TARGET 2800 characters is about 600–700 tokens of Spanish or English prose,
    small enough that a hit points at a paragraph or two, large enough that an
    argument survives the cut. Change them here, bump CHUNKER_VERSION, rerun.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

CHUNKER_VERSION = 1

TARGET = 2800
HARD_MAX = 3600
OVERLAP = 400
MIN_PAGE_CHARS = 50

PIPELINE = Path(__file__).parent
PAGES = PIPELINE / "pages"
CHUNKS = PIPELINE / "chunks"

# Function words that decide the language of a stretch of text. Short lists on
# purpose: these are frequent enough that a page of prose in either language
# scores in the dozens, and neither list contains a word common in the other.
SPANISH = {
    "el", "la", "los", "las", "de", "del", "que", "y", "en", "un", "una",
    "por", "con", "para", "es", "se", "no", "su", "sus", "como", "más", "pero",
    "al", "lo", "le", "les", "este", "esta", "esto", "también", "muy",
}
ENGLISH = {
    "the", "of", "and", "to", "in", "a", "is", "that", "it", "was", "for",
    "with", "as", "on", "be", "by", "this", "which", "or", "from", "are",
    "not", "but", "his", "her", "their", "an", "at", "were", "have",
}

WORD = re.compile(r"[a-záéíóúüñ]+", re.IGNORECASE)
# A sentence end: terminal punctuation, optional closing quote or bracket,
# then whitespace and something that begins a sentence. Written as two
# fixed-width look-behinds because Python's re rejects a variable-width one.
SENTENCE = re.compile(
    r"(?:(?<=[.!?…])|(?<=[.!?…][»”\")\]]))\s+(?=[A-ZÁÉÍÓÚÑ¿¡«“\"(])"
)


def fold(value: str) -> str:
    """Lowercased, accents removed. What chunks.text_search holds, so that an
    unaccented query matches accented text on both sides."""
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def language(text: str) -> str | None:
    """'spanish', 'english', or None when the text does not say (a plate, a
    list of names, a page of numbers)."""
    words = [w.lower() for w in WORD.findall(text)]
    if len(words) < 20:
        return None
    es = sum(1 for w in words if w in SPANISH)
    en = sum(1 for w in words if w in ENGLISH)
    if es == 0 and en == 0:
        return None
    if es >= en * 1.5:
        return "spanish"
    if en >= es * 1.5:
        return "english"
    return None


def paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def split_long(paragraph: str) -> list[str]:
    """A paragraph longer than HARD_MAX, cut at sentence ends into pieces no
    longer than HARD_MAX. A single sentence longer than HARD_MAX (it happens in
    transcribed oral narrative) is left whole; the loader accepts it."""
    if len(paragraph) <= HARD_MAX:
        return [paragraph]
    pieces: list[str] = []
    current = ""
    for sentence in SENTENCE.split(paragraph):
        if current and len(current) + 1 + len(sentence) > HARD_MAX:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def tail(text: str, want: int) -> str:
    """The last ~want characters of text, cut back to a sentence start so the
    overlap begins cleanly."""
    if len(text) <= want:
        return text
    cut = text[-want:]
    m = SENTENCE.search(cut)
    return cut[m.end():] if m else cut


def chunk_book(doc: dict) -> list[dict]:
    """Walk the pages in order, keeping a buffer of (page_index, paragraph)
    units, and emit a chunk whenever the buffer reaches TARGET or the language
    is about to change."""
    units: list[tuple[int, str]] = []   # (page_index, paragraph piece)
    page_lang: dict[int, str | None] = {}
    prev_lang: str | None = None

    for page in doc["pages"]:
        if page["chars"] < MIN_PAGE_CHARS:
            continue
        lang = language(page["text"])
        # An undecidable page inherits its neighbour so it does not force a cut.
        page_lang[page["page"]] = lang or prev_lang
        if lang:
            prev_lang = lang
        for para in paragraphs(page["text"]):
            for piece in split_long(para):
                units.append((page["page"], piece))

    chunks: list[dict] = []
    buf: list[tuple[int, str]] = []
    carry = ""          # overlap text carried from the previous chunk
    carry_page: int | None = None

    def flush() -> None:
        nonlocal buf, carry, carry_page
        if not buf:
            return
        body = "\n\n".join(p for _, p in buf)
        text = f"{carry}\n\n{body}".strip() if carry else body
        start = carry_page if carry_page is not None else buf[0][0]
        end = buf[-1][0]
        lang = language(text) or page_lang.get(buf[0][0]) or "spanish"
        chunks.append({
            "ordinal": len(chunks) + 1,
            "start_page_index": start,
            "end_page_index": end,
            "lang": lang,
            "chars": len(text),
            "text": text,
            "text_search": fold(text),
        })
        carry = tail(body, OVERLAP)
        carry_page = buf[-1][0]
        buf = []

    for i, (page_index, piece) in enumerate(units):
        # Language boundary between this unit's page and the previous unit's
        # page: close the chunk and drop the overlap, so nothing straddles it.
        if buf:
            prev_page = buf[-1][0]
            if page_index != prev_page and page_lang.get(page_index) != page_lang.get(prev_page):
                flush()
                carry, carry_page = "", None

        # Never let one more paragraph push a chunk past the ceiling: close
        # the current chunk first. The paragraph then opens the next one, with
        # the overlap in front of it.
        size = len(carry) + sum(len(p) + 2 for _, p in buf)
        if buf and size + len(piece) + 2 > HARD_MAX:
            flush()

        buf.append((page_index, piece))
        size = len(carry) + sum(len(p) + 2 for _, p in buf)
        if size >= TARGET:
            flush()

    flush()
    return chunks


def show(doc: dict, chunks: list[dict], page: int) -> None:
    hits = [c for c in chunks if c["start_page_index"] <= page <= c["end_page_index"]]
    if not hits:
        print(f"  no chunk touches page index {page}")
        return
    for c in hits:
        print(f"\n--- chunk {c['ordinal']}  pages {c['start_page_index']}–{c['end_page_index']}  "
              f"{c['lang']}  {c['chars']} chars\n")
        print(c["text"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("book_id", nargs="*")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--show", metavar="BOOK_ID", help="print chunks touching --page")
    parser.add_argument("--page", type=int, help="page index, with --show")
    args = parser.parse_args()

    if args.show:
        doc = json.loads((PAGES / f"{args.show}.json").read_text(encoding="utf-8"))
        show(doc, chunk_book(doc), args.page or 1)
        return

    files = sorted(PAGES.glob("*.json"))
    if args.book_id:
        wanted = set(args.book_id)
        files = [f for f in files if f.stem in wanted]
        missing = wanted - {f.stem for f in files}
        if missing:
            sys.exit(f"no page file for: {', '.join(sorted(missing))}")
    if not files:
        sys.exit("nothing to chunk")

    for f in files:
        doc = json.loads(f.read_text(encoding="utf-8"))
        chunks = chunk_book(doc)
        langs = {}
        for c in chunks:
            langs[c["lang"]] = langs.get(c["lang"], 0) + 1
        sizes = [c["chars"] for c in chunks]
        print(
            f"  {f.stem:<44} {len(chunks):>5} chunks  "
            f"{min(sizes) if sizes else 0:>5}–{max(sizes) if sizes else 0:<5} chars  "
            + ", ".join(f"{k} {v}" for k, v in sorted(langs.items()))
        )
        if not args.dry_run:
            CHUNKS.mkdir(exist_ok=True)
            out = CHUNKS / f"{f.stem}.json"
            out.write_text(json.dumps({
                "book_id": doc["book_id"],
                "chunker_version": CHUNKER_VERSION,
                "chunked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "params": {"target": TARGET, "hard_max": HARD_MAX, "overlap": OVERLAP,
                           "min_page_chars": MIN_PAGE_CHARS},
                "chunks": chunks,
            }, ensure_ascii=False, indent=1), encoding="utf-8")

    if args.dry_run:
        print("\n  dry run: nothing written")
    else:
        print(f"\n  Wrote {CHUNKS}/")
        print("  Read Rael's around a facing pair before loading:")
        print("    python3 pipeline/chunk.py --show rael-cuentos-espanoles-1977 --page 40")


if __name__ == "__main__":
    main()
