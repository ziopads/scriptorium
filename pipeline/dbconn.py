"""Shared plumbing for the pipeline: the connection string, and the map from a
file in the corpus to the catalogue work it is.

Read DATABASE_URL_UNPOOLED from .env.local at the repo root. The unpooled string
is required: each loader replaces one work's rows inside a single transaction,
which the pooled endpoint does not guarantee.

Nothing here prints a connection string, ever.

ONE KEY, NOT TWO

    There used to be a pipeline book_id alongside the catalogue work_id, and
    every script existed partly to translate between them. The book_id came
    from a filename, the work_id from a bibliography, and they disagreed
    whenever the two named different people:

        file       "Cuentos_ Tales from the Hispanic Southwest -- … Griego …"
        book_id    anaya-cuentos-hispanic-southwest-1980
        work_id    griego-y-maestas-cuentos-tales-from-the-hispanic-1980

    Nothing connected them but a column, and where that column was empty there
    was no way from one to the other but guesswork. So the book_id is gone, the
    JSON files are named for the work, and the catalogue id is the only
    identifier in the pipeline.

NEON SAYS WHICH FILE IS WHICH WORK

    Since 21 Sept the pipeline reads works.source_path and nothing else to
    learn a work's PDF. books.csv and mapping.csv are no longer read. A work has
    a file only if every name in its source_path is a PDF in corpus/ACCOUNTED.

    Every script takes full work ids. A near miss prints the ids containing it
    and stops: guessing which book someone meant is how the wrong one gets
    re-embedded.
"""

from __future__ import annotations

import os
import re
import sys
import unicodedata
from pathlib import Path

PIPELINE = Path(__file__).parent
ROOT = PIPELINE.parent
CORPUS = PIPELINE / "corpus"
ACCOUNTED = CORPUS / "ACCOUNTED"
PAGES = PIPELINE / "pages"
CHUNKS = PIPELINE / "chunks"

# Not touched by any --pending run. Lotman's file sits outside ACCOUNTED but was
# added by hand and is the right book; it stays as it is.
LEAVE_ALONE = ("lotman-estructura-texto-artistico-1982",)


# --------------------------------------------------------------------------
# Filenames
#
# One file reaches the pipeline spelled several ways: decomposed by macOS,
# composed by a spreadsheet, prefixed with pipeline/corpus/ by whatever wrote
# it into the database, and mangled into MacRoman by a spreadsheet that guessed
# the encoding on open and saved the guess back. These reduce every spelling to
# the one on disk, so that a comparison compares files and not spellings.

def filename_key(name: str) -> str:
    """Composed, trimmed, case-folded: for comparing only, never for writing."""
    return unicodedata.normalize("NFC", name).strip().casefold()


def corpus_names() -> set[str]:
    """The key of every PDF and EPUB under pipeline/corpus, in any folder.
    For recognising a filename; not for deciding that a work has a copy."""
    if not CORPUS.exists():
        return set()
    return {
        filename_key(p.name)
        for p in CORPUS.rglob("*")
        if p.is_file() and not p.name.startswith(".")
        and p.suffix.lower() in {".pdf", ".epub"}
    }


def accounted_names() -> set[str]:
    """The key of every PDF under pipeline/corpus/ACCOUNTED.

    THE RULE: a work has a file only if its PDF is here. An EPUB does not
    count, and neither does a PDF in any other folder — PARTIALS, OCR, the
    corpus root. Fong's Ethnic Studies Research and Keetley's Folk Horror both
    carried filenames in the database for files that are neither."""
    folder = CORPUS / "ACCOUNTED"
    if not folder.exists():
        return set()
    return {
        filename_key(p.name)
        for p in folder.rglob("*")
        if p.is_file() and not p.name.startswith(".") and p.suffix.lower() == ".pdf"
    }


def repair_mojibake(name: str, names: set[str], key=filename_key) -> str:
    """Undo a UTF-8 filename read as MacRoman, verified against the corpus.

    A spreadsheet that guesses the encoding turns a curly apostrophe and a
    combining accent into runs of Latin-1 punctuation — ’ into ‚Äô, í into
    iÃÅ — and saves the garbage back as real characters. The damage is
    mechanical and exactly reversible: those characters are the UTF-8 bytes of
    the original, so encoding back and decoding as UTF-8 returns the name.

    Nothing is guessed. The reversal is kept only if it names a file that
    exists; a repair that produces nothing real is not a repair.

    Moved here from inventory.py on 20 Sept, when books.csv was damaged this way
    a second time and the handover to the database needed the same repair.
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


def clean_filenames(value: str | None, names: set[str]) -> str:
    """A filename cell, from either side, as the file on disk would spell it:
    each piece stripped of any directory, repaired where a spreadsheet damaged
    it, composed, and pipe-joined. Written back in this form, never compared in
    any other."""
    out = []
    for piece in (value or "").split("|"):
        piece = unicodedata.normalize("NFC", piece).strip()
        if not piece:
            continue
        piece = piece.replace("\\", "/").rsplit("/", 1)[-1].strip()
        piece = repair_mojibake(piece, names)
        out.append(unicodedata.normalize("NFC", piece))
    return " | ".join(out)


def database_url() -> str:
    value = os.environ.get("DATABASE_URL_UNPOOLED")
    if not value:
        env = ROOT / ".env.local"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                m = re.match(r'^\s*DATABASE_URL_UNPOOLED\s*=\s*"?([^"\s]+)"?\s*$', line)
                if m:
                    value = m.group(1)
                    break
    if not value:
        sys.exit("DATABASE_URL_UNPOOLED is not set and was not found in .env.local")
    return value


def connect():
    try:
        import psycopg
    except ImportError:
        sys.exit('psycopg is not installed. Run: .venv/bin/pip install "psycopg[binary]"')
    return psycopg.connect(database_url())


def books() -> dict[str, dict]:
    """Retired on 21 Sept with books.csv and mapping.csv. Kept only so that a
    script still calling it fails by name instead of reading a stale register."""
    sys.exit(
        "dbconn.books() is retired: the pipeline reads works.source_path in Neon.\n"
        "    Use dbconn.source_paths() or dbconn.pdf_paths()."
    )


# --------------------------------------------------------------------------
# Which PDF is which work

def source_paths(ids: list[str] | None = None) -> dict[str, str]:
    """work_id -> works.source_path, cleaned to the spelling on disk. Works with
    no source_path are absent."""
    names = corpus_names()
    with connect() as conn:
        with conn.cursor() as cur:
            if ids is None:
                cur.execute("select id, source_path from works where source_path is not null")
            else:
                cur.execute(
                    "select id, source_path from works where source_path is not null"
                    " and id = any(%s)",
                    (list(ids),),
                )
            rows = cur.fetchall()
    out = {}
    for work_id, value in rows:
        cleaned = clean_filenames(value, names)
        if cleaned:
            out[work_id] = cleaned
    return out


def accounted_paths() -> dict[str, list[Path]]:
    """filename key -> every PDF under corpus/ACCOUNTED with that name. More
    than one path for a key means two copies under one name, which is refused
    rather than chosen between."""
    out: dict[str, list[Path]] = {}
    if not ACCOUNTED.exists():
        return out
    for p in ACCOUNTED.rglob("*"):
        if p.is_file() and not p.name.startswith(".") and p.suffix.lower() == ".pdf":
            out.setdefault(filename_key(p.name), []).append(p)
    return out


def pdf_paths(source: str, accounted: dict[str, list[Path]]) -> tuple[list[Path], list[str]]:
    """The files a cleaned source_path names, in the order it names them, and
    what is wrong with any that cannot be used. A work split across several
    files (Saldaña's three chapters) assembles in the order Neon holds them.

    THE RULE: a name counts only as a PDF in ACCOUNTED. The same name in OCR/,
    PARTIALS or the corpus root is reported, with where it was seen, and not
    used — that is how Gerhard was once extracted from its unrecognised scan."""
    found: list[Path] = []
    problems: list[str] = []
    for name in [p.strip() for p in source.split("|") if p.strip()]:
        paths = accounted.get(filename_key(name), [])
        if len(paths) == 1:
            found.append(paths[0])
            continue
        if len(paths) > 1:
            where = ", ".join(str(p.parent.relative_to(CORPUS)) for p in paths)
            problems.append(f"{name}\n          — several copies in ACCOUNTED: {where}")
            continue
        elsewhere = [
            str(p.parent.relative_to(CORPUS))
            for p in CORPUS.rglob("*")
            if p.is_file() and filename_key(p.name) == filename_key(name)
        ]
        note = f" (seen in {', '.join(elsewhere)})" if elsewhere else ""
        problems.append(f"{name}\n          — not in ACCOUNTED{note}")
    return found, problems


def has_file(source: str, accounted: dict[str, list[Path]]) -> bool:
    """Every name in a cleaned source_path is exactly one PDF in ACCOUNTED."""
    pieces = [p.strip() for p in source.split("|") if p.strip()]
    return bool(pieces) and all(len(accounted.get(filename_key(p), [])) == 1 for p in pieces)


# --------------------------------------------------------------------------
# The queue
#
# Each stage asks for the works that are ready for IT: extracted but not
# chunked, loaded but not checked, and so on. A batch run stage by stage with
# the same --pending N therefore walks the same books, because each stage picks
# up exactly what the one before it finished. A book that fails a stage drops
# out of the later ones by itself, and a book whose page numbering offsets.py
# could not settle stops before its sections, chunks and embeddings.
#
# Ordered by list, section and ordinal, as the lists are printed, with works on
# no list (her dissertation additions) after them. The list code is derived as
# the workbench derives it (lib/works.ts): I.C.4, II.A.12, Supl. III.

STAGES = (
    "extract", "chunk", "load_pages", "offsets",
    "load_sections", "load_chunks", "embed",
)

QUEUE = """
    select w.id,
           coalesce(w.source_path, ''),
           w.offset_checked_at is not null,
           w.offset_problem is not null,
           exists (select 1 from pages p where p.work_id = w.id),
           exists (select 1 from chunks c where c.work_id = w.id),
           exists (select 1 from chunks c where c.work_id = w.id and c.embedding is null),
           m.code
    from works w
    left join lateral (
      select el.sort as list_sort, ls.sort as section_sort, li.ordinal,
             case
               when el.id not in ('theory', 'dissertation', 'teaching') then null
               when ls.kind = 'supplementary' then
                 'Supl. ' || case el.id when 'theory' then 'I'
                                        when 'dissertation' then 'II' else 'III' end
               else
                 case el.id when 'theory' then 'I' when 'dissertation' then 'II' else 'III' end
                 || '.' || coalesce(ls.letter, '?') || '.' || coalesce(li.ordinal::text, '?')
             end as code
      from list_items li
      join exam_lists el on el.id = li.list_id
      left join list_sections ls on ls.id = li.section_id
      where li.work_id = w.id
      order by el.sort, ls.sort nulls last, li.ordinal nulls last
      limit 1
    ) m on true
    where w.id <> all(%s)
    order by m.list_sort nulls last, m.section_sort nulls last,
             m.ordinal nulls last, w.id
"""


def in_list(code: str | None, which: str) -> bool:
    """Whether a list code falls under --list. II matches II.A.3 and not
    III.A.3; II.A matches II.A.3; Supl. II matches only itself."""
    if not code:
        return False
    code, which = code.casefold(), which.casefold().strip().rstrip(".")
    return code == which or code.startswith(which + ".")


def pending(stage: str, limit: int, which: str | None = None) -> list[str]:
    """The next `limit` works ready for `stage`, in list order.

        extract        a file in ACCOUNTED, no extraction on disk, no pages loaded
        chunk          an extraction on disk, no chunk file, no chunks loaded
        load_pages     an extraction on disk, no pages loaded
        offsets        pages loaded, no chunks loaded, numbering not yet checked
        load_sections  numbering checked with no problem, no chunks loaded
        load_chunks    the same
        embed          numbering checked with no problem, chunks without vectors
    """
    if stage not in STAGES:
        raise ValueError(f"unknown stage {stage!r}")

    accounted = accounted_paths() if stage == "extract" else {}
    names = corpus_names() if stage == "extract" else set()

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(QUEUE, (list(LEAVE_ALONE),))
            rows = cur.fetchall()

    out: list[str] = []
    for (work_id, source, checked, problem,
         has_pages, has_chunks, unembedded, code) in rows:
        if which and not in_list(code, which):
            continue
        pages_file = (PAGES / f"{work_id}.json").exists()
        chunks_file = (CHUNKS / f"{work_id}.json").exists()

        if stage == "extract":
            ready = (
                bool(source)
                and has_file(clean_filenames(source, names), accounted)
                and not pages_file and not has_pages
            )
        elif stage == "chunk":
            ready = pages_file and not chunks_file and not has_chunks
        elif stage == "load_pages":
            ready = pages_file and not has_pages
        elif stage == "offsets":
            ready = has_pages and not has_chunks and not checked
        elif stage in ("load_sections", "load_chunks"):
            ready = has_pages and checked and not problem and not has_chunks
        else:  # embed
            ready = unembedded and checked and not problem

        if ready:
            out.append(work_id)
            if len(out) >= limit:
                break
    return out


def offset_problems(ids: list[str]) -> dict[str, str]:
    """work_id -> offset_problem, for the named works that have one. Sections,
    chunks and embeddings are not loaded for these until the numbering is
    settled and offsets.py has been run on them again."""
    if not ids:
        return {}
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select id, offset_problem from works"
                " where id = any(%s) and offset_problem is not null",
                (list(ids),),
            )
            return dict(cur.fetchall())


def skip_offset_problems(ids: list[str]) -> list[str]:
    """The named works minus those with an unsettled page numbering, each
    skipped by name with its problem printed."""
    blocked = offset_problems(ids)
    for work_id, problem in blocked.items():
        print(f"  ! {work_id}: page numbering unsettled, skipped")
        print(f"      {problem}")
    return [w for w in ids if w not in blocked]


def announce_pending(wanted: list[str], have: set[str], missing_note: str) -> list[str]:
    """Print the batch a --pending run has chosen, and say which members of it
    this stage cannot act on.

    A stage that quietly processed four of five would be the same failure as a
    loader run with no arguments: the report and the disk disagreeing, and the
    report winning. Anything named here and absent is printed by name.
    """
    print(f"  {len(wanted)} pending:")
    for work_id in wanted:
        mark = " " if work_id in have else "!"
        print(f"  {mark} {work_id}")
    absent = [w for w in wanted if w not in have]
    for work_id in absent:
        print(f"    {work_id}: {missing_note}")
    print()
    return [w for w in wanted if w in have]


_WORK_IDS: list[str] | None = None


def work_ids() -> list[str]:
    """Every id in the works table."""
    global _WORK_IDS
    if _WORK_IDS is None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select id from works order by id")
                _WORK_IDS = [r[0] for r in cur.fetchall()]
    return _WORK_IDS


def resolve(needle: str) -> str:
    """A full work id, checked against the works table. Anything else prints
    the ids containing it and stops."""
    ids = work_ids()
    if needle in ids:
        return needle

    folded = needle.casefold()
    hits = [i for i in ids if folded in i.casefold()]
    if not hits:
        sys.exit(f"{needle!r} is not a work id, and no work id contains it.")
    listing = "\n      ".join(hits[:20])
    more = f"\n      … and {len(hits) - 20} more" if len(hits) > 20 else ""
    sys.exit(
        f"{needle!r} is not a work id. Ids containing it:\n      {listing}{more}\n"
        f"    Name the work by its full id."
    )


def resolve_all(needles: list[str]) -> list[str]:
    """The named works. Naming none is refused: a run over every work is how
    twenty books once got extracted in one afternoon."""
    if not needles:
        sys.exit("name the works by full id, or use --pending N")
    return [resolve(n) for n in needles]
