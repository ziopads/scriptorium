'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { htmlLang, toBlocks } from '@/lib/page-text';
import type { PageBounds, PageText } from '@/lib/pages';
import { MAX_QUOTE_CHARS, normalizeQuotation } from '@/lib/quotation';
import { href, type WorkbenchParams } from '@/lib/workbench-url';

// One page of the book, with the means to get off it quickly and the means to
// turn a passage into a quotation.
//
// A selection that crossed a page break would have no single folio, which is
// the thing this is here to supply, so the pane shows one page at a time. The
// ways off it: left and right arrow keys, the two chevrons, a folio typed into
// the field, and the scrubber for crossing a long book in one drag. The
// scrubber moves a local number while dragging and navigates once on release,
// because navigating per pixel would be a server round trip per pixel.
//
// The text is reflowed into paragraphs for reading (lib/page-text.ts) while
// pages.text stays verbatim in the database, which is what verify_quotation
// will be checked against.
//
// The capture button normally lives beside the Quotation field in the note
// form, where she is about to type. It only appears here when the note pane is
// collapsed and there is therefore nowhere else for it to be.
//
// basePath puts the viewer outside the workbench, on the book page's Preview
// tab: page turns go to basePath?p=N, and capture is offered only as a link
// to the same page in the workbench, where the note form is.
//
// page is null where the number is inside the book's range but no page in the
// file carries it (a blank the scan left out, a plate, a missing leaf). The
// controls stay, so she can turn to another page, and no text is shown, so nothing can
// be captured under a number that has no page behind it.

export function PageView({
  params,
  page,
  printedPage,
  missing = null,
  bounds,
  language,
  offsetWrong = false,
  basePath,
}: {
  params: WorkbenchParams;
  page: PageText | null;
  printedPage: number;
  missing?: { before: number | null; after: number | null } | null;
  bounds: PageBounds;
  language: string | null;
  offsetWrong?: boolean;
  basePath?: string;
}) {
  const router = useRouter();
  const [selection, setSelection] = useState('');
  const [scrub, setScrub] = useState<number | null>(null);
  const [folioField, setFolioField] = useState(String(printedPage));

  const text = page?.text ?? null;
  const blocks = useMemo(() => (text === null ? [] : toBlocks(text)), [text]);
  const lang = htmlLang(language);
  const paneHidden = !basePath && params.r === '0';

  useEffect(() => {
    setFolioField(String(printedPage));
    setScrub(null);
  }, [printedPage]);

  const go = useCallback(
    (to: number, patch: Record<string, string | null> = {}) => {
      const clamped = Math.min(Math.max(to, bounds.first), bounds.last);
      router.push(
        basePath ? `${basePath}?p=${clamped}` : href(params, { p: String(clamped), ...patch }),
      );
    },
    [basePath, bounds.first, bounds.last, params, router],
  );

  // Watched only to know whether to offer the fallback button below; the
  // capture itself is the note form's business.
  useEffect(() => {
    if (!paneHidden) return;
    function onSelectionChange() {
      const body = document.getElementById('preview-body');
      const sel = document.getSelection();
      if (!body || !sel || sel.isCollapsed) return setSelection('');
      if (!body.contains(sel.anchorNode) || !body.contains(sel.focusNode)) return setSelection('');
      setSelection(normalizeQuotation(sel.toString()));
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [paneHidden]);

  // Left and right turn the page. Guarded so they still move the caret inside
  // a field, and so the left pane's own arrow handling (up and down) is
  // untouched.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === 'ArrowRight' && printedPage < bounds.last) {
        e.preventDefault();
        go(printedPage + 1);
      } else if (e.key === 'ArrowLeft' && printedPage > bounds.first) {
        e.preventDefault();
        go(printedPage - 1);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bounds.first, bounds.last, go, printedPage]);

  const shown = scrub ?? printedPage;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => go(printedPage - 1)}
            disabled={printedPage <= bounds.first}
            className="px-1 text-base leading-none hover:text-accent disabled:opacity-30"
            aria-label="Previous page"
          >
            ‹
          </button>
          <input
            type="number"
            value={folioField}
            onChange={(e) => setFolioField(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const n = Number.parseInt(folioField, 10);
              if (!Number.isNaN(n)) go(n);
            }}
            onBlur={() => setFolioField(String(printedPage))}
            className="w-16! text-center"
            aria-label="Go to printed page"
          />
          <button
            type="button"
            onClick={() => go(printedPage + 1)}
            disabled={printedPage >= bounds.last}
            className="px-1 text-base leading-none hover:text-accent disabled:opacity-30"
            aria-label="Next page"
          >
            ›
          </button>
        </span>

        <span>
          of {bounds.first}–{bounds.last}
          <span className="pl-2">({bounds.count} pages held)</span>
        </span>

        {offsetWrong ? (
          <span
            className="text-accent"
            title="Most of this work's folios disagree with page_index + the offset"
          >
            the offset for this work looks wrong
          </span>
        ) : null}
      </div>

      <input
        type="range"
        className="scrubber"
        min={bounds.first}
        max={bounds.last}
        value={shown}
        onChange={(e) => setScrub(Number.parseInt(e.target.value, 10))}
        onMouseUp={() => scrub !== null && go(scrub)}
        onTouchEnd={() => scrub !== null && go(scrub)}
        onKeyUp={() => scrub !== null && go(scrub)}
        aria-label={`Page ${shown} of ${bounds.first} to ${bounds.last}`}
      />
      {scrub !== null && scrub !== printedPage ? (
        <p className="text-xs text-accent">p. {scrub} — release to go</p>
      ) : null}

      {basePath ? (
        <p className="text-xs text-muted">
          ← and → turn the page. To quote a passage in a note,{' '}
          <a
            href={href({ w: params.w }, { view: 'preview', p: String(printedPage) })}
            className="text-accent hover:underline underline-offset-2"
          >
            open this page in the workbench
          </a>
          .
        </p>
      ) : paneHidden && selection ? (
        <button
          type="button"
          disabled={selection.length > MAX_QUOTE_CHARS}
          onClick={() =>
            router.push(href(params, { quote: selection, p: String(printedPage), r: null }))
          }
          className="border border-accent px-3 py-1 text-xs text-accent hover:bg-accent hover:text-background disabled:opacity-40"
        >
          Use as quotation — opens the note pane
        </button>
      ) : (
        <p className="text-xs text-muted">
          ← and → turn the page. Select a passage and use it beside the Quotation field.
        </p>
      )}

      {page ? (
        <div
          id="preview-body"
          data-printed-page={printedPage}
          lang={lang}
          className="page-text reading max-w-[36rem] border-t border-rule pt-5 selection:bg-accent/15"
        >
          {blocks.map((b, i) =>
            b.kind === 'heading' ? (
              <p key={i} className="page-heading">
                {b.text}
              </p>
            ) : (
              <p key={i}>{b.text}</p>
            ),
          )}
        </div>
      ) : (
        <div className="max-w-[36rem] space-y-2 border-t border-rule pt-5 text-sm">
          <p>
            p. {printedPage} is missing from this file. The scan has no page with this
            number: a blank page left out, a plate, or a page missing from the copy.
          </p>
          <p className="text-muted">
            {missing?.before != null ? (
              <button
                type="button"
                onClick={() => go(missing.before as number)}
                className="text-accent hover:underline underline-offset-2"
              >
                ‹ p. {missing.before}
              </button>
            ) : null}
            {missing?.before != null && missing?.after != null ? <span className="px-2">·</span> : null}
            {missing?.after != null ? (
              <button
                type="button"
                onClick={() => go(missing.after as number)}
                className="text-accent hover:underline underline-offset-2"
              >
                p. {missing.after} ›
              </button>
            ) : null}
          </p>
        </div>
      )}
    </div>
  );
}
