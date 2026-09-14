'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { PageBounds, PageText } from '@/lib/pages';
import { MAX_QUOTE_CHARS, normalizeQuotation } from '@/lib/quotation';
import { href, type WorkbenchParams } from '@/lib/workbench-url';

// One page of the book, with the means to get off it quickly and the means to
// turn a passage into a quotation.
//
// A selection that crossed a page break would have no single folio, which is
// the thing this is here to supply, so the pane shows one page at a time. The
// ways off it: left and right arrow keys, the two chevrons, a folio typed into
// the field, and the scrubber for crossing a long book in one drag.
//
// The scrubber moves a local number while dragging and navigates once on
// release. Navigating per pixel would be a server round trip per pixel.
//
// The page text is rendered verbatim, breaks and all, because pages.text is
// what verify_quotation will be checked against. The passage is cleaned on its
// way to the form, not on its way to the screen (lib/quotation.ts).

export function PageView({
  params,
  page,
  bounds,
}: {
  params: WorkbenchParams;
  page: PageText;
  bounds: PageBounds;
}) {
  const router = useRouter();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState('');
  const [scrub, setScrub] = useState<number | null>(null);
  const [folioField, setFolioField] = useState(String(page.printed_page));

  useEffect(() => {
    setFolioField(String(page.printed_page));
    setScrub(null);
  }, [page.printed_page]);

  const go = useCallback(
    (to: number, patch: Record<string, string | null> = {}) => {
      const clamped = Math.min(Math.max(to, bounds.first), bounds.last);
      router.push(href(params, { p: String(clamped), ...patch }));
    },
    [bounds.first, bounds.last, params, router],
  );

  // What is selected, whenever it changes, provided it is inside the page.
  useEffect(() => {
    function onSelectionChange() {
      const sel = document.getSelection();
      const body = bodyRef.current;
      if (!sel || sel.isCollapsed || !body) {
        setSelection('');
        return;
      }
      if (!body.contains(sel.anchorNode) || !body.contains(sel.focusNode)) {
        setSelection('');
        return;
      }
      setSelection(normalizeQuotation(sel.toString()));
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  // Left and right turn the page. Guarded so they still move the caret inside
  // a field, and so the left pane's own arrow handling is untouched (it uses
  // up and down).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === 'ArrowRight' && page.printed_page < bounds.last) {
        e.preventDefault();
        go(page.printed_page + 1);
      } else if (e.key === 'ArrowLeft' && page.printed_page > bounds.first) {
        e.preventDefault();
        go(page.printed_page - 1);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bounds.first, bounds.last, go, page.printed_page]);

  const shown = scrub ?? page.printed_page;
  const tooLong = selection.length > MAX_QUOTE_CHARS;

  // The offset check: folio is the number read off the page, printed_page is
  // page_index + works.page_offset. A disagreement means the offset is wrong.
  const offsetOff = page.folio !== null && page.folio !== page.printed_page;

  function useAsQuotation() {
    if (!selection || tooLong) return;
    // r: null opens the note pane if it was hidden — the quotation lands in a
    // field she would otherwise not be able to see.
    router.push(href(params, { quote: selection, p: String(page.printed_page), r: null }));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => go(page.printed_page - 1)}
            disabled={page.printed_page <= bounds.first}
            className="px-1 text-base leading-none disabled:opacity-30 hover:text-accent"
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
            onBlur={() => setFolioField(String(page.printed_page))}
            className="w-16! text-center"
            aria-label="Go to printed page"
          />
          <button
            type="button"
            onClick={() => go(page.printed_page + 1)}
            disabled={page.printed_page >= bounds.last}
            className="px-1 text-base leading-none disabled:opacity-30 hover:text-accent"
            aria-label="Next page"
          >
            ›
          </button>
        </span>

        <span>
          of {bounds.first}–{bounds.last}
          <span className="pl-2">({bounds.count} pages held)</span>
        </span>

        {offsetOff ? (
          <span className="text-accent" title="pages.folio disagrees with page_index + works.page_offset">
            printed folio reads {page.folio} — the offset for this work looks wrong
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
      {scrub !== null && scrub !== page.printed_page ? (
        <p className="text-xs text-accent">p. {scrub} — release to go</p>
      ) : null}

      <div className="flex min-h-6 items-baseline gap-3">
        {selection ? (
          <>
            <button
              type="button"
              onClick={useAsQuotation}
              disabled={tooLong}
              className="border border-accent px-3 py-1 text-xs text-accent hover:bg-accent hover:text-background disabled:opacity-40"
            >
              Use as quotation
            </button>
            <span className="text-xs text-muted">
              {tooLong
                ? `${selection.length.toLocaleString()} characters is too long for one quotation`
                : `${selection.length.toLocaleString()} characters · p. ${page.printed_page}`}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted">
            Select a passage to use it as the quotation. ← and → turn the page.
          </span>
        )}
      </div>

      <div
        ref={bodyRef}
        className="reading max-w-[36rem] whitespace-pre-wrap border-t border-rule pt-4 selection:bg-accent/15"
      >
        {page.text}
      </div>
    </div>
  );
}
