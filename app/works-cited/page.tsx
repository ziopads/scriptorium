import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';
import { formatBibliography, plain, type Style } from '@/lib/citation';
import { getWork } from '@/lib/works';
import type { Work } from '@/lib/types';

export const dynamic = 'force-dynamic';

// A works cited from works ticked on the catalogue.
//
// Not CSV. A works cited is prose that goes into a chapter; comma-delimited
// columns are the wrong shape. The CSV exports are for data.
//
// The selection arrives as repeated ?id= parameters because the form uses GET,
// so the result is a URL she can bookmark, re-open, or send to her advisor
// without re-ticking a hundred boxes. ?style= switches between Chicago and MLA:
// the record holds a superset of what either needs, so the style is a function.
export default async function WorksCitedPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[]; style?: string }>;
}) {
  await requireAllowedUser();

  const { id, style: rawStyle } = await searchParams;
  const style: Style = rawStyle === 'mla' ? 'mla' : 'chicago';

  const ids = id === undefined ? [] : Array.isArray(id) ? id : [id];
  const found = await Promise.all(ids.map((one) => getWork(one)));
  const works = found.filter((w): w is Work => w !== null);

  // Containers, fetched once for the essays that need them.
  const containerIds = [...new Set(works.map((w) => w.container_id).filter(Boolean))] as string[];
  const containers = new Map(
    (await Promise.all(containerIds.map((c) => getWork(c))))
      .filter((c): c is Work => c !== null)
      .map((c) => [c.id, c]),
  );

  // Chicago and MLA both alphabetise by the author's surname, and the records
  // already store the inverted form, so sorting the stored string is correct.
  works.sort((a, b) =>
    (a.author ?? a.editor ?? a.title).localeCompare(b.author ?? b.editor ?? b.title, 'es'),
  );

  const entries = works.map((work) => ({
    work,
    citation: formatBibliography(
      work,
      work.container_id ? containers.get(work.container_id) ?? null : null,
      style,
    ),
  }));

  const incomplete = entries.filter((e) => e.citation.missing.length > 0);
  const text = entries.map((e) => plain(e.citation.text)).join('\n\n');
  const other: Style = style === 'chicago' ? 'mla' : 'chicago';
  const otherHref = `/works-cited?${ids.map((i) => `id=${encodeURIComponent(i)}`).join('&')}&style=${other}`;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl">Works cited</h1>
        <p className="text-sm text-muted">
          {works.length} {works.length === 1 ? 'entry' : 'entries'} ·{' '}
          {style === 'chicago' ? 'Chicago 17th' : 'MLA 9th'} · sorted by author ·{' '}
          <Link href={otherHref} className="text-accent hover:underline">
            switch to {other === 'chicago' ? 'Chicago' : 'MLA'}
          </Link>
        </p>
      </header>

      {works.length === 0 ? (
        <p className="text-sm">
          Nothing selected.{' '}
          <Link href="/works" className="text-accent underline underline-offset-2">
            Choose works on the catalogue
          </Link>{' '}
          and submit.
        </p>
      ) : (
        <>
          {incomplete.length > 0 ? (
            <div className="border-l-2 border-accent pl-3 text-sm">
              <p className="text-accent">
                {incomplete.length}{' '}
                {incomplete.length === 1 ? 'entry is' : 'entries are'} incomplete.
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {incomplete.map((entry) => (
                  <li key={entry.work.id}>
                    <Link href={`/works/${entry.work.id}/edit`} className="hover:text-accent">
                      {entry.work.title}
                    </Link>{' '}
                    — missing {entry.citation.missing.join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ol className="space-y-3 text-sm">
            {entries.map((entry) => (
              <li key={entry.work.id} className="border-l-2 border-rule pl-6 -indent-3">
                {plain(entry.citation.text)}
              </li>
            ))}
          </ol>

          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted">
              Plain text — select all and copy
            </p>
            <textarea
              readOnly
              rows={Math.min(24, entries.length * 3 + 2)}
              value={text}
              className="font-mono text-xs"
            />
          </div>
        </>
      )}
    </div>
  );
}
