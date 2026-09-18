#!/usr/bin/env python3
"""Extract page text from the mapped PDFs into one JSON file per work.

    python3 pipeline/extract.py                  # every mapped work
    python3 pipeline/extract.py anzaldua         # a substring of a work id
    python3 pipeline/extract.py --dry-run        # report, write nothing
    python3 pipeline/extract.py --chapters       # show the chapter sources
    python3 pipeline/extract.py --glyphs         # list suspect characters
                                                 # sitting inside words

Output: pipeline/pages/{work_id}.json, keyed by the catalogue id — the same id
the app, the notes and the anchors use — so that no accented, 200-character
download name, and no second identifier, ever propagates past this boundary.
That is the durable artifact. Everything downstream — chunks, vectors, the
database — is derived from it and can be rebuilt without touching a PDF again.

Deterministic and local. No network, no key, no database. Runs on files and
writes files, so it can be tested by reading its output beside the source (O-4).

WHAT IS REPAIRED, AND WHAT IS LEFT ALONE
    Repaired here: artifacts of typesetting and encoding — ligatures the font
    substituted, line-break hyphenation, decomposed Unicode, runs of whitespace,
    repeating running heads, and endnote reference marks.

    Left alone: accents, typographic quotation marks, capitalisation, and
    everything else the author or editor chose. Search folds accents away in
    chunks.text_search; the verbatim text is what gets quoted in a dissertation,
    and it should read as printed.

WHY get_text("dict") AND NOT get_text("text")
    Text mode returns characters and line breaks and nothing else, which cost
    two things. Paragraphs had to be guessed downstream from line lengths,
    because text mode marks none. And endnote reference marks came through as
    body text — worse, as garbage body text, since the superscript figures in
    Adorno decode through a broken map and arrive as ≤∑, ≤∏, ≤π rather than
    12, 13, 14.

    Dict mode returns spans carrying font, size, flags and a bounding box. A
    reference mark is then identifiable as superscript rather than by what it
    decoded to, and paragraphs come from geometry — an indented first line, or
    extra leading — rather than from a guess about line lengths.

    What dict mode does NOT fix is a wrong character in body text. Adorno's ff
    ligature arrives as √ ("e√ectively"), and that is the same in either mode:
    the font's ToUnicode map is broken and no amount of layout information says
    what the glyph meant. Those need a substitution, per glyph, checked by eye.
    Run --glyphs to list every suspect character with its context before
    extending MOJIBAKE.
"""

# Postpones evaluation of type annotations, so newer syntax like `int | None`
# works on the macOS system Python 3.9 this runs against.
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from dbconn import resolve

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF is not installed. Run: pip install pymupdf")

PIPELINE = Path(__file__).parent
CORPUS = PIPELINE / "corpus"
MAPPING = PIPELINE / "mapping.csv"
PAGES = PIPELINE / "pages"

# A first or last line appearing on at least this share of pages, once folios
# are masked, is a running head rather than text. Set high enough that a phrase
# repeated in the prose does not qualify.
HEADER_SHARE = 0.25
HEADER_MIN_PAGES = 12

# The share rule catches a head that runs the length of the book. It misses a
# head that changes at every chapter, because a chapter is a small fraction of
# a book: Adorno's "overview" sits at the top of about twenty of 449 pages, or
# four per cent, and survived into the reading pane as a word before the first
# sentence of every page of that chapter.
#
# So a second rule, on absolute count rather than share. A short line, with no
# sentence-ending punctuation, standing first or last on this many pages, is
# furniture. Prose does not repeat a line verbatim eight times in the same
# position. Every removal is printed at the end of the run — read that list
# before loading, because this rule is the one that could take a real line.
CHAPTER_HEAD_MIN = 8
CHAPTER_HEAD_MAX_CHARS = 60

# WHERE A CHAPTER MAP COMES FROM
#
# Three sources, in descending order of trust, all reported so a person picks:
#
#   outline         The PDF's own bookmarks, doc.get_toc(). Not a heuristic at
#                   all: it is the book's contents as the publisher recorded
#                   them, with titles and exact pages. Where it exists nothing
#                   else should be consulted.
#
#   running heads   A chapter head sits at the top of that chapter's pages and
#                   nowhere else, so the pages carrying one ARE its span. This
#                   costs nothing beyond what head detection already computes,
#                   and it comes from the book's own typesetting.
#
# A third source was tried and withdrawn on 14 Sept: a page whose running head
# was missing where the page before had one, opening with a short unpunctuated
# line. It won for five books in the corpus and was wrong in all five —
# Herrera's chapters came out as mid-sentence fragments, Rael's as scanner
# noise ("43%", "Z", "Sel"), Paz's as prose. A book with no chapter map should
# say none; a false map is worse than none.
#
# A book title also repeats, on every page rather than a chapter's worth, so it
# is excluded by share. A head set on rectos only appears on half its chapter's
# pages, which is why the contiguity test allows twice the count.
CHAPTER_MIN_FOUND = 3
BOOK_TITLE_SHARE = 0.4

LIGATURES = {
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\ufb05": "st",
    "\ufb06": "st",
}

# Characters that arrive wrong because an embedded subset font has a broken or
# absent ToUnicode map, so the glyph decodes through a Symbol-like table. Only
# applied between two letters, where none of these can occur legitimately.
#
# KEYED BY BOOK, because the same code point means different things in
# different files. £ is č in Lotman's transliterated Russian ("so£inenij" for
# sočinenij) and e in Méndez's OCR ("SáncH£z" for Sánchez). A global table
# would corrupt one book to repair the other. For the same reason the
# substitution is confined to a character standing between two letters: in
# Adorno's superscript font the digits map to ∞ ≤ ≥ ∂ ∑ ∏ π, and those must
# survive untouched wherever they are not inside a word.
#
# Adorno is the f-ligature expert set of a Type 1 font mapped through the wrong
# table: ff, ffi and ffl are broken while plain fi and fl are not, because
# those two live in the base font and the other three do not.
#
# Add to this by eye, per book. `--glyphs` lists every suspect character with
# the words it appears in, which is how each of these was found.
MOJIBAKE: dict[str, dict[str, str]] = {
    "adorno-the-polemics-of-possession-in-2007": {
        "\u221a": "ff",    # o√ered → offered, better o√ → better off
        "\u2248": "ffi",   # o≈ces → offices, insu≈cient → insufficient
        "\u0394": "ffl",   # shuΔing → shuffling
    },
}

# The characters a book's superscript font produces instead of digits, when its
# ToUnicode map is wrong, and what each one means.
#
# Adorno's, read off the notes themselves: page 34 carries notes 16 to 19 as
# ∞∏, ∞π, ∞∫, ∞Ω, which fixes ∞=1, ∏=6, π=7, ∫=8, Ω=9; earlier pages give
# ≤=2, ≥=3, ∂=4, ∑=5. Zero is unconfirmed — no note number below 100 in the
# pages read so far contains one — and √ is the guess, since it is the
# remaining glyph of the ten. Check it against note 10 or 20 when one turns up.
#
# These are DECODED, not deleted. An earlier version dropped them, which lost
# the note number with the noise: a passage she quotes should say that it
# carries note 17, because that is how she finds Adorno's note at the back.
# They are written as Unicode superscript digits, so they need no markup, read
# correctly as plain text, and can be stripped from a quotation by their code
# points alone.
#
# Most marks are caught in line_text by their superscript flag. These are the
# ones that are neither flagged nor set small enough, and what identifies them
# is position: a run of one to three of these characters immediately after
# sentence punctuation. The same characters elsewhere are untouched — which
# matters for √, the ff ligature in the body font and a digit in the
# superscript font.
SUPERSCRIPT_FIGURES = {
    "adorno-the-polemics-of-possession-in-2007": {
        "\u221e": "1", "\u2264": "2", "\u2265": "3", "\u2202": "4", "\u2211": "5",
        "\u220f": "6", "\u03c0": "7", "\u222b": "8", "\u03a9": "9", "\u221a": "0",
    },
}

SUPERSCRIPT_DIGITS = {
    "0": "\u2070", "1": "\u00b9", "2": "\u00b2", "3": "\u00b3", "4": "\u2074",
    "5": "\u2075", "6": "\u2076", "7": "\u2077", "8": "\u2078", "9": "\u2079",
}

AFTER_SENTENCE = r"[.,;:!?\u2019\u201d\u00bb\)\]]"

# A diacritic set as its own character beside the letter it belongs to. Which
# side it falls on differs by file, so each entry says: the caron precedes its
# letter ("Voloˇsinov" for Vološinov), the macron follows it ("emeˉndare" for
# emēndare).
#
# Deliberately short. An acute or a grave standing between two letters is far
# more often a typographic apostrophe than a diacritic — Rebolledo's "Ana´s" is
# Ana's, and composing it would give Anaś — so those are left alone.
DIACRITIC_BEFORE = {
    "\u02c7": "\u030c",  # caron
}
DIACRITIC_AFTER = {
    "\u02c9": "\u0304",  # modifier letter macron
}

# A line repeating across a quarter of a book, anywhere on the page, is
# furniture rather than text. Running heads are caught by their position; this
# catches what sits in the middle — above all the library's download stamp,
# which put "ebookcentral.proquest.com/lib/ucb/detail.action?docID=…" on all
# 290 pages of Gonzales and into every chunk and every embedding derived from
# them.
BOILERPLATE_SHARE = 0.25
BOILERPLATE_MIN_PAGES = 12
# The cap is generous because a download stamp is long: ProQuest sets author,
# title, publisher, the URL and a "Created from … on …" timestamp as one line,
# which runs to about 280 characters. A body paragraph repeating verbatim on a
# quarter of a book's pages is not a thing that happens.
BOILERPLATE_MAX_CHARS = 500

# A character with no business inside a word: not a letter, digit, apostrophe
# or hyphen. Used by --glyphs to find the next MOJIBAKE entry.
IN_WORD_ODDITY = re.compile(
    r"(?<=[A-Za-z\u00c0-\u024f])([^\sA-Za-z\u00c0-\u024f0-9'\u2019\-\u2010\u2011\u2013\u2014])"
    r"(?=[A-Za-z\u00c0-\u024f])"
)

# Paragraph geometry. A first line indented by more than this many points, or
# preceded by this much extra leading, opens a paragraph.
INDENT_MIN = 6.0
GAP_FACTOR = 0.55

# A span is a reference mark when it is superscript (or set much smaller than
# the body) AND holds no letters AND is short. The letter and length tests keep
# ordinals ("1st") and printed folios, which a bare size test would eat.
SMALL_SPAN = 0.72
MARK_MAX_CHARS = 4

# A gap between two spans wider than this fraction of the type size is a word
# space the PDF set by moving the pen instead of writing a space character.
# Well under a real space (about 0.25 em) so that kerning between spans of the
# same word does not insert one.
SPAN_GAP = 0.14


def fold(value: str) -> str:
    """Accent- and case-insensitive form, for matching only."""
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def clean_page(text: str, subs: dict[str, str], figures: dict[str, str] | None = None) -> str:
    # Compose accented characters into single code points. PDF extraction often
    # yields decomposed forms, and a decomposed á will not match a composed one
    # in any later comparison.
    text = unicodedata.normalize("NFC", text)

    for ligature, plain in LIGATURES.items():
        text = text.replace(ligature, plain)

    # Reference marks first, so that a √ belonging to a note number is decoded
    # before the ligature rule below claims every √ that follows a letter.
    if figures:
        def decode(match: re.Match) -> str:
            return "".join(SUPERSCRIPT_DIGITS[figures[c]] for c in match.group(0))

        text = re.sub(
            r"(?<=" + AFTER_SENTENCE + r")[" + re.escape("".join(figures)) + r"]{1,3}",
            decode,
            text,
        )

    # A letter before is enough. Requiring one after as well missed the
    # ligature at the end of a word — "better o√ being ruled" for "better off"
    # — which is where an f-ligature most often falls.
    for glyph, plain in subs.items():
        text = re.sub(
            r"(?<=[A-Za-z\u00c0-\u024f])" + re.escape(glyph),
            plain,
            text,
        )

    for spacing, combining in DIACRITIC_BEFORE.items():
        text = re.sub(
            r"(?<=[A-Za-z\u00c0-\u024f])" + re.escape(spacing) + r"([A-Za-z])",
            lambda m, c=combining: m.group(1) + c,
            text,
        )
    for spacing, combining in DIACRITIC_AFTER.items():
        text = re.sub(
            r"([A-Za-z])" + re.escape(spacing) + r"(?=[A-Za-z\u00c0-\u024f])",
            lambda m, c=combining: m.group(1) + c,
            text,
        )
    text = unicodedata.normalize("NFC", text)

    # Rejoin words broken across a line. The lowercase-only rule keeps genuine
    # compounds intact: "Franco-\nMexican" is a hyphenated word that happened to
    # break at its own hyphen, not a word split by the typesetter.
    text = re.sub(
        r"([a-z\u00e0-\u00ff])-\n([a-z\u00e0-\u00ff])",
        r"\1\2",
        text,
    )

    # Soft hyphens are invisible and break every search that crosses them.
    text = text.replace("\u00ad", "")

    # Within a paragraph the line endings are the printer's, not the author's,
    # and reflowing them is what makes the text readable and quotable. A blank
    # line is a paragraph break and survives.
    text = re.sub(r"(?<!\n)\n(?!\n)", " ", text)

    text = "\n".join(line.rstrip() for line in text.split("\n"))
    text = re.sub(r"[ \t\u00a0]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def body_size(blocks: list[dict]) -> float:
    """The size most of this page's characters are set in."""
    counts: Counter[float] = Counter()
    for block in blocks:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if text:
                    counts[round(float(span.get("size", 0)), 1)] += len(text)
    return counts.most_common(1)[0][0] if counts else 0.0


def line_text(line: dict, base: float, figures: dict[str, str] | None = None) -> str:
    """One line, with its endnote reference marks handled. Falls back to the
    whole line when dropping would empty it, so that a folio standing alone
    survives.

    A reference mark is KEPT when its characters can be read as a number —
    either plain digits, or this book's mis-decoded figures, which clean_page
    turns into superscript digits afterwards. Dropping them here is what lost
    notes 16 and 18 on Adorno's page 34 while 17 and 19 survived: those two
    were not flagged superscript, so they reached clean_page and were decoded,
    and the flagged pair never got there. Only a mark that cannot be read as a
    number at all is discarded.

    Spans are joined on their geometry rather than end to end. A PDF often sets
    the space between two words by moving the pen rather than by writing a
    space character, and concatenating the spans then yields "Mérida,Yucatán".
    Where the gap between one span's right edge and the next span's left edge
    is a fair fraction of the type size, a space belongs there."""
    kept: list[str] = []
    whole: list[str] = []
    prev_right = None

    for span in line.get("spans", []):
        text = span.get("text", "")
        whole.append(text)
        bbox = span.get("bbox", (0.0, 0.0, 0.0, 0.0))
        left, right = float(bbox[0]), float(bbox[2])
        size = float(span.get("size", base) or base or 10.0)

        if not text.strip():
            kept.append(text)
            prev_right = right
            continue

        superscript = bool(int(span.get("flags", 0)) & 1)
        small = bool(base) and float(span.get("size", base)) < base * SMALL_SPAN
        mark = (
            (superscript or small)
            and not any(ch.isalpha() for ch in text)
            and len(text.strip()) <= MARK_MAX_CHARS
        )

        if mark:
            body = text.strip()
            if body.isdigit():
                # A font whose map is intact: the note number is already a
                # number, and only needs raising.
                kept.append("".join(SUPERSCRIPT_DIGITS[d] for d in body))
            elif figures and all(ch in figures for ch in body):
                # A font whose map is broken: leave it for clean_page, which
                # knows what these glyphs mean in this book.
                kept.append(body)
            prev_right = right
            continue

        gapped = (
            prev_right is not None
            and left - prev_right > size * SPAN_GAP
            and kept
            and not kept[-1].endswith((" ", "\u00a0"))
            and not text.startswith((" ", "\u00a0"))
        )
        if gapped:
            kept.append(" ")
        kept.append(text)
        prev_right = right

    joined = "".join(kept).strip()
    return joined if joined else "".join(whole).strip()


def page_text(page, figures: dict[str, str] | None = None) -> str:
    """A page as paragraphs separated by a blank line, lines within a paragraph
    still separated by a newline so that clean_page can rejoin broken words
    before reflowing them."""
    blocks = [b for b in page.get_text("dict").get("blocks", []) if b.get("type") == 0]
    base = body_size(blocks)

    paragraphs: list[list[str]] = []
    for block in blocks:
        lines = []
        for line in block.get("lines", []):
            text = line_text(line, base, figures)
            if not text:
                continue
            x0, y0, _, y1 = line.get("bbox", (0.0, 0.0, 0.0, 0.0))
            lines.append((float(x0), float(y0), float(y1), text))
        if not lines:
            continue

        left = min(l[0] for l in lines)
        heights = sorted(l[2] - l[1] for l in lines)
        leading = heights[len(heights) // 2] if heights else 0.0

        current: list[str] = []
        prev_bottom = None
        for x0, y0, y1, text in lines:
            opens = bool(current) and (
                x0 > left + INDENT_MIN
                or (prev_bottom is not None and leading and y0 - prev_bottom > leading * GAP_FACTOR)
            )
            if opens:
                paragraphs.append(current)
                current = []
            current.append(text)
            prev_bottom = y1
        if current:
            paragraphs.append(current)

    return "\n\n".join("\n".join(p) for p in paragraphs)


def find_boilerplate(pages: list[str]) -> set[str]:
    """Lines repeating across the book wherever they sit on the page. Counted
    once per page, so a phrase used twice on one page does not inflate its own
    score."""
    if len(pages) < BOILERPLATE_MIN_PAGES:
        return set()

    counts: Counter[str] = Counter()
    for text in pages:
        seen = set()
        for line in text.split("\n"):
            line = line.strip()
            if not line or len(line) > BOILERPLATE_MAX_CHARS:
                continue
            masked = mask_folios(line)
            if masked and masked not in seen:
                seen.add(masked)
                counts[masked] += 1

    threshold = max(len(pages) * BOILERPLATE_SHARE, BOILERPLATE_MIN_PAGES)
    return {line for line, count in counts.items() if count >= threshold}


def strip_boilerplate(text: str, lines_to_drop: set[str]) -> str:
    kept = [
        line
        for line in text.split("\n")
        if not line.strip() or mask_folios(line) not in lines_to_drop
    ]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def mask_folios(line: str) -> str:
    """A running head differs page to page only by its folio. Mask digits so the
    two forms collapse into one for counting."""
    return re.sub(r"\d+", "#", line).strip()


def find_running_heads(pages: list[str]) -> set[str]:
    if len(pages) < HEADER_MIN_PAGES:
        return set()

    counts: Counter[str] = Counter()
    for text in pages:
        lines = [line for line in text.split("\n") if line.strip()]
        if not lines:
            continue
        counts[mask_folios(lines[0])] += 1
        if len(lines) > 1:
            counts[mask_folios(lines[-1])] += 1

    threshold = len(pages) * HEADER_SHARE
    heads = set()
    for line, count in counts.items():
        if not line or len(line) >= 120:
            continue
        if count >= threshold:
            heads.add(line)
        elif (
            count >= CHAPTER_HEAD_MIN
            and len(line) <= CHAPTER_HEAD_MAX_CHARS
            and not line.rstrip().endswith((".", "!", "?", ":", ";", ","))
        ):
            heads.add(line)
    return heads


def strip_running_heads(text: str, heads: set[str]) -> str:
    lines = text.split("\n")

    while lines and (not lines[0].strip() or mask_folios(lines[0]) in heads):
        lines.pop(0)
    while lines and (not lines[-1].strip() or mask_folios(lines[-1]) in heads):
        lines.pop()

    return "\n".join(lines).strip()


def heads_on_page(text: str, heads: set[str]) -> list[tuple[str, str]]:
    """The running heads standing at the top or bottom of one page, as
    (masked, as printed). Masked is what identifies the head across pages; the
    printed form is what a chapter title is recovered from."""
    lines = [line for line in text.split("\n") if line.strip()]
    if not lines:
        return []

    candidates = [lines[0]] if len(lines) == 1 else [lines[0], lines[-1]]
    found: list[tuple[str, str]] = []
    for line in candidates:
        masked = mask_folios(line)
        if masked in heads and masked not in [m for m, _ in found]:
            found.append((masked, line.strip()))
    return found


def tidy_title(line: str) -> str:
    """A running head as a chapter title: on one line, without its folio, and
    without the rule or bullet the folio was set against."""
    line = re.sub(r"\s+", " ", line)
    line = re.sub(r"\d+", " ", line)
    line = re.sub(r"\s{2,}", " ", line)
    return line.strip(" \t\u2022\u00b7|\u2014\u2013-.,").strip()


def dedupe_chapters(chapters: list[dict]) -> list[dict]:
    """One entry per chapter. A head recovered page by page repeats, and an
    outline sometimes lists one title at several consecutive pages."""
    out: list[dict] = []
    for chapter in chapters:
        if out and fold(out[-1]["title"]) == fold(chapter["title"]):
            continue
        out.append(chapter)
    return out


def glyph_report(raw_pages: list[str]) -> Counter:
    """Every character sitting inside a word that has no business there, with
    how often it occurs. Each is a candidate MOJIBAKE entry."""
    counts: Counter[str] = Counter()
    for text in raw_pages:
        for match in IN_WORD_ODDITY.finditer(text):
            counts[match.group(1)] += 1
    return counts


def glyph_examples(raw_pages: list[str], glyph: str, want: int = 4) -> list[str]:
    """The words a suspect character turns up in, which is what says what it
    was meant to be. Letters are required on both sides, so that a bracket
    opening a word is not reported as if it sat inside one."""
    pattern = re.compile(
        r"[A-Za-z\u00c0-\u024f]+" + re.escape(glyph) + r"[A-Za-z\u00c0-\u024f]+"
    )
    found: list[str] = []
    for text in raw_pages:
        for match in pattern.finditer(text):
            word = match.group(0)
            if word not in found:
                found.append(word)
                if len(found) >= want:
                    return found
    return found


def chapters_from_outline(files: list[Path]) -> list[dict]:
    """The PDF's own bookmarks. Pages are 1-based within each file, so a book
    assembled from several files needs each file's start added."""
    out: list[dict] = []
    base = 0
    for path in files:
        with fitz.open(path) as doc:
            try:
                toc = doc.get_toc(simple=True)
            except Exception:  # noqa: BLE001 — a malformed outline is not fatal
                toc = []
            for entry in toc:
                if len(entry) < 3:
                    continue
                level, title, page = entry[0], (entry[1] or "").strip(), entry[2]
                title = re.sub(r"\s+", " ", title)
                if title and isinstance(page, int) and page > 0:
                    out.append({"level": level, "title": title, "page": base + page})
            base += doc.page_count
    return dedupe_chapters(sorted(out, key=lambda c: c["page"]))


def chapters_from_heads(raw_pages: list[str], heads: set[str]) -> list[dict]:
    pages_for: dict[str, list[int]] = {}
    printed: dict[str, str] = {}
    for index, text in enumerate(raw_pages, start=1):
        for masked, as_printed in heads_on_page(text, heads):
            pages_for.setdefault(masked, []).append(index)
            printed.setdefault(masked, as_printed)

    total = max(len(raw_pages), 1)
    out: list[dict] = []
    for masked, pages in pages_for.items():
        if len(pages) > total * BOOK_TITLE_SHARE:
            continue  # the book's own title, not a chapter's
        first, last = pages[0], pages[-1]
        if (last - first + 1) > len(pages) * 2 + 6:
            continue  # scattered rather than a run: not one chapter
        title = tidy_title(printed[masked])
        if title:
            out.append({"level": 1, "title": title, "page": first, "last_page": last})
    return dedupe_chapters(sorted(out, key=lambda c: c["page"]))


def choose_chapters(sources: dict[str, list[dict]]) -> tuple[str, list[dict]]:
    for name in ("outline", "running heads"):
        if len(sources.get(name, [])) >= CHAPTER_MIN_FOUND:
            return name, sources[name]
    return "none", []


def close_chapters(chapters: list[dict], page_count: int, offset: int) -> list[dict]:
    """Give every chapter an end and a printed page. A chapter runs to the page
    before the next one starts, whatever its own head suggested, so that the
    spans tile the book without gaps or overlaps."""
    out = []
    for i, chapter in enumerate(chapters):
        last = chapters[i + 1]["page"] - 1 if i + 1 < len(chapters) else page_count
        out.append(
            {
                "level": chapter.get("level", 1),
                "title": chapter["title"],
                "page": chapter["page"],
                "last_page": max(last, chapter["page"]),
                "printed_page": chapter["page"] + offset,
            }
        )
    return out


# The printed folio, read BEFORE the running heads are stripped.
#
# This has to happen here and cannot be recovered later, because stripping is
# what destroys it. A bare page number masks to "#", which repeats on every
# page and is therefore removed as furniture; and where the folio is set inside
# the running head — "47 • Red Medicine" — the whole line goes with it.
#
# Two shapes are recognised: a line that is nothing but a number, and a number
# sitting in a line already identified as a running head. Anything from 2000 up
# is a year in a copyright notice rather than a folio.
def folio_from(text: str, heads: set[str]) -> int | None:
    lines = [line for line in text.split("\n") if line.strip()]
    if not lines:
        return None

    for line in (lines[0], lines[-1]):
        stripped = line.strip()

        if re.fullmatch(r"\d{1,4}", stripped):
            value = int(stripped)
            if 0 < value < 2000:
                return value

        if mask_folios(line) in heads:
            for run in re.findall(r"\d{1,4}", stripped):
                value = int(run)
                if 0 < value < 2000:
                    return value

    return None


def read_mapping() -> dict[str, dict]:
    if not MAPPING.exists():
        sys.exit(f"missing {MAPPING}")

    pdfs = sorted(p for p in CORPUS.rglob("*.pdf") if not p.name.startswith("."))
    if not pdfs:
        sys.exit(f"no PDFs in {CORPUS}")

    books: dict[str, dict] = {}
    with MAPPING.open(encoding="utf-8") as handle:
        for rule in csv.DictReader(handle):
            work_id = (rule.get("work_id") or "").strip()
            match = (rule.get("match") or "").strip()
            if not work_id or not match:
                if match:
                    print(f"  ! {match!r}: no work_id in mapping.csv, skipped")
                continue

            needle = fold(match)
            hits = [p for p in pdfs if needle in fold(p.name)]

            entry = books.setdefault(
                work_id, {"files": [], "page_offset": 0, "conflicts": []}
            )

            # A rule matching several files used to concatenate them into one
            # book without saying so: "Borderlands" caught both Anzaldúa and
            # Meléndez's Hidden Chicano Cinema, and 290 pages of the wrong book
            # were extracted, chunked and embedded under Anzaldúa's id. A book
            # genuinely split across files gets one row per file, each naming
            # its own.
            #
            # Recorded rather than raised, because mapping.csv describes the
            # whole corpus and one bad rule must not stop the extraction of a
            # different book. main() refuses only the books actually asked for.
            if len(hits) > 1:
                entry["conflicts"].append((match, [p.name for p in hits]))
                continue

            entry["files"].extend(hits)

    for entry in books.values():
        # Sorted so that a work split across several files assembles in a stable
        # order rather than whatever the filesystem returned.
        entry["files"] = sorted(set(entry["files"]), key=lambda p: p.name)

    return books


def extract_book(work_id: str, entry: dict, dry_run: bool) -> dict:
    raw_pages: list[str] = []
    provenance: list[dict] = []
    subs = MOJIBAKE.get(work_id, {})
    figures = SUPERSCRIPT_FIGURES.get(work_id)

    for path in entry["files"]:
        with fitz.open(path) as doc:
            start = len(raw_pages) + 1
            for page in doc:
                raw_pages.append(clean_page(page_text(page, figures), subs, figures))
            provenance.append(
                {
                    "file": path.name,
                    "first_page": start,
                    "last_page": len(raw_pages),
                }
            )

    heads = find_running_heads(raw_pages)
    boilerplate = find_boilerplate(raw_pages) - heads
    offset = entry["page_offset"]

    chapter_sources = {
        "outline": chapters_from_outline(entry["files"]),
        "running heads": chapters_from_heads(raw_pages, heads),
    }
    chapters_source, chosen = choose_chapters(chapter_sources)
    chapters = close_chapters(chosen, len(raw_pages), offset)

    pages = []
    for index, text in enumerate(raw_pages, start=1):
        # The folio is read before anything is stripped: stripping is what
        # destroys it.
        folio = folio_from(text, heads)
        body = strip_running_heads(text, heads) if heads else text
        if boilerplate:
            body = strip_boilerplate(body, boilerplate)
        pages.append(
            {
                "page": index,
                "printed_page": index + offset,
                "folio": folio,
                "chars": len(body),
                "text": body,
            }
        )

    document = {
        "work_id": work_id,
        "extracted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "extractor": f"pymupdf {getattr(fitz, '__version__', 'unknown')}",
        "page_offset": offset,
        "sources": provenance,
        "running_heads_removed": sorted(heads),
        "boilerplate_removed": sorted(boilerplate),
        "chapters_source": chapters_source,
        "chapters": chapters,
        "chapter_candidates": {
            name: len(found) for name, found in chapter_sources.items()
        },
        "pages": pages,
    }

    # Kept on the returned document for the --chapters report, and left out of
    # the file: three competing lists are for choosing between, not for storing.
    document["_chapter_sources"] = chapter_sources
    document["_raw_pages"] = raw_pages

    if not dry_run:
        PAGES.mkdir(exist_ok=True)
        out = PAGES / f"{work_id}.json"
        out.write_text(
            json.dumps(
                {k: v for k, v in document.items() if not k.startswith("_")},
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )

    return document


def report_glyphs(doc: dict) -> int:
    """Characters sitting inside words. Each is a font whose ToUnicode map lied;
    the words it appears in say what it should have been."""
    counts = glyph_report(doc["_raw_pages"])
    if not counts:
        print(f"  {doc['work_id']:<52} clean")
        return 0
    print(f"\n  {doc['work_id']}")
    for glyph, count in counts.most_common(12):
        words = glyph_examples(doc["_raw_pages"], glyph)
        name = unicodedata.name(glyph, "?")
        print(f"    {glyph}  U+{ord(glyph):04X}  {count:>5}x  {name[:34]:<34} {' '.join(words)[:52]}")
    return sum(counts.values())


def report_chapters(doc: dict) -> None:
    """Every source for one book, side by side, so a person picks."""
    offset = doc["page_offset"]
    chosen = doc["chapters_source"]
    print(f"\n  {doc['work_id']}  — using: {chosen}")

    for name, found in doc["_chapter_sources"].items():
        mark = "→" if name == chosen else " "
        if not found:
            print(f"    {mark} {name:<14} none")
            continue
        print(f"    {mark} {name:<14} {len(found)}")
        for chapter in found[:40]:
            printed = chapter["page"] + offset
            indent = "  " * max(chapter.get("level", 1) - 1, 0)
            print(f"         p.{printed:>5}  {indent}{chapter['title'][:64]}")
        if len(found) > 40:
            print(f"         … and {len(found) - 40} more")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "work",
        nargs="*",
        help="work ids, or any substring of one — anzaldua, lotman, saldana",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--chapters",
        action="store_true",
        help="print all chapter sources side by side and write nothing",
    )
    parser.add_argument(
        "--glyphs",
        action="store_true",
        help="list characters found inside words, as MOJIBAKE candidates; writes nothing",
    )
    args = parser.parse_args()

    if not MAPPING.exists():
        sys.exit(f"{MAPPING} not found.")

    books = read_mapping()
    if args.work:
        wanted = {resolve(n) for n in args.work}
        books = {k: v for k, v in books.items() if k in wanted}
    elif not (args.chapters or args.glyphs or args.dry_run):
        print(f"  extracting all {len(books)} mapped works. Name one to do less.")

    if not books:
        sys.exit("nothing to extract")

    total_pages = 0
    total_chars = 0
    empty_warnings = []

    for work_id, entry in sorted(books.items()):
        if entry.get("conflicts"):
            for match, names in entry["conflicts"]:
                listing = "\n        ".join(n[:96] for n in names)
                print(f"  ! {work_id}: match {match!r} hits {len(names)} files:")
                print(f"        {listing}")
            print("    Narrow the match column until it names one file. Skipped.")
            continue

        if not entry["files"]:
            print(f"  {work_id}: no file found, skipped")
            continue

        # Dict-mode extraction is slow on a scanned book, where the OCR text
        # layer can carry a span per word, so the report modes say where they
        # are rather than looking hung.
        if args.chapters or args.glyphs:
            print(f"  reading {work_id} …", end="\r", flush=True)

        doc = extract_book(work_id, entry, args.dry_run or args.chapters or args.glyphs)

        if args.chapters:
            report_chapters(doc)
            continue

        if args.glyphs:
            report_glyphs(doc)
            continue

        pages = doc["pages"]
        chars = sum(p["chars"] for p in pages)
        empty = sum(1 for p in pages if p["chars"] < 50)

        total_pages += len(pages)
        total_chars += chars

        offset_note = (
            f"  offset {doc['page_offset']:+d}" if doc["page_offset"] else ""
        )
        print(
            f"  {work_id:<52} {len(pages):>4}p  "
            f"{chars // max(len(pages), 1):>5} ch/p{offset_note}"
        )

        if doc["running_heads_removed"]:
            for head in doc["running_heads_removed"]:
                print(f"       removed running head: {head[:64]}")

        if doc["boilerplate_removed"]:
            for line in doc["boilerplate_removed"]:
                print(f"       removed repeated line: {line[:72]}")

        if empty > len(pages) * 0.2:
            empty_warnings.append((work_id, empty, len(pages)))

    if not args.chapters and not args.glyphs:
        print(f"\n  {total_pages:,} pages, {total_chars:,} characters")

        for work_id, empty, pages in empty_warnings:
            print(f"  ! {work_id}: {empty} of {pages} pages nearly empty — check it")

    if args.glyphs:
        print("\n  Nothing written. Each character above is one whose font said")
        print("  the wrong thing. Read the words it appears in, then add it to")
        print("  MOJIBAKE in this file and extract again.")
    elif args.chapters:
        print("\n  Nothing written. The outline is the book's own contents;")
        print("  the other two are inferred. Check the chosen one against the")
        print("  printed table of contents before loading.")
    elif args.dry_run:
        print("\n  dry run: nothing written")
    else:
        print(f"\n  Wrote {PAGES}/")
        print("  Read one beside its PDF before trusting any of it.")


if __name__ == "__main__":
    main()
