#!/usr/bin/env python3
"""Build a work's dossier from its own loaded text, and load it into Neon.

    python3 pipeline/dossier.py --dry-run <work id>        # the units, no model call
    python3 pipeline/dossier.py <work id>                  # generate; writes the JSON only
    python3 pipeline/dossier.py --condense <work id>       # redo only the study aid, from the JSON
    python3 pipeline/dossier.py --load --dry-run <work id> # what would go into Neon
    python3 pipeline/dossier.py --load <work id>           # write dossier_sections

Named works only, by full id. Generating costs usage and a dossier wants
reading before it is loaded, so there is no --pending.

WHAT IT PRODUCES

    pipeline/dossiers/{work_id}.json holds two layers. Gitignored: it quotes
    the book.

    The record: every claim the book makes, part by part, each with verbatim
    quotations found in the book and the printed page they were found on,
    plus what was dropped and why. Fine-grained on purpose: it is what the
    aid condenses, and each claim is already the shape of a note (the
    author's claim, a passage, a page) for when notes are loaded from it.

    The study aid, condensed from the record in one call:
        summary        the general argument, 300-400 words
        key_arguments  10-12 arguments, each with the book's example and
                       one or two quotations chosen from the record
        key_terms      8-12 of the book's own concepts, defined, each with
                       a quotation
        themes         at most three connections per dissertation theme,
                       labelled in the app as the assistant's proposals

    --load writes, in one transaction, four rows to dossier_sections
    (migration 004), each with origin 'assistant', reviewed false and the
    model recorded: summary, argument (the key arguments), key_terms and
    themes; and one assistant note per claim, tagged 'dossier', with an anchor
    for each verified quotation, for her to review on the book's claims page.
    Bodies are JSON in the existing text column.

WHY IT CANNOT INVENT A QUOTATION OR A PAGE

    Pass one reads the book a chapter (or a window of pages) at a time and
    returns claims, each with verbatim quotations. Every quotation is then
    looked for in pages.text. One that is not found is dropped; a claim with
    no quotation found is dropped. The printed page stored is the page where
    the match was found, through the printed_pages view, never the page the
    model named. The text stored is the book's own text at the match, so an
    OCR error the model silently corrected comes back as the page prints it.

    A check pass then reads each surviving claim beside its quotations and
    says whether they support it. Unsupported claims are dropped; partly
    supported ones are kept and marked.

    The condensing call sees only surviving claims, and chooses quotations by
    reference (claim id and number), never by retyping them, so every
    quotation in the aid is one already found in the book. Any paragraph,
    argument, concept or bridge that cites no real claim is dropped.

    Every capitalised word and number in the model's own wording is looked
    for in the book's vocabulary; what is not found is marked, and an example
    carrying one is removed.

    What this cannot guarantee: that a claim characterises its passage fairly,
    or that the selection is the book's most important. That is what the
    check pass narrows and what her review is for.

FRONT MATTER

    Pages printed before page 1 (title pages, contents, prelims) are left out
    of every run: nothing on them is cited in an exam or a dissertation, and
    a page number below 1 is no citation. A record made before this rule has
    its front-matter quotations removed when it is condensed.

MATCHING

    Both sides are normalized as lib/quotation.ts normalizes a captured
    quotation (soft hyphens, note references, line-end hyphens, whitespace),
    then compared case-insensitively with quotation marks and dashes unified.
    An exact match is tried on the page the model named, its neighbours and
    the page joins between them, then the whole unit, then the whole book. A
    close match (for an OCR slip or a corrected accent) is tried on the named
    page and its neighbours only, and must cover almost all of the quotation.

THE MODEL CALLS go through Claude Code's non-interactive mode, `claude -p`,
so they use the account Claude Code is logged into (`claude login`) rather
than an API key. Any ANTHROPIC_API_KEY in the environment is removed before
each call, because Claude Code would otherwise bill the key instead of the
subscription. Each call runs in an empty temporary directory with file, shell
and web tools disallowed: the model sees the prompt and nothing else.

    --units N   generate from the first N units only, for a cheap trial
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from dbconn import connect, resolve

PIPELINE = Path(__file__).parent
DOSSIERS = PIPELINE / "dossiers"
THEMES_FILE = PIPELINE / "dossier-themes.txt"

# Claude Code accepts an alias for the latest model of a family, or a full
# model name.
DEFAULT_MODEL = "opus"
CALL_TIMEOUT = 1800          # seconds; a 45-page chapter is a long read

# Everything the model could reach beyond the prompt. It is given the text it
# needs; nothing else it could find would be the book.
DISALLOWED_TOOLS = [
    "Bash", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS",
    "WebFetch", "WebSearch", "NotebookEdit", "NotebookRead", "Task", "TodoWrite",
]

# A unit is a chapter where the book has a chapter map. A chapter longer than
# MAX_UNIT_PAGES, or a book with no map, is read in windows of WINDOW_PAGES.
WINDOW_PAGES = 30
MAX_UNIT_PAGES = 45
MIN_PAGE_CHARS = 50          # below this a page is blank, a plate, or a title
FIRST_CITABLE_PAGE = 1       # below this is front matter

MIN_QUOTE_CHARS = 25         # shorter than this matches too easily to prove anything
FUZZY_RATIO = 0.92           # share of the quotation's characters that must align
CHECK_BATCH = 20             # claims per check call

# The study aid's sizes.
MAX_KEY_ARGUMENTS = 12
MAX_KEY_TERMS = 12
MAX_QUOTES_PER_ARGUMENT = 2
MAX_BRIDGES_PER_THEME = 3

VERSION = 2


# --------------------------------------------------------------------------
# Setup

def claude_path() -> str:
    path = shutil.which("claude")
    if not path:
        sys.exit("claude is not on the PATH: install Claude Code and run `claude login`")
    return path


def read_themes() -> list[str]:
    if not THEMES_FILE.exists():
        sys.exit(f"{THEMES_FILE.name} is missing: one theme per line")
    themes = [
        line.strip()
        for line in THEMES_FILE.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if not themes:
        sys.exit(f"{THEMES_FILE.name} holds no themes")
    return themes


def load_work(work_id: str) -> dict:
    """The work's record, its pages in file order, and its level-1 sections.
    Refuses a work whose page numbering is unchecked or unsettled: every page
    in a dossier is a citation, and a wrong offset makes every one wrong."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select title, author, year, language, offset_checked_at, offset_problem"
                " from works where id = %s",
                (work_id,),
            )
            row = cur.fetchone()
            title, author, year, language, checked, problem = row
            if problem:
                sys.exit(f"{work_id}: page numbering unsettled — {problem}")
            if not checked:
                sys.exit(
                    f"{work_id}: page numbering not checked. Run offsets.py on it first;"
                    " a dossier's pages are citations."
                )
            cur.execute(
                "select page_index, printed_page, text from printed_pages"
                " where work_id = %s order by page_index",
                (work_id,),
            )
            pages = [
                {"index": i, "printed": p, "text": t} for i, p, t in cur.fetchall()
            ]
            cur.execute(
                "select ordinal, title, first_page, last_page from sections"
                " where work_id = %s and level = 1 order by ordinal",
                (work_id,),
            )
            sections = [
                {"ordinal": o, "title": t, "first": f, "last": l}
                for o, t, f, l in cur.fetchall()
            ]
    if not pages:
        sys.exit(f"{work_id}: no pages loaded")
    return {
        "id": work_id, "title": title, "author": author, "year": year,
        "language": language, "pages": pages, "sections": sections,
    }


# --------------------------------------------------------------------------
# Units

def windows(pages: list[dict], title: str) -> list[dict]:
    out = []
    for start in range(0, len(pages), WINDOW_PAGES):
        chunk = pages[start:start + WINDOW_PAGES]
        out.append({"title": title, "pages": chunk})
    return out


def build_units(work: dict) -> list[dict]:
    """Chapters where there is a map, windows otherwise. Front matter and
    near-empty pages are left out; other pages outside every chapter are kept
    as their own unit rather than silently skipped."""
    pages = [
        p for p in work["pages"]
        if len(p["text"]) >= MIN_PAGE_CHARS and p["printed"] >= FIRST_CITABLE_PAGE
    ]
    sections = work["sections"]

    raw: list[dict] = []
    if len(sections) >= 2:
        covered: set[int] = set()
        for i, s in enumerate(sections):
            last = s["last"]
            if last is None:
                last = sections[i + 1]["first"] - 1 if i + 1 < len(sections) else 10 ** 6
            members = [p for p in pages if s["first"] <= p["printed"] <= last]
            covered.update(p["index"] for p in members)
            if members:
                raw.append({"title": s["title"], "pages": members})
        stray = [p for p in pages if p["index"] not in covered]
        if len(stray) > 3:
            raw.append({"title": "Páginas fuera del índice", "pages": stray})
        raw.sort(key=lambda u: u["pages"][0]["index"])
    else:
        raw = [{"title": "", "pages": pages}]

    units: list[dict] = []
    for u in raw:
        if len(u["pages"]) > MAX_UNIT_PAGES or not u["title"]:
            units.extend(windows(u["pages"], u["title"]))
        else:
            units.append(u)
    for n, u in enumerate(units, start=1):
        u["n"] = n
        first, last = u["pages"][0]["printed"], u["pages"][-1]["printed"]
        u["label"] = (f"{u['title']} " if u["title"] else "") + f"(pp. {first}–{last})"
    return units


# --------------------------------------------------------------------------
# Normalization and matching

SOFT_HYPHEN = re.compile("\u00ad")
NOTE_REFERENCE = re.compile("[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+")
HYPHEN_AT_LINE_END = re.compile(r"([^\W\d_])[-\u2010\u2011]\s*\n\s*([^\W\d_])")
LINE_BREAK = re.compile(r"\s*\n\s*")
RUN_OF_SPACES = re.compile(r"[ \t\u00a0]+")

# One character for one character, so a position in the key is a position in
# the normalized text and the book's own span can be cut from it.
KEY_MAP = str.maketrans({
    "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u00ab": '"', "\u00bb": '"',
    "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u2039": "'", "\u203a": "'",
    "\u2013": "-", "\u2014": "-", "\u2010": "-", "\u2011": "-",
})


def normalize(raw: str) -> str:
    """The same steps as normalizeQuotation in lib/quotation.ts."""
    text = unicodedata.normalize("NFC", raw)
    text = SOFT_HYPHEN.sub("", text)
    text = NOTE_REFERENCE.sub("", text)
    text = HYPHEN_AT_LINE_END.sub(r"\1\2", text)
    text = LINE_BREAK.sub(" ", text)
    text = RUN_OF_SPACES.sub(" ", text)
    return text.strip()


def key(text: str) -> str:
    """For comparing only. Lowercasing a character keeps its position for every
    letter in these books; a character that would change length is kept."""
    out = []
    for ch in text.translate(KEY_MAP):
        low = ch.lower()
        out.append(low if len(low) == 1 else ch)
    return "".join(out)


class Book:
    """The work's pages, normalized once, for looking quotations up."""

    def __init__(self, pages: list[dict]):
        self.pages = pages
        self.pos = {p["index"]: n for n, p in enumerate(pages)}
        self.by_printed: dict[int, int] = {}
        for n, p in enumerate(pages):
            self.by_printed.setdefault(p["printed"], n)
        self.norm = [normalize(p["text"]) for p in pages]
        self.keys = [key(t) for t in self.norm]

    def joined(self, n: int) -> tuple[str, str, int] | None:
        """Page n and page n+1 as one text, with where the second begins. A word
        hyphenated across the break is joined, as within a page."""
        if n + 1 >= len(self.pages):
            return None
        a, b = self.norm[n], self.norm[n + 1]
        if re.search(r"[^\W\d_][-\u2010\u2011]$", a) and re.match(r"[^\W\d_]", b):
            text = a[:-1] + b
            split = len(a) - 1
        else:
            text = a + " " + b
            split = len(a) + 1
        return text, key(text), split

    def candidates(self, near: int | None, unit: list[int] | None) -> list[int]:
        """Positions to search, nearest first."""
        seen: list[int] = []
        if near is not None and near in self.by_printed:
            c = self.by_printed[near]
            for n in (c, c - 1, c + 1, c - 2, c + 2):
                if 0 <= n < len(self.pages) and n not in seen:
                    seen.append(n)
        for n in unit or []:
            if n not in seen:
                seen.append(n)
        return seen

    def exact(self, qkey: str, positions: list[int]):
        for n in positions:
            at = self.keys[n].find(qkey)
            if at != -1:
                return self._hit(n, self.norm[n][at:at + len(qkey)], "exact", None)
        for n in positions:
            j = self.joined(n)
            if not j:
                continue
            text, k, split = j
            at = k.find(qkey)
            if at != -1:
                crosses = at < split <= at + len(qkey)
                start = n if at < split else n + 1
                return self._hit(start, text[at:at + len(qkey)], "exact", n + 1 if crosses else None)
        return None

    def fuzzy(self, qkey: str, positions: list[int]):
        best = None
        for n in positions:
            for text, k, split, second in self._texts(n):
                sm = difflib.SequenceMatcher(None, qkey, k, autojunk=False)
                blocks = [b for b in sm.get_matching_blocks() if b.size >= 3]
                if not blocks:
                    continue
                matched = sum(b.size for b in blocks)
                ratio = matched / len(qkey)
                start, end = blocks[0].b, blocks[-1].b + blocks[-1].size
                span = end - start
                if ratio < FUZZY_RATIO or not (0.85 * len(qkey) <= span <= 1.2 * len(qkey)):
                    continue
                if best is None or ratio > best[0]:
                    crosses = second and start < split <= end
                    page = n if not second or start < split else n + 1
                    best = (ratio, page, text[start:end], n + 1 if crosses else None)
        if best:
            ratio, page, span_text, second = best
            return self._hit(page, span_text, f"close ({ratio:.0%})", second)
        return None

    def _texts(self, n: int):
        yield self.norm[n], self.keys[n], 0, False
        j = self.joined(n)
        if j:
            text, k, split = j
            yield text, k, split, True

    def _hit(self, n: int, text: str, match: str, second: int | None) -> dict:
        page = self.pages[n]["printed"]
        label = f"{page}–{self.pages[second]['printed']}" if second is not None else str(page)
        return {"text": text.strip(), "page": page, "pages": label, "match": match}

    def find(self, quote: str, near: int | None, unit: list[int]) -> dict | None:
        q = normalize(quote).strip(" \"'\u201c\u201d\u00ab\u00bb")
        if len(q) < MIN_QUOTE_CHARS:
            return None
        qkey = key(q)
        near_positions = self.candidates(near, None)
        unit_positions = self.candidates(near, unit)
        return (
            self.exact(qkey, near_positions)
            or self.exact(qkey, unit_positions)
            or self.exact(qkey, list(range(len(self.pages))))
            or self.fuzzy(qkey, near_positions)
        )


# --------------------------------------------------------------------------
# Names and numbers the book does not contain
#
# The quotations are checked character by character, but the wording around
# them is the model's, and that is where a date or a first name from its
# general knowledge would enter. So every capitalised word and every number in
# that wording is looked for in the book's own vocabulary.
#
# Accents are folded for the comparison, because the OCR drops them (Urena for
# Ureña). A word within a small edit distance of a book word is accepted, for
# the same reason (Qiiiroga for Quiroga). A capitalised word whose lowercase
# form is in the book passes: that is a common word opening a sentence. The
# author's name, the title and the themes file are known too, since claims are
# written as "Rama sostiene…" and bridges name her themes. Claim references
# such as (c46) are removed first; their digits are not the book's numbers.
#
# This is a net for imported facts, not a proof of accuracy. A flag means:
# look at the page.

WORD = re.compile(r"[^\W\d_]{2,}|\d+")
CLAIM_REF = re.compile(r"\bc\d+\b")


def fold(word: str) -> str:
    decomposed = unicodedata.normalize("NFKD", word.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


class Vocabulary:
    def __init__(self, texts: list[str], extra: list[str]):
        self.words: set[str] = set()
        for text in texts + extra:
            self.words.update(fold(w) for w in WORD.findall(text))
        self.by_initial: dict[str, list[str]] = {}
        for w in self.words:
            if len(w) >= 4 and not w.isdigit():
                self.by_initial.setdefault(w[0], []).append(w)
        self.memo: dict[str, bool] = {}

    def known(self, token: str) -> bool:
        f = fold(token)
        if f in self.memo:
            return self.memo[f]
        ok = f in self.words
        if not ok and not f.isdigit() and len(f) >= 4:
            ok = bool(difflib.get_close_matches(f, self.by_initial.get(f[0], []), n=1, cutoff=0.8))
        self.memo[f] = ok
        return ok

    def unfound(self, text: str) -> list[str]:
        """Capitalised words and numbers in text that the book does not hold,
        in order, without repeats."""
        out: list[str] = []
        for token in WORD.findall(CLAIM_REF.sub(" ", text or "")):
            if not (token.isdigit() or token[0].isupper()):
                continue
            if not self.known(token) and token not in out:
                out.append(token)
        return out


def vocabulary_for(work: dict, themes: list[str]) -> Vocabulary:
    return Vocabulary(
        [p["text"] for p in work["pages"]],
        [work["author"] or "", work["title"] or ""] + themes,
    )


# --------------------------------------------------------------------------
# The model, through Claude Code

FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


def structured(data: dict | list) -> dict | None:
    """The structured result from claude -p's JSON output: structured_output
    when --json-schema is honoured, otherwise the text in `result` parsed as
    JSON. A single result object, or an array of messages ending in one."""
    if isinstance(data, list):
        results = [m for m in data if isinstance(m, dict) and m.get("type") == "result"]
        if not results:
            return None
        data = results[-1]
    if data.get("is_error"):
        return None
    out = data.get("structured_output")
    if isinstance(out, dict):
        return out
    text = data.get("result")
    if isinstance(text, str):
        try:
            parsed = json.loads(FENCE.sub("", text))
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def call(model: str, system: str, user: str, tool: dict) -> dict:
    """One call through `claude -p`, returning an object matching the tool's
    schema. The prompt goes on stdin: a chapter is too long to pass safely as
    an argument. Three attempts; a reply that does not parse, or lacks the
    schema's required keys, counts as a failed attempt."""
    schema = tool["input_schema"]
    required = schema.get("required", [])
    system = (
        system
        + "\n\nReply with a single JSON object matching the schema you are given,"
        " and nothing else."
    )
    command = [
        claude_path(), "-p",
        "--output-format", "json",
        "--json-schema", json.dumps(schema),
        "--system-prompt", system,
        "--model", model,
        "--disallowedTools", *DISALLOWED_TOOLS,
    ]
    # Without this, a key in the environment is billed instead of the
    # subscription.
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}

    delay = 30
    last = ""
    for attempt in range(3):
        with tempfile.TemporaryDirectory(prefix="dossier-") as empty:
            try:
                proc = subprocess.run(
                    command, input=user, capture_output=True, text=True,
                    timeout=CALL_TIMEOUT, cwd=empty, env=env,
                )
            except subprocess.TimeoutExpired:
                last = f"no reply within {CALL_TIMEOUT}s"
                proc = None
        if proc is not None:
            if proc.returncode != 0:
                last = (
                    f"claude -p exited with status {proc.returncode}\n"
                    f"stderr: {proc.stderr.strip()[-1500:]}\n"
                    f"stdout: {proc.stdout.strip()[-3000:]}"
                )
            else:
                try:
                    data = json.loads(proc.stdout)
                except json.JSONDecodeError:
                    data = None
                    last = "claude -p did not return JSON: " + proc.stdout.strip()[:300]
                if data is not None:
                    out = structured(data)
                    if out is not None and all(k in out for k in required):
                        return out
                    head = data[-1] if isinstance(data, list) and data else data
                    last = (
                        f"reply for {tool['name']} did not match the schema: "
                        + json.dumps(head, ensure_ascii=False)[:600]
                    )
        if attempt < 2:
            print(f"\n      {last}\n      retrying in {delay}s", flush=True)
            time.sleep(delay)
            delay *= 2
    sys.exit(f"claude -p failed three times on {tool['name']}:\n{last}")


# --------------------------------------------------------------------------
# Pass one: claims

CLAIMS_TOOL = {
    "name": "record_claims",
    "description": "Record the author's claims in this part of the book, each with verbatim quotations.",
    "input_schema": {
        "type": "object",
        "properties": {
            "claims": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "claim": {
                            "type": "string",
                            "description": "What the author argues here, in Spanish, one to three sentences.",
                        },
                        "topic": {
                            "type": "string",
                            "description": "A short topic label in Spanish, two to six words.",
                        },
                        "example": {
                            "type": "string",
                            "description": "The text, author, case or example the author uses, if any, in Spanish, and only as named in the quotations. Empty if none.",
                        },
                        "quotes": {
                            "type": "array",
                            "description": "One to four quotations; together they must show every name, date, term and work mentioned in the claim and the example.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "text": {
                                        "type": "string",
                                        "description": "Copied exactly from the page, character for character.",
                                    },
                                    "page": {
                                        "type": "integer",
                                        "description": "The page number in the marker above the text.",
                                    },
                                },
                                "required": ["text", "page"],
                            },
                        },
                    },
                    "required": ["claim", "topic", "quotes"],
                },
            },
        },
        "required": ["claims"],
    },
}

CLAIMS_SYSTEM = """You are preparing a study aid for a doctoral candidate's comprehensive exams, from the text of one book. You will see one part of the book, with each page introduced by a marker giving its printed page number.

Record the author's substantive claims in this part: the arguments, definitions, distinctions and conclusions the book puts forward, and the examples it uses to make them. Not every sentence; the claims a reader would need to report the book's argument accurately in an oral exam. Typically four to twelve for a chapter.

Rules:
- Use only this text. Nothing you know about the author, the book or its reception from elsewhere.
- A claim states what the author argues. Where the author reports or rejects someone else's view, say so in the claim ("Rama rechaza la idea de que…", "según Ortiz, …"), so that no one else's position is attributed to the author.
- Every claim needs one to four quotations that show the author making it. Copy each quotation exactly as it appears on the page, character for character, including any spelling or scanning errors. Do not correct, modernize, translate, abridge or join separate passages. Ten to sixty words each.
- Every name, date, term and work mentioned in a claim or its example must appear in one of that claim's quotations. If a detail matters, add a quotation that shows it; otherwise leave the detail out. Never add a date, a first name, a title or a place from your own knowledge, even one you are sure of.
- Give each quotation the page number from the marker of the page it is on. If it runs across a page break, give the page where it starts.
- Write the claim, topic and example in Spanish. Quotations stay in the book's language.
- If this part has no substantive argument (a table of contents, an index, a bibliography, acknowledgements), return an empty list."""


def pass_one(model: str, work: dict, unit: dict) -> list[dict]:
    header = f"{work['author'] or ''}, {work['title']}".strip(", ")
    parts = [f"Book: {header}", f"Part: {unit['label']}", ""]
    for p in unit["pages"]:
        parts.append(f"=== p. {p['printed']} ===")
        parts.append(p["text"])
        parts.append("")
    return call(model, CLAIMS_SYSTEM, "\n".join(parts), CLAIMS_TOOL).get("claims", [])


# --------------------------------------------------------------------------
# The check pass

CHECK_TOOL = {
    "name": "record_verdicts",
    "description": "Record, for each claim, whether its quotations support it.",
    "input_schema": {
        "type": "object",
        "properties": {
            "verdicts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "verdict": {"type": "string", "enum": ["supported", "partial", "unsupported"]},
                        "reason": {
                            "type": "string",
                            "description": "In Spanish, one sentence. Required unless supported.",
                        },
                    },
                    "required": ["id", "verdict"],
                },
            },
        },
        "required": ["verdicts"],
    },
}

CHECK_SYSTEM = """You are checking a study aid against its evidence. Each item is a claim about what a book's author argues, followed by quotations from the book.

For each claim, judge from the quotations alone, not from anything you know about the book:
- supported: the quotations show the author making this claim.
- partial: the quotations support part of it, or the claim states it more strongly or more broadly than they do.
- unsupported: the quotations do not show this, or show the author reporting a view the claim attributes to the author.

Return one verdict per claim, using its id."""


def check_claims(model: str, claims: list[dict]) -> dict[str, dict]:
    verdicts: dict[str, dict] = {}
    for start in range(0, len(claims), CHECK_BATCH):
        batch = claims[start:start + CHECK_BATCH]
        lines = []
        for c in batch:
            lines.append(f"[{c['id']}] {c['claim']}")
            for q in c["quotes"]:
                lines.append(f"    p. {q['pages']}: \u201c{q['text']}\u201d")
            lines.append("")
        result = call(model, CHECK_SYSTEM, "\n".join(lines), CHECK_TOOL)
        for v in result.get("verdicts", []):
            verdicts[v["id"]] = {"verdict": v["verdict"], "reason": v.get("reason", "")}
    return verdicts


# --------------------------------------------------------------------------
# The study aid: one call over the record

QUOTE_REF = {
    "type": "object",
    "properties": {
        "claim": {"type": "string", "description": "The claim's id, e.g. c12."},
        "n": {"type": "integer", "description": "The quotation's number within that claim, from 1."},
    },
    "required": ["claim", "n"],
}

CITED = {
    "type": "object",
    "properties": {
        "text": {"type": "string", "description": "In Spanish, with no claim ids in the text."},
        "claims": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["text", "claims"],
}

AID_TOOL = {
    "name": "record_study_aid",
    "description": "Record a concise study aid condensed from the book's verified claims.",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {
                "type": "array",
                "description": "The general argument: three or four paragraphs, 300 to 400 words in all.",
                "items": CITED,
            },
            "key_arguments": {
                "type": "array",
                "description": "Ten to twelve key arguments, covering the whole book in its order.",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "In Spanish, four to ten words."},
                        "text": {"type": "string", "description": "In Spanish, two to four sentences, no claim ids."},
                        "example": {"type": "string", "description": "The book's own example, taken from the cited claims. Empty if none."},
                        "claims": {"type": "array", "items": {"type": "string"}},
                        "quotes": {"type": "array", "items": QUOTE_REF, "description": "One or two, the clearest."},
                    },
                    "required": ["title", "text", "claims", "quotes"],
                },
            },
            "key_terms": {
                "type": "array",
                "description": "Eight to twelve of the book's own concepts.",
                "items": {
                    "type": "object",
                    "properties": {
                        "term": {"type": "string", "description": "As the book names it."},
                        "definition": {"type": "string", "description": "In Spanish, one or two sentences, as the book uses it."},
                        "claims": {"type": "array", "items": {"type": "string"}},
                        "quote": QUOTE_REF,
                    },
                    "required": ["term", "definition", "claims", "quote"],
                },
            },
            "themes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "theme": {"type": "string", "description": "The theme exactly as given."},
                        "bridges": {"type": "array", "items": CITED, "description": "At most three."},
                    },
                    "required": ["theme", "bridges"],
                },
            },
        },
        "required": ["summary", "key_arguments", "key_terms", "themes"],
    },
}

AID_SYSTEM = """You are writing a study aid for a doctoral candidate reviewing for comprehensive exams. You are given the verified claims of one book, in the book's order, each with an id, its pages, and numbered quotations found in the book. Use only these claims.

The aid must be short enough to review in one sitting. Produce, all in Spanish:

1. summary: the book's general argument in three or four paragraphs, 300 to 400 words in all: what it sets out to show, how the argument proceeds through the whole book, and what it concludes. Weigh the later parts as much as the opening.

2. key_arguments: the ten to twelve arguments a candidate must be able to state and defend in an oral exam, in the book's order, covering the whole book. Each: a short title, two to four sentences, the book's own example where it has one (taken from the cited claims), and the one or two clearest quotations, chosen by claim id and quotation number. Prefer quotations from claims not marked as partly supported.

3. key_terms: eight to twelve of the book's own concepts, each named as the book names it, defined in one or two sentences as the book uses it, with one quotation where the book states or uses it.

4. themes: for each of the candidate's dissertation themes, at most the three strongest ways the book's arguments could bear on it. These are the aid's proposals, not the author's positions, and must be written that way ("Este planteamiento podría servir para…"). Where the book offers nothing for a theme, give no bridges.

Rules:
- Every paragraph, argument, concept and bridge lists the ids of the claims it rests on, and says nothing those claims do not support.
- Never put claim ids in the prose; they go only in the claims lists.
- Choose quotations only by reference. Never retype a quotation.
- Do not repeat any term marked as not found in the book."""


def aid_prompt(work: dict, claims: list[dict], themes: list[str]) -> str:
    header = f"{work['author'] or ''}, {work['title']}".strip(", ")
    lines = [f"Book: {header}", "", "Dissertation themes:"]
    lines += [f"- {t}" for t in themes]
    lines += ["", "Claims, in the book's order:"]
    for c in claims:
        pages = ", ".join(sorted({q["pages"] for q in c["quotes"]}, key=lambda s: int(s.split("–")[0])))
        mark = " [partly supported]" if c["check"]["verdict"] == "partial" else ""
        lines.append(f"[{c['id']}] (pp. {pages}) {c['topic']}: {c['claim']}{mark}")
        if c.get("unfound"):
            lines.append("    not found in the book, do not repeat: " + ", ".join(c["unfound"]))
        if c.get("example"):
            lines.append(f"    ejemplo: {c['example']}")
        for n, q in enumerate(c["quotes"], start=1):
            lines.append(f"    q{n} p. {q['pages']}: \u201c{q['text']}\u201d")
    return "\n".join(lines)


def build_aid(model: str, work: dict, claims: list[dict], themes: list[str],
              vocabulary: Vocabulary) -> dict:
    """One model call, then every reference checked against the record.
    Quotations are copied from the record, never from the reply."""
    reply = call(model, AID_SYSTEM, aid_prompt(work, claims, themes), AID_TOOL)
    by_id = {c["id"]: c for c in claims}
    dropped: list[dict] = []

    def cited(ids) -> list[str]:
        return [i for i in (ids or []) if i in by_id]

    def quote(ref) -> dict | None:
        if not isinstance(ref, dict):
            return None
        c = by_id.get(ref.get("claim"))
        n = ref.get("n")
        if not c or not isinstance(n, int) or not 1 <= n <= len(c["quotes"]):
            return None
        return {**c["quotes"][n - 1], "claim": c["id"]}

    def cited_text(items, where: str, limit: int | None = None) -> list[dict]:
        out = []
        for item in items or []:
            ids = cited(item.get("claims"))
            if not ids:
                dropped.append({"where": where, "text": item.get("text", ""), "reason": "cites no verified claim"})
                continue
            out.append({"text": item.get("text", "").strip(), "claims": ids,
                        "unfound": vocabulary.unfound(item.get("text", ""))})
        return out[:limit] if limit else out

    summary = cited_text(reply.get("summary"), "summary")

    arguments = []
    for a in reply.get("key_arguments", []):
        ids = cited(a.get("claims"))
        quotes = [q for q in (quote(r) for r in a.get("quotes", [])) if q][:MAX_QUOTES_PER_ARGUMENT]
        if not ids or not quotes:
            dropped.append({"where": "key argument", "text": a.get("title", ""),
                            "reason": "no verified claim" if not ids else "no valid quotation reference"})
            continue
        entry = {
            "title": a.get("title", "").strip(),
            "text": a.get("text", "").strip(),
            "example": (a.get("example") or "").strip(),
            "claims": ids,
            "quotes": quotes,
            "unfound": vocabulary.unfound(f"{a.get('title', '')} {a.get('text', '')}"),
        }
        missing = vocabulary.unfound(entry["example"])
        if missing:
            entry["example_removed"] = {"text": entry["example"], "unfound": missing}
            entry["example"] = ""
        arguments.append(entry)

    terms = []
    for t in reply.get("key_terms", []):
        ids = cited(t.get("claims"))
        q = quote(t.get("quote"))
        if not ids or not q:
            dropped.append({"where": "key term", "text": t.get("term", ""),
                            "reason": "no verified claim" if not ids else "no valid quotation reference"})
            continue
        terms.append({
            "term": t.get("term", "").strip(),
            "definition": t.get("definition", "").strip(),
            "claims": ids,
            "quote": q,
            "unfound": vocabulary.unfound(t.get("definition", "")),
        })

    theme_out = []
    for t in reply.get("themes", []):
        theme_out.append({
            "theme": t.get("theme", ""),
            "bridges": cited_text(t.get("bridges"), f"theme: {t.get('theme', '')}", MAX_BRIDGES_PER_THEME),
        })

    return {
        "summary": summary,
        "key_arguments": arguments[:MAX_KEY_ARGUMENTS],
        "key_terms": terms[:MAX_KEY_TERMS],
        "themes": theme_out,
        "dropped_from_aid": dropped,
    }


def groups_by_unit(claims: list[dict]) -> list[dict]:
    """The full record grouped by the part of the book each claim came from,
    in the book's order. No model call."""
    groups: list[dict] = []
    for c in claims:
        if not groups or groups[-1]["topic"] != c["unit"]:
            groups.append({"topic": c["unit"], "claims": []})
        groups[-1]["claims"].append(c["id"])
    return groups


def without_front_matter(claims: list[dict]) -> list[dict]:
    """Quotations on pages before page 1 removed; a claim left with none goes."""
    out = []
    for c in claims:
        quotes = [q for q in c["quotes"] if q["page"] >= FIRST_CITABLE_PAGE]
        if quotes:
            out.append({**c, "quotes": quotes})
    return out


def report_aid(aid: dict) -> None:
    words = sum(len(p["text"].split()) for p in aid["summary"])
    print(f"  study aid: summary {len(aid['summary'])} paragraphs ({words} words) ·"
          f" {len(aid['key_arguments'])} key arguments · {len(aid['key_terms'])} key terms ·"
          f" {sum(len(t['bridges']) for t in aid['themes'])} theme bridges")
    flagged = (
        sum(1 for p in aid["summary"] if p["unfound"])
        + sum(1 for a in aid["key_arguments"] if a["unfound"])
        + sum(1 for t in aid["key_terms"] if t["unfound"])
        + sum(1 for t in aid["themes"] for b in t["bridges"] if b["unfound"])
    )
    removed = sum(1 for a in aid["key_arguments"] if a.get("example_removed"))
    if flagged or removed:
        print(f"  names and numbers: {flagged} items marked, {removed} examples removed")
    if aid["dropped_from_aid"]:
        print(f"  {len(aid['dropped_from_aid'])} items dropped from the aid; see dropped_from_aid")


def write_document(work_id: str, document: dict) -> Path:
    DOSSIERS.mkdir(exist_ok=True)
    out = DOSSIERS / f"{work_id}.json"
    tmp = out.with_suffix(".json.part")
    tmp.write_text(json.dumps(document, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(out)
    return out


# --------------------------------------------------------------------------
# Generate: the record, then the aid

def generate(work_id: str, model: str, limit: int | None) -> None:
    work = load_work(work_id)
    themes = read_themes()
    units = build_units(work)
    total = len(units)
    if limit:
        units = units[:limit]
    book = Book(work["pages"])
    started = time.time()

    trial = f" (trial: first {len(units)} of {total})" if len(units) < total else ""
    print(f"  {work_id}: {len(units)} units{trial}, model {model}")

    proposed: list[dict] = []
    for unit in units:
        print(f"    {unit['n']:>2}/{len(units)}  {unit['label'][:60]}", end="", flush=True)
        raw = pass_one(model, work, unit)
        positions = [book.pos[p["index"]] for p in unit["pages"]]
        for c in raw:
            c["unit"] = unit["label"]
            c["_positions"] = positions
        proposed.extend(raw)
        print(f"  {len(raw)} claims")

    kept: list[dict] = []
    dropped: list[dict] = []
    quotes_found = quotes_lost = 0
    for n, c in enumerate(proposed, start=1):
        found, lost = [], []
        for q in c.get("quotes", []):
            hit = book.find(q.get("text", ""), q.get("page"), c["_positions"])
            if hit and hit["page"] >= FIRST_CITABLE_PAGE:
                found.append(hit)
            else:
                lost.append({"text": q.get("text", ""), "page": q.get("page")})
        quotes_found += len(found)
        quotes_lost += len(lost)
        record = {
            "id": f"c{n}",
            "claim": c.get("claim", "").strip(),
            "topic": c.get("topic", "").strip(),
            "example": (c.get("example") or "").strip(),
            "unit": c["unit"],
            "quotes": found,
            "quotes_not_found": lost,
        }
        if found:
            kept.append(record)
        else:
            record["reason"] = "no quotation found in the book"
            dropped.append(record)

    print(f"  quotations: {quotes_found} found, {quotes_lost} not found")
    print(f"  claims: {len(kept)} with a quotation found, {len(dropped)} dropped")

    vocabulary = vocabulary_for(work, themes)
    flagged_claims = removed_examples = 0
    for c in kept:
        c["unfound"] = vocabulary.unfound(c["claim"])
        if c["unfound"]:
            flagged_claims += 1
        missing = vocabulary.unfound(c["example"])
        if missing:
            c["example_removed"] = {"text": c["example"], "unfound": missing}
            c["example"] = ""
            removed_examples += 1
    print(f"  names and numbers: {flagged_claims} claims carry one not found in the book;"
          f" {removed_examples} examples removed for the same reason")

    print("  checking claims against their quotations …", flush=True)
    verdicts = check_claims(model, kept)
    surviving = []
    for c in kept:
        c["check"] = verdicts.get(c["id"], {"verdict": "unchecked", "reason": ""})
        if c["check"]["verdict"] == "unsupported":
            c["reason"] = "check: " + (c["check"]["reason"] or "quotations do not support it")
            dropped.append(c)
        elif c["check"]["verdict"] == "unchecked":
            c["reason"] = "check returned no verdict"
            dropped.append(c)
        else:
            surviving.append(c)
    partial = sum(1 for c in surviving if c["check"]["verdict"] == "partial")
    print(f"  check: {len(surviving)} kept ({partial} partly supported),"
          f" {len(kept) - len(surviving)} dropped")

    if not surviving:
        sys.exit("no claims survived; nothing to condense")

    # The record is written before the aid, so a failure in the last call
    # costs only that call: --condense redoes it from this file.
    document = {
        "version": VERSION,
        "work_id": work_id,
        "model": model,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "units": [u["label"] for u in units],
        "units_in_book": total,
        "themes_given": themes,
        "groups": groups_by_unit(surviving),
        "claims": {c["id"]: {k: v for k, v in c.items() if k != "id"} for c in surviving},
        "dropped_claims": [{k: v for k, v in c.items() if not k.startswith("_")} for c in dropped],
    }
    out = write_document(work_id, document)
    print(f"  record written ({len(surviving)} claims)")

    print("  condensing the study aid …", flush=True)
    aid = build_aid(model, work, surviving, themes, vocabulary)
    document.update(aid)
    write_document(work_id, document)

    report_aid(aid)
    close = sum(1 for c in surviving for q in c["quotes"] if q["match"] != "exact")
    print(f"  {close} quotations matched closely rather than exactly; each carries its match")
    print(f"  {time.time() - started:.0f}s")
    print(f"\n  Wrote {out}")


def condense(work_id: str, model: str) -> None:
    """Redo only the study aid, from a record already on disk."""
    path = DOSSIERS / f"{work_id}.json"
    if not path.exists():
        sys.exit(f"no dossier file for {work_id}; generate it first")
    document = json.loads(path.read_text(encoding="utf-8"))
    work = load_work(work_id)
    themes = read_themes()
    vocabulary = vocabulary_for(work, themes)

    claims = [{"id": i, **c} for i, c in document["claims"].items()]
    before = len(claims)
    claims = without_front_matter(claims)
    for c in claims:
        c["unfound"] = vocabulary.unfound(c["claim"])
    if before != len(claims):
        print(f"  {before - len(claims)} claims resting only on front matter removed")
    print(f"  {work_id}: condensing {len(claims)} claims, model {model}", flush=True)

    started = time.time()
    aid = build_aid(model, work, claims, themes, vocabulary)

    # The old pass-two sections go; the record stays, regrouped by part.
    for old in ("summary", "themes", "dropped_synthesis"):
        document.pop(old, None)
    document["version"] = VERSION
    document["model"] = model
    document["claims"] = {c["id"]: {k: v for k, v in c.items() if k != "id"} for c in claims}
    document["groups"] = groups_by_unit(claims)
    document["condensed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    document.update(aid)
    out = write_document(work_id, document)

    report_aid(aid)
    print(f"  {time.time() - started:.0f}s")
    print(f"\n  Wrote {out}")


# --------------------------------------------------------------------------
# Load
#
# Two things go into Neon in one transaction: the study aid, as four rows of
# dossier_sections, and the record, as one assistant note per claim.
#
# Each claim note: kind 'note', attribution 'author' (the claim is the
# author's, never hers), origin 'assistant', reviewed false, tagged 'dossier',
# plus 'respaldo-parcial' if the check found its quotations only partly
# support it and 'revisar-nombres' if its wording holds a name or number not
# in the book. One note_anchors row per verified quotation, with the printed
# page. The app keeps unreviewed dossier notes out of her lists and reviews
# them on the book's claims page (lib/notes.ts).
#
# A regenerated dossier numbers its claims afresh, so a reload cannot tell
# which new claim is which old one. Claims are therefore written only for a
# book that has none. --replace-claims deletes the ones still unreviewed and
# writes the new set; everything she accepted or rejected stays as it is.

PARTIAL_TAG = "respaldo-parcial"
NAMES_TAG = "revisar-nombres"


def claim_body(c: dict) -> str:
    body = c["claim"].strip()
    if c.get("example"):
        body += f"\n\nEjemplo: {c['example'].strip()}"
    return body


def claim_tags(c: dict) -> list[str]:
    tags = ["dossier"]
    if c.get("check", {}).get("verdict") == "partial":
        tags.append(PARTIAL_TAG)
    if c.get("unfound"):
        tags.append(NAMES_TAG)
    return tags


def load(work_id: str, dry_run: bool, force: bool, replace_claims: bool) -> None:
    path = DOSSIERS / f"{work_id}.json"
    if not path.exists():
        sys.exit(f"no dossier file for {work_id}; generate it first")
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("version") != VERSION or "key_arguments" not in doc:
        sys.exit(f"{work_id}: the file has no study aid in the current form; run --condense first")
    claims = doc["claims"]

    def pages_of(ids) -> list[int]:
        return sorted({q["page"] for i in ids if i in claims for q in claims[i]["quotes"]})

    def with_pages(items: list[dict]) -> list[dict]:
        return [{**item, "pages": pages_of(item["claims"])} for item in items]

    def cited(pages: list[int]) -> list[str]:
        return [f"p. {p}" for p in pages]

    summary = with_pages(doc["summary"])
    themes = [{"theme": t["theme"], "bridges": with_pages(t["bridges"])} for t in doc["themes"]]
    argument_pages = sorted({q["page"] for a in doc["key_arguments"] for q in a["quotes"]})
    term_pages = sorted({t["quote"]["page"] for t in doc["key_terms"]})

    rows = [
        ("summary", {"version": VERSION, "paragraphs": summary},
         cited(sorted({p for s in summary for p in s["pages"]}))),
        ("argument", {"version": VERSION, "key_arguments": doc["key_arguments"]},
         cited(argument_pages)),
        ("key_terms", {"version": VERSION, "terms": doc["key_terms"]},
         cited(term_pages)),
        ("themes", {"version": VERSION, "themes": themes},
         cited(sorted({p for t in themes for b in t["bridges"] for p in b["pages"]}))),
    ]

    ordered = sorted(claims.items(), key=lambda kv: int(kv[0][1:]))

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select kind, reviewed from dossier_sections where work_id = %s"
                " and kind = any(%s)",
                (work_id, [r[0] for r in rows]),
            )
            existing = dict(cur.fetchall())
            cur.execute(
                """
                select count(*) filter (where n.reviewed = false and n.rejected_at is null),
                       count(*)
                from notes n
                where 'dossier' = any(n.tags)
                  and exists (select 1 from note_anchors a
                              where a.note_id = n.id and a.work_id = %s)
                """,
                (work_id,),
            )
            pending, loaded = cur.fetchone()

        reviewed = [k for k, v in existing.items() if v]
        if reviewed and not force:
            sys.exit(
                f"{work_id}: {', '.join(reviewed)} already reviewed; loading would"
                " replace reviewed text. Rerun with --force to replace it."
            )

        for kind, body, sources in rows:
            state = "replace" if kind in existing else "insert"
            print(f"  {state:<7} {kind:<9} {len(json.dumps(body, ensure_ascii=False)):>9,} chars"
                  f"  {len(sources)} pages cited")

        if loaded and not replace_claims:
            write_claims = False
            print(f"  claims    {loaded} already loaded ({pending} unreviewed); left as they are."
                  " --replace-claims replaces the unreviewed ones.")
        else:
            write_claims = True
            anchors = sum(len(c["quotes"]) for _, c in ordered)
            gone = f", replacing {pending} unreviewed" if loaded else ""
            print(f"  claims    {len(ordered)} notes with {anchors} quotations{gone}")

        if dry_run:
            print("\n  dry run: nothing written")
            return

        generated = doc.get("condensed_at") or doc["generated_at"]
        with conn.transaction():
            with conn.cursor() as cur:
                for kind, body, sources in rows:
                    cur.execute(
                        """
                        insert into dossier_sections
                          (work_id, kind, body, sources, origin, reviewed, model,
                           generated_at, updated_at)
                        values (%s, %s, %s, %s, 'assistant', false, %s, %s, now())
                        on conflict (work_id, kind) do update set
                          body = excluded.body, sources = excluded.sources,
                          origin = 'assistant', reviewed = false, model = excluded.model,
                          generated_at = excluded.generated_at, updated_at = now()
                        """,
                        (work_id, kind, json.dumps(body, ensure_ascii=False), sources,
                         doc["model"], generated),
                    )

                if write_claims and loaded:
                    cur.execute(
                        """
                        delete from notes n
                        where 'dossier' = any(n.tags)
                          and n.reviewed = false and n.rejected_at is null
                          and exists (select 1 from note_anchors a
                                      where a.note_id = n.id and a.work_id = %s)
                        """,
                        (work_id,),
                    )

                if write_claims:
                    anchor_rows = []
                    for _, c in ordered:
                        cur.execute(
                            """
                            insert into notes (kind, body, attribution, tags, origin, reviewed)
                            values ('note', %s, 'author', %s, 'assistant', false)
                            returning id
                            """,
                            (claim_body(c), claim_tags(c)),
                        )
                        note_id = cur.fetchone()[0]
                        for n, q in enumerate(c["quotes"], start=1):
                            anchor_rows.append((note_id, n, work_id, q["page"], q["text"]))
                    cur.executemany(
                        """
                        insert into note_anchors (note_id, ordinal, work_id, printed_page, quote)
                        values (%s, %s, %s, %s, %s)
                        """,
                        anchor_rows,
                    )

    written = f" and {len(ordered)} claim notes" if write_claims else ""
    print(f"\n  {len(rows)} sections{written} loaded for {work_id}")


# --------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("work", nargs="*", help="full work ids")
    parser.add_argument("--dry-run", action="store_true",
                        help="generate: list the units, no model call; with --load: report, write nothing")
    parser.add_argument("--condense", action="store_true",
                        help="redo only the study aid from the record on disk")
    parser.add_argument("--load", action="store_true",
                        help="write the study aid into dossier_sections")
    parser.add_argument("--force", action="store_true",
                        help="with --load, replace sections already marked reviewed")
    parser.add_argument("--replace-claims", action="store_true",
                        help="with --load, replace the claims still unreviewed")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--units", type=int, metavar="N",
                        help="generate from the first N units only, for a trial")
    args = parser.parse_args()

    if not args.work:
        parser.error("name the works by full id")
    works = [resolve(n) for n in args.work]

    for work_id in works:
        if args.load:
            load(work_id, args.dry_run, args.force, args.replace_claims)
        elif args.condense:
            condense(work_id, args.model)
        elif args.dry_run:
            work = load_work(work_id)
            read_themes()
            units = build_units(work)
            source = "chapters" if len(work["sections"]) >= 2 else "page windows"
            chars = sum(len(p["text"]) for u in units for p in u["pages"])
            print(f"  {work_id}: {len(units)} units from {source},"
                  f" {chars:,} characters of text")
            for u in units:
                print(f"    {u['n']:>2}  {len(u['pages']):>3}p  {u['label'][:70]}")
            print("\n  dry run: no model call made")
        else:
            generate(work_id, args.model, args.units)


if __name__ == "__main__":
    main()
