// Chicago 17th edition, formatted from one book record.
//
// The point of this file is that a citation is generated from the catalogue
// rather than retyped, so a correction to a book record propagates everywhere
// at once. Citation accuracy is a stated priority in her own practice, which is
// why these functions report what is missing instead of filling a gap with
// something plausible.
//
// Known limits, all deliberate:
//
//   - One author field. Multiple authors are stored as she typed them and are
//     emitted unchanged in the bibliography form; the note form inverts only a
//     single "Last, First".
//   - Translator and editor are emitted in that order. Chicago follows the
//     title page, so a volume that lists the editor first needs the two swapped
//     by hand.
//   - Nothing is abbreviated to n.p. or n.d. A missing publisher is reported as
//     missing, not papered over.

import type { Book } from '@/lib/types';

export interface Citation {
  text: string;
  missing: string[];
}

// "Anzaldúa, Gloria" -> "Gloria Anzaldúa". Names with no comma pass through, as
// do corporate authors and anything with more than one comma, where guessing
// would do more harm than leaving it alone.
export function uninvert(name: string): string {
  const parts = name.split(',');
  if (parts.length !== 2) return name.trim();
  const [last, first] = parts.map((p) => p.trim());
  if (!first) return last;
  return `${first} ${last}`;
}

function fullTitle(book: Book): string {
  return book.subtitle ? `${book.title}: ${book.subtitle}` : book.title;
}

function missingFields(book: Book): string[] {
  const missing: string[] = [];
  if (!book.author && !book.editor) missing.push('author');
  if (!book.publisher) missing.push('publisher');
  if (!book.place) missing.push('place');
  if (book.year === null) missing.push('year');
  return missing;
}

// Bibliography entry:
//   Last, First. Title: Subtitle. Translated by X. Edited by Y. 2nd ed.
//   Place: Publisher, Year.
//
// Title is returned in Markdown italics, since every surface that renders these
// already renders Markdown. Strip the asterisks for a plain-text export.
export function formatBibliography(book: Book): Citation {
  const segments: string[] = [];

  if (book.author) {
    segments.push(`${book.author.trim()}.`);
  } else if (book.editor) {
    segments.push(`${book.editor.trim()}, ed.`);
  }

  segments.push(`*${fullTitle(book)}*.`);

  if (book.translator) segments.push(`Translated by ${uninvert(book.translator)}.`);
  if (book.editor && book.author) segments.push(`Edited by ${uninvert(book.editor)}.`);
  if (book.edition) segments.push(`${book.edition.trim()}.`);

  const imprint = formatImprint(book);
  if (imprint) segments.push(`${imprint}.`);

  return { text: segments.join(' '), missing: missingFields(book) };
}

// Note form, for a footnote:
//   First Last, Title: Subtitle, trans. X (Place: Publisher, Year), 45.
export function formatNote(book: Book, page?: number | null): Citation {
  const segments: string[] = [];

  if (book.author) {
    segments.push(uninvert(book.author));
  } else if (book.editor) {
    segments.push(`${uninvert(book.editor)}, ed.`);
  }

  segments.push(`*${fullTitle(book)}*`);

  if (book.translator) segments.push(`trans. ${uninvert(book.translator)}`);
  if (book.edition) segments.push(book.edition.trim());

  const imprint = formatImprint(book);
  if (imprint) segments.push(`(${imprint})`);

  const head = segments.join(', ');
  const text = page === null || page === undefined ? `${head}.` : `${head}, ${page}.`;

  return { text, missing: missingFields(book) };
}

// "Place: Publisher, Year", degrading gracefully as pieces go missing rather
// than emitting a stray colon or a dangling comma.
function formatImprint(book: Book): string {
  const place = book.place?.trim();
  const publisher = book.publisher?.trim();
  const year = book.year;

  const house = [place, publisher].filter(Boolean).join(': ');

  if (house && year !== null) return `${house}, ${year}`;
  if (house) return house;
  if (year !== null) return String(year);
  return '';
}

// A note's citation, ready to paste into a draft chapter (N-7). The quotation
// comes first because that is what she is quoting; the citation follows it.
export function formatNoteExport(
  book: Book,
  note: { quote: string | null; body: string; printed_page: number | null; origin: string; reviewed: boolean },
): string {
  const lines: string[] = [];

  if (note.quote) lines.push(`> ${note.quote}`, '');
  lines.push(note.body, '');
  lines.push(formatNote(book, note.printed_page).text);

  // N-6: an export has to say whether she wrote it, edited it, or has not read
  // it yet. Silence here would let an unreviewed draft pass as her own.
  if (note.origin === 'assistant') {
    lines.push(note.reviewed ? '[assistant draft, reviewed]' : '[assistant draft, UNREVIEWED]');
  }

  return lines.join('\n');
}
