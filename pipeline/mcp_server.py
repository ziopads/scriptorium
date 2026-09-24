#!/usr/bin/env python3
"""Scriptorium's local MCP server: the corpus and her notes, as tools a Claude
client can call.

    pipeline/.venv/bin/python3 pipeline/mcp_server.py

Speaks stdio. Registered in .mcp.json at the repo root for Claude Code, or in
Claude Desktop's config with the same command. Nothing here may print to
stdout: stdout carries the protocol, and a stray line breaks the session.

THE TOOLS

    find_works      catalogue lookup, so the model can name works by full id
    search          semantic search over the embedded chunks (search.py's query)
    read_pages      page text by printed page, labelled by how sure its number is
    find_quotation  dossier.py's matcher, as a read tool
    get_study_aid   a work's dossier sections, reviewed or not, marked which
    list_claims     a work's dossier claims she has accepted
    list_notes      her notes, with the app's exclusions
    draft_note      the one write: a proposal, verified, for her review

WHAT draft_note GUARANTEES

    Every quotation is looked up in the book with dossier.Book.find, the
    matcher that built the dossiers: exact on the named page and its
    neighbours, then the whole book, then a close match (92 per cent) near the
    named page only. The text stored is the book's own text at the match and
    the page stored is where it was found, through printed_pages. The model's
    wording and page number are discarded.

    One quotation not found refuses the whole note. So does a quotation on
    front matter, a quotation shorter than 25 characters, and any quotation
    from a work whose page numbering is unchecked, or unsettled and not
    accepted, because its pages are not citations.

PAGE NUMBERS, AS THE APP SHOWS THEM

    A work whose numbering offsets.py could not settle can be accepted as it
    stands (migrations 016, 017; docs/PAGE-NUMBERS.md). Acceptance takes
    precedence over offset_problem: an accepted work is citable here, as it is
    searchable in the app. read_pages, find_quotation and search say how far
    its page numbers can be trusted, by the app's own rule (unverifiedPages in
    lib/works.ts), so a model quoting it can say so:

        verified    checked by offsets.py, nothing in doubt
        hand set    reviewed by a person outside the pipeline: an offset or
                    page ranges entered by hand
        unverified  an accepted file that prints no usable numbers: the page
                    is the file's own, not the edition's. Or, for a work not
                    accepted, numbering unsettled. The app marks both with an
                    asterisk
        unchecked   never checked; not citable

    Every page number also leaves in the two forms the app gives it
    (lib/page-verified.ts, ported below): page_label, with an asterisk after
    the number when the work is marked, and page_verified, 'yes', 'hand set'
    or 'no', as the notes export writes it. The remote server (mcp/) returns
    the same fields, so the two answer a call alike.

    The note goes in with origin 'assistant' and reviewed false, so it lands
    in her proposals queue (lib/notes.ts, listUnreviewedNotes). Attribution is
    'author', 'other' or left empty. 'own' is refused: whether a claim is hers
    is hers to say, and an empty attribution also puts the note in her
    Unattributed list. The 'dossier' tag is refused, since it would move the
    note out of the proposals queue and onto the book's claims page.

    Note and anchors are written in one transaction.
"""

from __future__ import annotations

import json
import unicodedata

from pydantic import BaseModel, Field

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from dbconn import connect as _connect
from dossier import FIRST_CITABLE_PAGE, MIN_QUOTE_CHARS, Book, normalize
from embed import DEFAULT_DIM, DEFAULT_MODEL
from search import embed_query

MAX_PAGES_PER_READ = 10
MAX_SEARCH_RESULTS = 30
MAX_WORKS_LISTED = 25
MAX_NOTES_LISTED = 50

# The same text as INSTRUCTIONS in mcp/server.ts, so a model reads the same
# guidance from either server.
INSTRUCTIONS = """Scriptorium holds a doctoral candidate's exam corpus: the books' page text, study aids, and her notes. This connection can read and search, and can propose notes for her review through draft_note; it cannot edit or delete anything.

Name every work by its full id; find_works gives it. Page numbers are printed pages. Every page number comes with page_label, the number as the app shows it, with an asterisk when the number is unverified; quote page_label (pages_label in search and find_quotation results), asterisk included, whenever you cite a page. page_verified is 'yes', 'hand set' (reviewed by a person) or 'no'. page_numbers explains the work's numbering in words. A work whose pages are not citable (never checked, or unsettled and not accepted) can still be read, but its page numbers are not citations.

find_quotation checks a quotation against the page text and returns the book's own words at the match and the page where they were found; quote what it returns, not what you sent.

Anything you write for her goes through draft_note, which verifies every quotation against the page text and stores the book's own words and page; one quotation not found refuses the whole note. Copy quotations exactly from read_pages, search or find_quotation results. For your own analysis, leave attribution out; she decides whose claim it is. Use 'author' only when the note reports the anchored work's own position, and 'other' with attributed_to for a third party's. The note waits in her proposals queue until she accepts or rejects it.

Study-aid sections and notes say whether she has reviewed them. An unreviewed section, or a note with origin 'assistant' and reviewed false, is a draft or a pending proposal, not her view; say so when you use it. Notes carry an attribution (author, own, other) saying whose claim they state."""

mcp = MCPServer("scriptorium", instructions=INSTRUCTIONS)


# --------------------------------------------------------------------------
# Plumbing

def connect():
    """dbconn.connect, with its sys.exit turned into a tool error: an exit
    here would end the server, not the call."""
    try:
        return _connect()
    except SystemExit as exc:
        raise ToolError(str(exc)) from None


def fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value or "")
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def numbering(checked, problem, accepted=None, basis=None) -> str:
    if problem and accepted:
        return "accepted (hand set)" if basis == "hand_set" else "accepted (no printed numbers)"
    if problem:
        return f"problem: {problem}"
    return "checked" if checked else "unchecked"


def page_numbers(checked, problem, accepted, basis) -> str:
    """How far a work's page numbers can be trusted, by the app's rule
    (unverifiedPages in lib/works.ts): marked when offset_problem is set and
    the basis is anything but hand_set, a null basis counting as marked. The
    wording separates an accepted file that prints no numbers from a work whose
    numbering is simply unsettled, since those are different warnings."""
    if problem and basis != "hand_set":
        if accepted:
            return "unverified: the file's own page, not the edition's"
        return "unverified: numbering unsettled"
    if basis == "hand_set":
        return "hand set"
    return "verified" if checked else "unchecked"


# lib/page-verified.ts, in Python: the app's mark for an unverified page
# number (docs/PAGE-NUMBERS.md §3) and the two forms a page number takes when
# it leaves the app. The same rule is in lib/works.ts (SQL, for the screen) and
# mcp/numbering.ts; all of them must agree.

def is_unverified(problem, basis) -> bool:
    return problem is not None and basis != "hand_set"


def page_verified(unverified: bool, basis) -> str:
    if unverified:
        return "no"
    if basis == "hand_set":
        return "hand set"
    return "yes"


def page_label(page: int, unverified: bool) -> str:
    return f"{page}*" if unverified else str(page)


def pages_label(pages: str, unverified: bool) -> str:
    """'40' or '40–41' (an en dash; a negative page carries an ASCII minus),
    each number labelled."""
    return "\u2013".join(page_label(int(p), unverified) for p in pages.split("\u2013"))


def work_record(cur, work_id: str) -> dict:
    """The work, or a tool error naming ids that contain what was given."""
    cur.execute(
        "select id, author, title, year, offset_checked_at, offset_problem, notes_internal,"
        " pagination_accepted_at, pagination_basis"
        " from works where id = %s",
        (work_id,),
    )
    row = cur.fetchone()
    if row:
        unverified = is_unverified(row[5], row[8])
        return {
            "id": row[0], "author": row[1], "title": row[2], "year": row[3],
            "checked": row[4] is not None, "problem": row[5], "internal_note": row[6],
            "accepted": row[7] is not None, "basis": row[8],
            "page_numbers": page_numbers(row[4] is not None, row[5], row[7] is not None, row[8]),
            "unverified": unverified,
            "page_verified": page_verified(unverified, row[8]),
        }
    cur.execute("select id from works where id ilike %s order by id limit 10",
                (f"%{work_id}%",))
    hits = [r[0] for r in cur.fetchall()]
    hint = f" Ids containing it: {', '.join(hits)}." if hits else " Use find_works."
    raise ToolError(f"{work_id!r} is not a work id.{hint}")


def citable(work: dict) -> str | None:
    """Why this work's pages are not citations, or None if they are. An
    accepted work is citable whatever offset_problem says: acceptance is the
    decision, the problem is the evidence it was made on."""
    if work["problem"] and not work["accepted"]:
        return f"page numbering unsettled: {work['problem']}"
    if not work["checked"]:
        return "page numbering never checked"
    return None


def load_book(cur, work_id: str) -> Book:
    cur.execute(
        "select page_index, printed_page, text from printed_pages"
        " where work_id = %s order by page_index",
        (work_id,),
    )
    pages = [{"index": i, "printed": p, "text": t} for i, p, t in cur.fetchall()]
    if not pages:
        raise ToolError(f"{work_id}: no pages loaded")
    return Book(pages)


def anchors_for(cur, note_ids: list[int]) -> dict[int, list[dict]]:
    """The quotations anchored to these notes, in order, each page carried as
    the app shows it (mcp/anchors.ts does the same)."""
    if not note_ids:
        return {}
    cur.execute(
        "select a.note_id, a.work_id, a.printed_page, a.quote, w.offset_problem, w.pagination_basis"
        " from note_anchors a join works w on w.id = a.work_id"
        " where a.note_id = any(%s) order by a.note_id, a.ordinal",
        (note_ids,),
    )
    out: dict[int, list[dict]] = {}
    for note_id, work_id, page, quote, problem, basis in cur.fetchall():
        unverified = is_unverified(problem, basis)
        out.setdefault(note_id, []).append({
            "work_id": work_id,
            "page": page,
            "page_label": None if page is None else page_label(page, unverified),
            "page_verified": "" if page is None else page_verified(unverified, basis),
            "quote": quote,
        })
    return out


# --------------------------------------------------------------------------
# Read tools

@mcp.tool()
def find_works(query: str) -> dict:
    """Works whose id, author or title contains the query, accents and case
    ignored. Returns full ids, whether pages and search chunks are loaded, the
    state of the page numbering, and the work's internal note, which records
    known problems with its file (a partial copy, ebook pagination)."""
    needle = fold(query).strip()
    if not needle:
        raise ToolError("give part of an author, title or id")
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select w.id, w.author, w.title, w.year, w.offset_checked_at, w.offset_problem,
                   w.notes_internal,
                   w.pagination_accepted_at, w.pagination_basis,
                   exists (select 1 from pages p where p.work_id = w.id),
                   exists (select 1 from chunks c where c.work_id = w.id
                           and c.embedding is not null)
            from works w order by w.author nulls last, w.title
            """
        )
        rows = cur.fetchall()
    works = [
        {
            "id": r[0], "author": r[1], "title": r[2], "year": r[3],
            "numbering": numbering(r[4], r[5], r[7], r[8]),
            "page_numbers": page_numbers(r[4] is not None, r[5], r[7] is not None, r[8]),
            "page_verified": page_verified(is_unverified(r[5], r[8]), r[8]),
            "internal_note": r[6],
            "has_pages": r[9], "searchable": r[10],
        }
        for r in rows
        if needle in fold(r[0]) or needle in fold(r[1] or "") or needle in fold(r[2] or "")
    ]
    return {"count": len(works), "works": works[:MAX_WORKS_LISTED]}


@mcp.tool()
def search(
    query: str,
    work_ids: list[str] | None = None,
    lang: str | None = None,
    k: int = 8,
    include_front_matter: bool = False,
) -> dict:
    """Semantic search over the corpus, in English or Spanish; a query in one
    language finds text in the other. Optionally limited to works (full ids)
    or to one language ('english' or 'spanish'). Front matter is excluded
    unless asked for. Each result gives the work, printed pages, similarity
    (1 is identical), the chunk's text, and page_numbers: how far the pages
    can be trusted ('verified', 'hand set', 'unverified', 'unchecked')."""
    if lang not in (None, "english", "spanish"):
        raise ToolError("lang is 'english', 'spanish' or omitted")
    k = max(1, min(k, MAX_SEARCH_RESULTS))

    with connect() as conn, conn.cursor() as cur:
        for work_id in work_ids or []:
            work_record(cur, work_id)
        try:
            vector = embed_query(query, DEFAULT_MODEL, DEFAULT_DIM)
        except SystemExit as exc:
            raise ToolError(str(exc)) from None

        where = ["c.embedding is not null"]
        params: dict = {"vec": str(vector), "k": k}
        if not include_front_matter:
            where.append("c.section_type is distinct from 'front'")
        if work_ids:
            where.append("c.work_id = any(%(works)s)")
            params["works"] = work_ids
        if lang:
            where.append("c.lang = %(lang)s")
            params["lang"] = lang
        cur.execute(
            f"""
            select c.work_id, w.author, w.title, c.start_page, c.end_page, c.lang,
                   1 - (c.embedding <=> %(vec)s::vector) as score, c.text,
                   w.offset_checked_at, w.offset_problem,
                   w.pagination_accepted_at, w.pagination_basis
            from chunks c join works w on w.id = c.work_id
            where {' and '.join(where)}
            order by c.embedding <=> %(vec)s::vector
            limit %(k)s
            """,
            params,
        )
        rows = cur.fetchall()

    results = []
    for r in rows:
        unverified = is_unverified(r[9], r[11])
        pages = str(r[3]) if r[3] == r[4] else f"{r[3]}\u2013{r[4]}"
        results.append({
            "work_id": r[0], "author": r[1], "title": r[2],
            "pages": pages,
            "pages_label": pages_label(pages, unverified),
            "page_verified": page_verified(unverified, r[11]),
            "lang": r[5], "score": round(float(r[6]), 3),
            "numbering": numbering(r[8], r[9], r[10], r[11]),
            "page_numbers": page_numbers(r[8] is not None, r[9], r[10] is not None, r[11]),
            "text": r[7],
        })
    return {"query": query, "results": results}


@mcp.tool()
def read_pages(work_id: str, first_page: int, last_page: int | None = None) -> dict:
    """Page text by printed page number, at most ten pages per call. Each page
    says how sure its number is: 'printed' where the number read off the page
    agrees, 'computed' where the page carries no readable number and it comes
    from the book's offset alone, 'front matter' below page 1, and a warning
    where the number read off the page disagrees. page_numbers says how far
    the work's numbering can be trusted: 'verified', 'hand set' (reviewed by a
    person), 'unverified' (the file's own page, not the edition's), or
    'unchecked'."""
    last_page = first_page if last_page is None else last_page
    if last_page < first_page:
        raise ToolError("last_page comes before first_page")
    if last_page - first_page + 1 > MAX_PAGES_PER_READ:
        raise ToolError(f"at most {MAX_PAGES_PER_READ} pages per call")

    with connect() as conn, conn.cursor() as cur:
        work = work_record(cur, work_id)
        cur.execute(
            "select page_index, printed_page, folio, text from printed_pages"
            " where work_id = %s and printed_page between %s and %s order by page_index",
            (work_id, first_page, last_page),
        )
        rows = cur.fetchall()

    if not rows:
        raise ToolError(f"{work_id}: no loaded pages printed {first_page}\u2013{last_page}")

    pages = []
    for index, printed, folio, text in rows:
        if printed < FIRST_CITABLE_PAGE:
            status = "front matter"
        elif folio is None:
            status = "computed"
        elif folio == printed:
            status = "printed"
        else:
            status = f"warning: the page reads {folio}"
        pages.append({
            "page": printed, "page_label": page_label(printed, work["unverified"]),
            "file_page": index, "number": status, "text": text,
        })

    reason = citable(work)
    return {
        "work_id": work_id,
        "title": work["title"],
        "citable": reason is None,
        "not_citable_because": reason,
        "page_numbers": work["page_numbers"],
        "page_verified": work["page_verified"],
        "internal_note": work["internal_note"],
        "pages": pages,
    }


@mcp.tool()
def find_quotation(work_id: str, text: str, near_page: int | None = None) -> dict:
    """Look a passage up in a work's page text with the same matcher draft_note
    uses. Returns the book's own text at the match, the printed page, and
    whether the match was exact or close, and page_numbers, as read_pages
    gives it. Use it to check a quotation before drafting."""
    with connect() as conn, conn.cursor() as cur:
        work = work_record(cur, work_id)
        book = load_book(cur, work_id)
    if len(normalize(text)) < MIN_QUOTE_CHARS:
        raise ToolError(f"a quotation needs at least {MIN_QUOTE_CHARS} characters to prove anything")
    hit = book.find(text, near_page, [])
    reason = citable(work)
    if not hit:
        return {"found": False, "work_id": work_id}
    return {
        "found": True, "work_id": work_id,
        "text": hit["text"], "page": hit["page"], "pages": hit["pages"],
        "page_label": page_label(hit["page"], work["unverified"]),
        "pages_label": pages_label(hit["pages"], work["unverified"]),
        "page_verified": work["page_verified"],
        "match": hit["match"],
        "front_matter": hit["page"] < FIRST_CITABLE_PAGE,
        "citable": reason is None, "not_citable_because": reason,
        "page_numbers": work["page_numbers"],
    }


@mcp.tool()
def get_study_aid(work_id: str) -> dict:
    """A work's dossier: summary, key arguments, key terms and theme bridges.
    Each section says whether she has reviewed it. Unreviewed sections are the
    assistant's drafts and are not her views."""
    with connect() as conn, conn.cursor() as cur:
        work_record(cur, work_id)
        cur.execute(
            "select kind, body, reviewed, model, generated_at from dossier_sections"
            " where work_id = %s order by kind",
            (work_id,),
        )
        rows = cur.fetchall()
    if not rows:
        return {"work_id": work_id, "sections": [], "note": "no dossier loaded for this work"}
    sections = []
    for kind, body, reviewed, model, generated in rows:
        try:
            parsed = json.loads(body) if isinstance(body, str) else body
        except json.JSONDecodeError:
            parsed = body
        sections.append({
            "kind": kind, "reviewed": reviewed, "model": model,
            "generated_at": generated.isoformat() if generated else None, "body": parsed,
        })
    return {"work_id": work_id, "sections": sections}


@mcp.tool()
def list_claims(work_id: str) -> dict:
    """The dossier claims about a work that she has accepted, each with its
    verified quotations and printed pages. Claims still awaiting her review,
    and those she rejected, are left out."""
    with connect() as conn, conn.cursor() as cur:
        work_record(cur, work_id)
        cur.execute(
            """
            select n.id, n.body, n.tags from notes n
            where 'dossier' = any(n.tags) and n.reviewed and n.rejected_at is null
              and exists (select 1 from note_anchors a
                          where a.note_id = n.id and a.work_id = %s)
            order by n.id
            """,
            (work_id,),
        )
        rows = cur.fetchall()
        anchors = anchors_for(cur, [r[0] for r in rows])
    return {
        "work_id": work_id,
        "claims": [
            {"id": r[0], "claim": r[1], "tags": r[2], "quotations": anchors.get(r[0], [])}
            for r in rows
        ],
    }


@mcp.tool()
def list_notes(
    work_id: str | None = None,
    tag: str | None = None,
    contains: str | None = None,
) -> dict:
    """Her notes, filtered by a work (full id), a tag, or text in the title or
    body. Rejected proposals and unreviewed dossier claims are left out, as in
    the app. Each note says who wrote it (origin) and whether she has reviewed
    it; an unreviewed assistant note is a pending proposal, not her writing."""
    if not (work_id or tag or contains):
        raise ToolError("filter by work_id, tag or contains")
    where = [
        "n.rejected_at is null",
        "not ('dossier' = any(n.tags) and n.reviewed = false)",
    ]
    params: dict = {"limit": MAX_NOTES_LISTED}
    with connect() as conn, conn.cursor() as cur:
        if work_id:
            work_record(cur, work_id)
            where.append(
                "(exists (select 1 from note_anchors a where a.note_id = n.id and a.work_id = %(work)s)"
                " or exists (select 1 from note_works nw where nw.note_id = n.id and nw.work_id = %(work)s))"
            )
            params["work"] = work_id
        if tag:
            where.append("%(tag)s = any(n.tags)")
            params["tag"] = tag
        if contains:
            where.append("(n.body ilike %(q)s or n.title ilike %(q)s)")
            params["q"] = f"%{contains}%"
        cur.execute(
            f"""
            select n.id, n.kind, n.title, n.body, n.attribution, n.attributed_to,
                   n.origin, n.reviewed, n.tags
            from notes n where {' and '.join(where)}
            order by n.id desc limit %(limit)s
            """,
            params,
        )
        rows = cur.fetchall()
        anchors = anchors_for(cur, [r[0] for r in rows])
    return {
        "notes": [
            {
                "id": r[0], "kind": r[1], "title": r[2], "body": r[3],
                "attribution": r[4], "attributed_to": r[5], "origin": r[6],
                "reviewed": r[7], "tags": r[8], "quotations": anchors.get(r[0], []),
            }
            for r in rows
        ],
    }


# --------------------------------------------------------------------------
# The one write

class Quotation(BaseModel):
    work_id: str = Field(description="Full id of the work quoted")
    text: str = Field(description="Copied exactly from the page, at least 25 characters")
    near_page: int | None = Field(default=None, description="Printed page where it appears, if known")


@mcp.tool()
def draft_note(
    body: str,
    quotations: list[Quotation],
    attribution: str | None = None,
    attributed_to: str | None = None,
    title: str | None = None,
    tags: list[str] | None = None,
) -> dict:
    """Propose a note for her review, anchored to one or more verified
    quotations. Every quotation is looked up in its book; if any is not found,
    is on front matter, or comes from a work whose page numbering is not
    settled, nothing is written. What is stored is the book's own text and the
    page where it was found. attribution: 'author' when the note reports the
    anchored work's own position, 'other' with attributed_to for a third
    party, empty for your own analysis. The note waits in her proposals queue
    until she accepts or rejects it."""
    body = (body or "").strip()
    if not body:
        raise ToolError("the note needs a body")
    if not quotations:
        raise ToolError("a note needs at least one quotation")
    if attribution == "own":
        raise ToolError("'own' is hers to assign; leave attribution empty for your own analysis")
    if attribution not in (None, "author", "other"):
        raise ToolError("attribution is 'author', 'other' or empty")
    if attributed_to and attribution != "other":
        raise ToolError("attributed_to goes only with attribution 'other'")
    if attribution == "other" and not (attributed_to or "").strip():
        raise ToolError("attribution 'other' needs attributed_to")
    tags = [t.strip() for t in (tags or []) if t and t.strip()]
    if "dossier" in tags:
        raise ToolError("the 'dossier' tag is reserved for dossier.py's claims")

    verified: list[dict] = []
    failures: list[str] = []
    with connect() as conn:
        with conn.cursor() as cur:
            books: dict[str, Book] = {}
            for n, q in enumerate(quotations, start=1):
                work = work_record(cur, q.work_id)
                reason = citable(work)
                if reason:
                    failures.append(f"quotation {n} ({q.work_id}): {reason}")
                    continue
                if len(normalize(q.text)) < MIN_QUOTE_CHARS:
                    failures.append(f"quotation {n}: shorter than {MIN_QUOTE_CHARS} characters")
                    continue
                if q.work_id not in books:
                    books[q.work_id] = load_book(cur, q.work_id)
                hit = books[q.work_id].find(q.text, q.near_page, [])
                if not hit:
                    failures.append(f"quotation {n} ({q.work_id}): not found in the page text")
                    continue
                if hit["page"] < FIRST_CITABLE_PAGE:
                    failures.append(f"quotation {n} ({q.work_id}): on front matter, printed page {hit['page']}")
                    continue
                verified.append({
                    "work_id": q.work_id, **hit,
                    "unverified": work["unverified"], "page_verified": work["page_verified"],
                })

        if failures:
            raise ToolError("nothing written:\n" + "\n".join(failures))

        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into notes (kind, title, body, attribution, attributed_to,
                                       tags, origin, reviewed)
                    values ('note', %s, %s, %s, %s, %s, 'assistant', false)
                    returning id
                    """,
                    ((title or "").strip() or None, body, attribution,
                     (attributed_to or "").strip() or None, tags),
                )
                note_id = cur.fetchone()[0]
                cur.executemany(
                    """
                    insert into note_anchors (note_id, ordinal, work_id, printed_page, quote)
                    values (%s, %s, %s, %s, %s)
                    """,
                    [(note_id, n, v["work_id"], v["page"], v["text"])
                     for n, v in enumerate(verified, start=1)],
                )

    return {
        "note_id": note_id,
        "status": "proposal awaiting her review",
        "attribution": attribution,
        "quotations": [
            {
                "work_id": v["work_id"], "pages": v["pages"],
                "pages_label": pages_label(v["pages"], v["unverified"]),
                "page_verified": v["page_verified"],
                "match": v["match"], "stored": v["text"],
            }
            for v in verified
        ],
    }


if __name__ == "__main__":
    mcp.run()
