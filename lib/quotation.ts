// Turning a selection on a page into a quotation.
//
// Page text is stored as the extractor produced it: the PDF's own line breaks,
// and words broken across lines with a hyphen. Selecting three lines therefore
// yields something like "conquer-\ning the\nnarrative", which is wrong in a
// quotation she will paste into a chapter, and wrong in the citation the app
// renders.
//
// So the quotation stored on a note is normalized, and the page text on screen
// is left verbatim. The consequence binds the MCP server: verify_quotation
// cannot do a plain position() of the stored quote against pages.text, because
// the stored quote no longer contains the line breaks the page has. It must
// normalize both sides with this same function and compare the results. That is
// the exact-match path; trigram remains the fallback for a quote typed by hand
// with a word wrong.
//
// Joining a hyphen at a line end is a judgement: most are a word broken to fit,
// a few are a real compound that happened to land there. Joining is right far
// more often than not, and a wrong join is visible in the note and fixable by
// editing the quotation.

const SOFT_HYPHEN = /\u00AD/g;
const HYPHEN_AT_LINE_END = /(\p{L})[-\u2010\u2011]\s*\n\s*(\p{L})/gu;
const LINE_BREAK = /\s*\n\s*/g;
const RUN_OF_SPACES = /[ \t\u00A0]+/g;

// Note references, which extract.py decodes to Unicode superscript digits so
// that a page can say it carries note 17. They belong on the page and not in
// a quotation: nobody wants "the collaboration worked.\u00b9\u2079" pasted into a chapter.
const NOTE_REFERENCE = /[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+/g;

export function normalizeQuotation(raw: string): string {
  return raw
    .replace(SOFT_HYPHEN, '')
    .replace(NOTE_REFERENCE, '')
    .replace(HYPHEN_AT_LINE_END, '$1$2')
    .replace(LINE_BREAK, ' ')
    .replace(RUN_OF_SPACES, ' ')
    .trim();
}

// A URL carries the captured passage to the note form. Browsers and Vercel are
// comfortable well past this, but a selection longer than a few paragraphs is
// more likely a slip of the mouse than a quotation, and silently sending 40 kB
// of a chapter through the address bar helps nobody.
export const MAX_QUOTE_CHARS = 4000;
