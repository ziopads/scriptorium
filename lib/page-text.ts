// Turning a page of extracted text into paragraphs.
//
// pymupdf's text mode gives one line per typeset line and marks no paragraphs,
// so pages.text has a newline at every line ending the printer set. Rendered
// with whitespace-pre-wrap that reads as verse. Reflowing needs the paragraph
// boundaries back, and they were never recorded.
//
// The rule used here is the compositor's own: a paragraph's last line is short,
// because it stops where the sentence stopped rather than at the measure. So a
// line ends a paragraph when it ends in terminal punctuation AND is
// appreciably shorter than the page's typical line. Blank lines, where the
// extractor preserved any, are honoured first.
//
// It gets a paragraph wrong when one happens to end on a full line. That is
// occasional and costs a merged pair; the alternative is the current wall of
// broken lines. The durable fix is to re-extract with pymupdf's block
// structure, which knows where the paragraphs are, and store them — a schema
// change and a re-extraction, worth doing when the other ninety works go
// through.
//
// This runs on the display copy only. pages.text stays verbatim, because it is
// what verify_quotation will be checked against.

export interface Block {
  kind: 'heading' | 'text';
  text: string;
}

// Closing punctuation, including the Spanish and typographic forms.
const TERMINAL = /[.!?…"”»'’)\]]$/u;
const TRAILING_HYPHEN = /[-\u2010\u2011]$/u;

// A last line this much shorter than the page's typical line has stopped early.
const SHORT_LINE = 0.86;

// A short opening line with no closing punctuation is a heading — a chapter
// title, a section rubric, or a running head the extractor failed to catch.
const HEADING_MAX_CHARS = 64;

// A note reference, decoded to Unicode superscript digits by extract.py. Never
// closes a paragraph: "… collaboration worked.¹⁹" ends at the full stop.
const SUPERSCRIPT = /[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+$/u;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Join the lines of one paragraph. A hyphen at a line end is a broken word:
// extract.py already rejoined the lowercase-to-lowercase case, so what reaches
// here is the rest.
function joinLines(lines: string[]): string {
  let out = '';
  for (const line of lines) {
    if (!out) {
      out = line;
    } else if (TRAILING_HYPHEN.test(out)) {
      out = out.replace(TRAILING_HYPHEN, '') + line;
    } else {
      out = `${out} ${line}`;
    }
  }
  return out.replace(/[ \t\u00A0]+/g, ' ').trim();
}

export function toBlocks(text: string): Block[] {
  const out: Block[] = [];
  const chunks = text.split(/\n{2,}/);

  for (const chunk of chunks) {
    const lines = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    // A heading only ever opens a block. Since the extractor started marking
    // paragraphs from the page's geometry, a rubric set on its own line is its
    // own block — "guaman poma, artist" above the prose that follows it — so a
    // one-line block counts, provided it is not the only thing on the page.
    const heading =
      lines[0].length <= HEADING_MAX_CHARS &&
      !TERMINAL.test(lines[0].replace(SUPERSCRIPT, ''));

    if (heading && (lines.length > 1 || chunks.length > 1)) {
      out.push({ kind: 'heading', text: lines[0] });
      lines.shift();
      if (lines.length === 0) continue;
    }

    // Too few lines to say what the measure is; treat the block as one run.
    if (lines.length < 3) {
      if (lines.length) out.push({ kind: 'text', text: joinLines(lines) });
      continue;
    }

    const measure = median(lines.map((l) => l.length));
    let buffer: string[] = [];

    for (const line of lines) {
      buffer.push(line);
      // A note reference sits after the stop, so it is ignored when asking
      // whether the line ends a sentence.
      const closed = line.replace(SUPERSCRIPT, '');
      if (TERMINAL.test(closed) && line.length < measure * SHORT_LINE) {
        out.push({ kind: 'text', text: joinLines(buffer) });
        buffer = [];
      }
    }
    if (buffer.length) out.push({ kind: 'text', text: joinLines(buffer) });
  }

  return out;
}

// works.language is free text in the catalogue. Only the hyphenation
// dictionary depends on it, so a wrong guess costs a worse line break and
// nothing else.
export function htmlLang(language: string | null): string {
  const value = (language ?? '').toLowerCase();
  if (value.startsWith('es') || value.startsWith('span') || value.includes('español')) return 'es';
  if (value.startsWith('fr')) return 'fr';
  if (value.startsWith('de')) return 'de';
  return 'en';
}
