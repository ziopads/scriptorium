// Citation, formatted from the record.
//
// Which style the department wants is a formatting decision and can change. What
// cannot be recovered on the morning of an exam is a field nobody recorded — so
// the record holds a superset, and each style is a function over it.
//
// An essay cites through two records: title, original year, page range and any
// essay-level translator from the child; volume title, editors, translator,
// edition and imprint from the container. Hence (work, container) on every
// formatter rather than (work).
//
// Nothing is invented. A missing publisher is reported as missing rather than
// rendered n.p., because a plausible-looking guess is worse than a visible gap.

import type { Work, WorkWithContainer } from '@/lib/types';

export type Style = 'chicago' | 'mla';

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
  return first ? `${first} ${last}` : last;
}

function fullTitle(work: Work): string {
  return work.subtitle ? `${work.title}: ${work.subtitle}` : work.title;
}

// Kinds whose titles are quoted rather than italicised: a part of something,
// whether or not the something is recorded. "Counter Mapping" is an essay with
// no container — a web feature — and both styles still quote it. Keying this off
// container presence rather than kind put it in italics.
const QUOTED: ReadonlySet<string> = new Set(['essay', 'chapter', 'poem']);

// The terminator goes INSIDE the closing quotation mark, which is why it is a
// parameter rather than something the caller appends: "Lo ominoso." and not
// "Lo ominoso". Both styles agree on this and it is the sort of thing a reader
// notices immediately.
function titleOf(work: Work, end = ''): string {
  const title = fullTitle(work);
  return QUOTED.has(work.kind) ? `"${title}${end}"` : `*${title}*${end}`;
}

// Append a full stop unless the value already ends in one. Several fields
// arrive pre-terminated — "2 vols.", "2.ª ed.", "1a ed." — and blindly adding a
// period produced "2 vols.." in the fixtures.
function stop(value: string): string {
  return /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
}

// The same, for MLA's comma-separated positions. Only a trailing comma is
// removed: the period in "2 vols." is part of the abbreviation and MLA prints
// "2 vols.,". Stripping it gave "2 vols,".
function comma(value: string): string {
  return `${value.trim().replace(/,$/, '')},`;
}

function pages(work: Work): string | null {
  if (work.first_page === null) return null;
  return work.last_page === null
    ? `${work.first_page}`
    : `${work.first_page}–${work.last_page}`;
}

// The record a citation's imprint comes from: an essay borrows its container's.
function imprintOf(work: Work, container: Work | null): Work {
  return container ?? work;
}

function missingFields(work: Work, container: Work | null): string[] {
  const im = imprintOf(work, container);
  const missing: string[] = [];
  if (!work.author && !work.editor && !im.editor) missing.push('author');
  if (work.kind !== 'film') {
    if (!im.publisher) missing.push('publisher');
    if (im.year === null) missing.push('year');
  }
  if (work.url && !work.accessed) missing.push('access date');
  return missing;
}

function imprint(work: Work, container: Work | null, style: Style): string {
  const im = imprintOf(work, container);
  const place = im.place?.trim();
  const publisher = im.publisher?.trim();
  const year = im.year;

  // Chicago prints place; MLA dropped it in the 8th edition.
  const house =
    style === 'chicago' && place && publisher
      ? `${place}: ${publisher}`
      : publisher || (style === 'chicago' ? place ?? '' : '');

  if (house && year !== null) {
    return style === 'chicago' ? `${house}, ${year}` : `${house}, ${year}`;
  }
  if (house) return house;
  return year === null ? '' : String(year);
}

// Chicago 17th, bibliography form. Titles come back in Markdown italics; strip
// the asterisks for plain text.
function chicago(work: Work, container: Work | null): string {
  const parts: string[] = [];

  if (work.kind === 'film') {
    if (work.author) parts.push(`${work.author.trim()}, dir.`);
    parts.push(`*${fullTitle(work)}*.`);
    if (work.year !== null) parts.push(`${work.year}.`);
    return parts.join(' ');
  }

  if (work.author) parts.push(stop(work.author));
  else if (work.editor) parts.push(`${work.editor.trim()}, ed.`);

  if (container) {
    parts.push(titleOf(work, '.'));
    if (work.original_year !== null) parts.push(`${work.original_year}.`);
    parts.push(`In *${fullTitle(container)}*,`);
    if (container.editor) parts.push(`edited by ${uninvert(container.editor)},`);
    if (container.translator) parts.push(`translated by ${uninvert(container.translator)},`);
    const span = pages(work);
    if (span) parts.push(`${span}.`);
    if (container.volume) parts.push(stop(container.volume));
  } else {
    parts.push(titleOf(work, '.'));
    if (work.original_year !== null) parts.push(`${work.original_year}.`);
    if (work.translator) parts.push(`Translated by ${uninvert(work.translator)}.`);
    if (work.editor && work.author) parts.push(`Edited by ${uninvert(work.editor)}.`);
    if (work.edition) parts.push(stop(work.edition));
    if (work.volume) parts.push(stop(work.volume));
    if (work.series) parts.push(stop(work.series));
  }

  const house = imprint(work, container, 'chicago');
  if (house) parts.push(`${house}.`);
  if (work.url) {
    parts.push(work.accessed ? `Accessed ${work.accessed}. ${work.url}.` : `${work.url}.`);
  }

  return parts.join(' ');
}

// MLA 9th, works-cited form. Container title after the essay title, contributors
// after that, no place of publication.
function mla(work: Work, container: Work | null): string {
  const parts: string[] = [];

  if (work.kind === 'film') {
    parts.push(`*${fullTitle(work)}*.`);
    if (work.author) parts.push(`Directed by ${uninvert(work.author)},`);
    if (work.year !== null) parts.push(`${work.year}.`);
    return parts.join(' ');
  }

  if (work.author) parts.push(stop(work.author));
  else if (work.editor) parts.push(`${work.editor.trim()}, editor.`);

  if (container) {
    parts.push(titleOf(work, '.'));
    parts.push(`*${fullTitle(container)}*,`);
    if (container.editor) parts.push(`edited by ${uninvert(container.editor)},`);
    if (container.translator) parts.push(`translated by ${uninvert(container.translator)},`);
    if (container.edition) parts.push(comma(container.edition));
    if (container.volume) parts.push(comma(container.volume));
  } else {
    parts.push(titleOf(work, '.'));
    if (work.translator) parts.push(`Translated by ${uninvert(work.translator)},`);
    if (work.editor && work.author) parts.push(`edited by ${uninvert(work.editor)},`);
    if (work.edition) parts.push(comma(work.edition));
    if (work.volume) parts.push(comma(work.volume));
  }

  const house = imprint(work, container, 'mla');
  if (house) parts.push(`${house},`);

  const span = pages(work);
  if (container && span) parts.push(`pp. ${span},`);

  let text = parts.join(' ').replace(/,$/, '.');
  if (work.url) {
    text += ` ${work.url}.`;
    if (work.accessed) text += ` Accessed ${work.accessed}.`;
  }
  return text;
}

export function formatBibliography(
  work: Work,
  container: Work | null = null,
  style: Style = 'chicago',
): Citation {
  return {
    text: style === 'mla' ? mla(work, container) : chicago(work, container),
    missing: missingFields(work, container),
  };
}

// Note form, for a footnote. Chicago only — MLA uses parenthetical citation,
// which is a different thing and belongs with the passage, not here.
export function formatNote(
  work: Work,
  container: Work | null = null,
  page?: number | null,
): Citation {
  const parts: string[] = [];

  if (work.author) parts.push(uninvert(work.author));
  else if (work.editor) parts.push(`${uninvert(work.editor)}, ed.`);

  if (container) {
    parts.push(`${titleOf(work, ',')} in *${fullTitle(container)}*`);
    if (container.translator) parts.push(`trans. ${uninvert(container.translator)}`);
  } else {
    parts.push(titleOf(work));
    if (work.translator) parts.push(`trans. ${uninvert(work.translator)}`);
    if (work.edition) parts.push(work.edition.trim());
  }

  const house = imprint(work, container, 'chicago');
  if (house) parts.push(`(${house})`);

  const head = parts.join(', ');
  return {
    text: page === null || page === undefined ? `${head}.` : `${head}, ${page}.`,
    missing: missingFields(work, container),
  };
}

export function plain(text: string): string {
  return text.replaceAll('*', '');
}

// Convenience for a work already carrying its container.
export function citeWork(
  work: WorkWithContainer,
  style: Style = 'chicago',
): Citation {
  return formatBibliography(work, work.container, style);
}
