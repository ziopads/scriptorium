#!/usr/bin/env python3
"""Parse the reading list document into structured rows.

    pip install python-docx
    python3 pipeline/parse_list.py "$HOME/Desktop/Lists_Zazil Collins_Octubre 2026.docx"

Writes pipeline/list.csv — one row per item, with the department's list,
section, and group preserved, and a stable id derived from author and title.

THE IDS ARE PERMANENT. Notes anchor to them, chunks reference them, and they
appear in URLs. Derived from author surname plus the first five title words,
ASCII-folded. Read them before seeding.

WHY IT READS THE DOCX DIRECTLY RATHER THAN A MARKDOWN CONVERSION
    Converting to markdown first turns italics into asterisks, and the document
    has stray bold markers inside italic spans — "*Cajas de **cartón*" — where
    the styling changed mid-title. A regex over asterisks captures "Cajas de "
    and stops. Thirteen titles were truncated that way, and since an id derives
    from its title, "grande-a-2007" for A través de cien montañas would have
    been permanent and plausible-looking.

    python-docx exposes italic as a property of each run, so the title is the
    first run of consecutive italic runs and no marker parsing is involved.

WHAT DISTINGUISHES OFFICIAL FROM SUPPLEMENTARY
    The "Supplementary" heading, not the numbering. A dozen official entries
    lost their Word auto-numbering and carry hand-typed numbers instead, and
    those numbers are stale — the dissertation list is four out of step after
    deletions. They are deliberately not recorded.
"""

from __future__ import annotations

import csv
import re
import sys
import unicodedata
from pathlib import Path

try:
    from docx import Document
except ImportError:
    sys.exit("python-docx is not installed. Run: pip install python-docx")

PIPELINE = Path(__file__).parent
OUT = PIPELINE / "list.csv"

LISTS = {
    "I. THEORY": ("theory", "I. Theory", True),
    "II. DISSERTATION": ("dissertation", "II. Dissertation", True),
    "III. TEACHING": ("teaching", "III. Teaching", True),
    "WORKING BIBLIOGRAPHY": ("working-bibliography", "Working bibliography", False),
    "WORKING FILMOGRAPHY": ("filmography", "Working filmography", False),
}


def fold(s: str) -> str:
    d = unicodedata.normalize("NFKD", s or "")
    d = "".join(c for c in d if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", d.casefold()).strip("-")


def slug(author: str, title: str, year: str) -> str:
    a = fold(author.split(",")[0])[:22] or "anon"
    t = "-".join([w for w in fold(title).split("-") if w][:5])[:40]
    return f"{a}-{t}{'-' + year if year else ''}".strip("-")


def italic_runs(paragraph) -> list[str]:
    """Consecutive italic runs, joined. A title split across runs by a change of
    styling comes back whole; separate italic spans stay separate, which is what
    distinguishes a work's title from a second work in the same entry."""
    groups: list[str] = []
    current = ""
    for run in paragraph.runs:
        if run.italic:
            current += run.text
        elif current:
            groups.append(current)
            current = ""
    if current:
        groups.append(current)
    return [" ".join(g.split()).strip(" .,;:") for g in groups if g.strip()]


def parse(path: Path) -> list[dict]:
    document = Document(str(path))

    rows: list[dict] = []
    list_id = list_name = None
    examinable = True
    letter = section = ""
    kind = "core"

    for paragraph in document.paragraphs:
        text = " ".join(paragraph.text.split()).strip()
        if not text:
            continue

        style = (paragraph.style.name or "").lower()

        if style.startswith("heading 1") or style.startswith("heading 2") or style == "title":
            upper = text.upper()
            matched = False
            for key, (lid, lname, exam) in LISTS.items():
                if upper.startswith(key):
                    list_id, list_name, examinable = lid, lname, exam
                    letter = section = ""
                    kind = "core"
                    matched = True
                    break
            if not matched and upper.startswith(("I.", "II.", "III.", "WORKING")):
                list_id = None
            continue

        if style.startswith("heading 3") or style.startswith("heading 4"):
            m = re.match(r"^([A-Z])\.\s*(.+)$", text)
            letter, section = (m.group(1), m.group(2)) if m else ("", text)
            kind = "core"
            continue

        if text.lower() == "supplementary":
            letter, section = "", "Supplementary"
            kind = "supplementary"
            continue

        if not list_id:
            continue

        # An item is a list paragraph, or — where Word's numbering was lost — a
        # plain paragraph beginning with a typed number, or a supplementary
        # entry, which is never a list paragraph.
        body = re.sub(r"^\d{1,3}\.\s+", "", text)
        is_item = (
            "list" in style
            or re.match(r"^\d{1,3}\.\s+", text)
            or (kind == "supplementary" and italic_runs(paragraph))
        )
        if not is_item or not body:
            continue

        titles = italic_runs(paragraph)
        title = titles[0] if titles else ""

        if not title:
            quoted = re.search(r'[""]([^""]{3,})[""]|"([^"]{3,})"', body)
            if quoted:
                title = (quoted.group(1) or quoted.group(2)).strip(" .")
            elif ":" in body:
                title = body.split(":")[0].strip()

        if not title:
            print(f"  ! no title: {body[:70]}")
            continue

        author = body.split(".")[0].strip()[:90]
        years = re.findall(r"\b(1[5-9]\d\d|20[0-2]\d)\b", body)

        rows.append({
            "author": author,
            "title": title,
            "year": years[-1] if years else "",
            "isbn": "",
            "list_id": list_id,
            "list": list_name,
            "section": f"{letter}. {section}" if letter else section,
            "section_letter": letter,
            "group": kind,
            "examinable": "yes" if examinable else "no",
            "other_titles": " | ".join(titles[1:]),
            "entry": body,
        })

    seen: set[str] = set()
    for row in rows:
        sid = slug(row["author"], row["title"], row["year"])
        base, n = sid, 2
        while sid in seen:
            sid = f"{base}-{n}"
            n += 1
        seen.add(sid)
        row["id"] = sid

    return rows


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(f"usage: {sys.argv[0]} <reading-list.docx>")

    path = Path(sys.argv[1]).expanduser()
    if not path.exists():
        sys.exit(f"not found: {path}")

    rows = parse(path)
    if not rows:
        sys.exit("nothing parsed — check the heading styles in the document")

    fields = ["id", "author", "title", "year", "isbn", "list_id", "list",
              "section", "section_letter", "group", "examinable",
              "other_titles", "entry"]

    with OUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    counts: dict[tuple[str, str], int] = {}
    for row in rows:
        counts[(row["list"], row["group"])] = counts.get((row["list"], row["group"]), 0) + 1

    print(f"\n  {len(rows)} items\n")
    for (lname, group), n in sorted(counts.items()):
        print(f"    {lname:<24} {group:<14} {n:>3}")

    short = [r for r in rows if len(r["title"]) < 10]
    if short:
        print(f"\n  {len(short)} short titles — confirm these are genuinely short:")
        for r in short:
            print(f"    {r['title']!r:<22} {r['id']}")

    multi = [r for r in rows if r["other_titles"]]
    if multi:
        print(f"\n  {len(multi)} entries name more than one work:")
        for r in multi:
            print(f"    {r['title'][:34]:<34} + {r['other_titles'][:44]}")

    print(f"\n  Wrote {OUT}")


if __name__ == "__main__":
    main()
