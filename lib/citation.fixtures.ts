// Citation fixtures.
//
// The shapes that break formatters, each with the string it should produce. Read
// this once against the style guide; after that a regression is visible instead
// of latent. Run with: npx tsx lib/citation.fixtures.ts
//
// The point is the finish line. She will build a works cited during written
// comps, under time pressure, and will not be proofreading the punctuation of
// eighty entries at 6am.

import { formatBibliography, plain } from '@/lib/citation';
import type { Work } from '@/lib/types';

const BLANK: Omit<Work, 'id' | 'title'> = {
  subtitle: null, author: null, translator: null, editor: null,
  publisher: null, place: null, year: null, edition: null, language: null,
  kind: 'monograph', container_id: null, first_page: null, last_page: null,
  isbn: null, volume: null, series: null, original_year: null,
  url: null, doi: null, accessed: null,
  status: 'unread', purpose: 'unassigned', standing: 'assigned',
  standing_note: null, priority: null, source_format: 'none', source_path: null,
  r2_pages_key: null, page_offset: 0, vivarium_item_id: null,
  notes_internal: null, pagination_accepted_at: null,
  created_at: '', updated_at: '',
};

const work = (over: Partial<Work> & { id: string; title: string }): Work => ({
  ...BLANK,
  ...over,
});

const CASES: {
  name: string;
  work: Work;
  container?: Work;
  chicago: string;
  mla: string;
}[] = [
  {
    name: 'monograph, translated, with an original year',
    work: work({
      id: 'rivera-tierra', title: '…y no se lo tragó la tierra',
      author: 'Rivera, Tomás', translator: 'Vigil-Piñón, Evangelina',
      publisher: 'Arte Público Press', place: 'Houston', year: 1996,
      original_year: 1971,
    }),
    chicago: 'Rivera, Tomás. …y no se lo tragó la tierra. 1971. Translated by Evangelina Vigil-Piñón. Houston: Arte Público Press, 1996.',
    mla: 'Rivera, Tomás. …y no se lo tragó la tierra. Translated by Evangelina Vigil-Piñón, Arte Público Press, 1996.',
  },
  {
    name: 'essay inside a volume, the Freud case',
    work: work({
      id: 'freud-lo-ominoso', title: 'Lo ominoso', kind: 'essay',
      author: 'Freud, Sigmund', container_id: 'freud-obras-completas',
      original_year: 1919, first_page: 215, last_page: 251,
    }),
    container: work({
      id: 'freud-obras-completas', title: 'Obras completas',
      kind: 'edited_volume', translator: 'Etcheverry, José Luis',
      publisher: 'Amorrortu', place: 'Buenos Aires', year: 1979,
      volume: 'vol. 17',
    }),
    chicago: 'Freud, Sigmund. "Lo ominoso." 1919. In Obras completas, translated by José Luis Etcheverry, 215–251. vol. 17. Buenos Aires: Amorrortu, 1979.',
    mla: 'Freud, Sigmund. "Lo ominoso." Obras completas, translated by José Luis Etcheverry, vol. 17, Amorrortu, 1979, pp. 215–251.',
  },
  {
    name: 'edited collection cited whole',
    work: work({
      id: 'sanjek-fieldnotes', title: 'Fieldnotes',
      subtitle: 'The Makings of Anthropology', kind: 'edited_volume',
      editor: 'Sanjek, Roger', publisher: 'Cornell University Press',
      place: 'Ithaca', year: 1990,
    }),
    chicago: 'Sanjek, Roger, ed. Fieldnotes: The Makings of Anthropology. Ithaca: Cornell University Press, 1990.',
    mla: 'Sanjek, Roger, editor. Fieldnotes: The Makings of Anthropology. Cornell University Press, 1990.',
  },
  {
    name: 'two-volume work with a series',
    work: work({
      id: 'rael-cuentos', title: 'Cuentos españoles de Colorado y Nuevo México',
      editor: 'Rael, Juan B.', publisher: 'Museum of New Mexico Press',
      place: 'Santa Fe', year: 1977, volume: '2 vols.',
    }),
    chicago: 'Rael, Juan B., ed. Cuentos españoles de Colorado y Nuevo México. 2 vols. Santa Fe: Museum of New Mexico Press, 1977.',
    mla: 'Rael, Juan B., editor. Cuentos españoles de Colorado y Nuevo México. 2 vols., Museum of New Mexico Press, 1977.',
  },
  {
    name: 'film — author holds the director',
    work: work({
      id: 'portillo-senorita', title: 'Señorita extraviada', kind: 'film',
      author: 'Portillo, Lourdes', year: 2001,
    }),
    chicago: 'Portillo, Lourdes, dir. Señorita extraviada. 2001.',
    mla: 'Señorita extraviada. Directed by Lourdes Portillo, 2001.',
  },
  {
    name: 'no publisher, no year — the gap must be visible, not filled',
    work: work({ id: 'anaya-ultima', title: 'Bless Me, Ultima', author: 'Anaya, Rudolfo' }),
    chicago: 'Anaya, Rudolfo. Bless Me, Ultima.',
    mla: 'Anaya, Rudolfo. Bless Me, Ultima.',
  },
  {
    name: 'online source with an access date',
    work: work({
      id: 'counter-mapping', title: 'Counter Mapping', kind: 'essay',
      author: 'Emergence Magazine',
      url: 'https://emergencemagazine.org/feature/counter-mapping/',
      accessed: '2026-09-12', year: 2018,
    }),
    chicago: 'Emergence Magazine. "Counter Mapping." 2018. Accessed 2026-09-12. https://emergencemagazine.org/feature/counter-mapping/.',
    mla: 'Emergence Magazine. "Counter Mapping." 2018. https://emergencemagazine.org/feature/counter-mapping/. Accessed 2026-09-12.',
  },
];

let failures = 0;

for (const c of CASES) {
  for (const style of ['chicago', 'mla'] as const) {
    const got = plain(formatBibliography(c.work, c.container ?? null, style).text);
    const want = c[style];
    if (got !== want) {
      failures += 1;
      console.log(`\n✗ ${c.name} [${style}]`);
      console.log(`   want: ${want}`);
      console.log(`   got:  ${got}`);
    }
  }
}

const missing = formatBibliography(
  work({ id: 'x', title: 'Something', author: 'Someone' }),
).missing;
if (!missing.includes('publisher') || !missing.includes('year')) {
  failures += 1;
  console.log('\n✗ missing-field reporting did not flag publisher and year');
}

console.log(
  failures === 0
    ? `\n${CASES.length * 2} citations correct.`
    : `\n${failures} wrong.`,
);
