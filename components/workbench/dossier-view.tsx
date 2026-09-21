import Link from 'next/link';

import type { Dossier, DossierQuote } from '@/lib/dossier';
import { href, type WorkbenchParams } from '@/lib/workbench-url';

// The Dossier tab: a study aid generated from the book's own text by
// pipeline/dossier.py, in the order she would review it: the general argument,
// the key arguments with their quotations, the key concepts, and the
// connections to her dissertation themes. The themes are the assistant's
// proposals and are labelled so, because a bridge repeated in an exam as the
// author's would be a misattribution.
//
// The claims the aid was condensed from are notes, reviewed on the book's
// claims page; the workbench's Claims tab shows the ones she accepted.
//
// Every page shown is a link that opens Preview at that page, so any sentence
// here can be checked against the book in one click.

function PageLinks({ params, pages }: { params: WorkbenchParams; pages?: number[] }) {
  if (!pages || pages.length === 0) return null;
  return (
    <span className="text-xs text-muted">
      {pages.length === 1 ? 'p. ' : 'pp. '}
      {pages.map((page, i) => (
        <span key={page}>
          {i > 0 ? ', ' : ''}
          <Link
            href={href(params, { view: 'preview', p: String(page) })}
            className="hover:text-accent underline-offset-2 hover:underline"
          >
            {page}
          </Link>
        </span>
      ))}
    </span>
  );
}

// Names and numbers the book's text does not contain. Not proof of an error:
// the OCR can mangle a real name past recognition. A reason to open the page.
function Unfound({ terms }: { terms?: string[] }) {
  if (!terms || terms.length === 0) return null;
  return (
    <p
      className="text-xs text-accent"
      title="These names or numbers do not appear anywhere in the book's text. They may have come from outside the book, or the scan may spell them differently. Check the page before relying on them."
    >
      Not found in the book&rsquo;s text: {terms.join(', ')}
    </p>
  );
}

function Quote({
  q,
  params,
  lang,
}: {
  q: DossierQuote;
  params: WorkbenchParams;
  lang: string | undefined;
}) {
  return (
    <blockquote lang={lang} className="reading-sm border-l-2 border-rule pl-3">
      &ldquo;{q.text}&rdquo;{' '}
      <Link
        href={href(params, { view: 'preview', p: String(q.page) })}
        className="whitespace-nowrap text-xs text-muted hover:text-accent hover:underline underline-offset-2"
      >
        p. {q.pages}
      </Link>
      {q.match !== 'exact' ? (
        <span
          className="text-xs text-muted"
          title="The quotation as the model gave it differed slightly from the page, usually a scanning error it corrected. What is shown is the page's own text."
        >
          {' '}· {q.match} match
        </span>
      ) : null}
    </blockquote>
  );
}

export function DossierView({
  dossier,
  params,
  workId,
  language,
}: {
  dossier: Dossier;
  params: WorkbenchParams;
  workId: string;
  language: string | null;
}) {
  const generated = dossier.generated_at
    ? new Date(dossier.generated_at).toLocaleDateString('es-MX', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;
  const lang = language?.split(',')[0]?.trim() || undefined;

  return (
    <div className="space-y-10">
      <p className="border-l-2 border-accent pl-3 text-xs text-muted">
        Study aid generated from the book&rsquo;s own text
        {dossier.model ? ` by ${dossier.model}` : ''}
        {generated ? `, ${generated}` : ''}.
        {dossier.reviewed ? ' Reviewed.' : ' Not yet reviewed.'} Every quotation was
        found in the book and its page is the page it was found on; each page number
        opens that page. The wording around the quotations is the assistant&rsquo;s:
        check it against the passage before relying on it.
      </p>

      <section className="space-y-3">
        <h3 className="text-base">General argument</h3>
        {dossier.summary.map((para, i) => (
          <div key={i} className="space-y-1">
            <p className="reading-sm">{para.text}</p>
            <Unfound terms={para.unfound} />
            <PageLinks params={params} pages={para.pages} />
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <h3 className="text-base">Key arguments</h3>
        <ol className="space-y-6">
          {dossier.keyArguments.map((a, i) => (
            <li key={i} className="space-y-2">
              <h4 className="text-sm">
                <span className="mr-2 text-muted">{i + 1}.</span>
                {a.title}
              </h4>
              <p className="reading-sm">{a.text}</p>
              <Unfound terms={a.unfound} />
              {a.example ? <p className="text-xs text-muted">Ejemplo: {a.example}</p> : null}
              {a.quotes.map((q, j) => (
                <Quote key={j} q={q} params={params} lang={lang} />
              ))}
            </li>
          ))}
        </ol>
      </section>

      {dossier.terms.length > 0 ? (
        <section className="space-y-4">
          <h3 className="text-base">Key concepts</h3>
          <dl className="space-y-4">
            {dossier.terms.map((t, i) => (
              <div key={i} className="space-y-1">
                <dt className="text-sm text-accent">{t.term}</dt>
                <dd className="space-y-2">
                  <p className="reading-sm">{t.definition}</p>
                  <Unfound terms={t.unfound} />
                  <Quote q={t.quote} params={params} lang={lang} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base">Connections to the dissertation themes</h3>
          <p className="text-xs text-accent">
            Proposed by the assistant. These are possible uses of the book&rsquo;s
            arguments, not positions the author takes on these themes.
          </p>
        </div>
        {dossier.themes.map((t) => (
          <div key={t.theme} className="space-y-2">
            <h4 className="text-sm">{t.theme}</h4>
            {t.bridges.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing in the book&rsquo;s arguments bears on this directly.
              </p>
            ) : (
              <ul className="space-y-3">
                {t.bridges.map((b, i) => (
                  <li key={i} className="space-y-1">
                    <p className="reading-sm">{b.text}</p>
                    <Unfound terms={b.unfound} />
                    <PageLinks params={params} pages={b.pages} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      <p className="border-t border-rule pt-4 text-xs text-muted">
        Condensed from the book&rsquo;s claims, each with its passages.{' '}
        <Link href={`/works/${workId}/claims`} className="text-accent hover:underline underline-offset-2">
          Review the claims
        </Link>
        ; the ones you accept appear in the Claims tab.
      </p>
    </div>
  );
}
