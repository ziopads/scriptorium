'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { MAX_QUOTE_CHARS, normalizeQuotation } from '@/lib/quotation';
import { href, type WorkbenchParams } from '@/lib/workbench-url';

// "Use as quotation", sitting beside the Quotation field rather than above the
// page. She selects a passage in the centre and the button is already where
// she is about to type, with no scroll back to the top of the reading pane.
//
// The selection lives in the Preview pane and the button lives in the note
// form, two subtrees with no state between them, so this reads the DOM: the
// page body carries id="preview-body" and data-printed-page, and the selection
// counts only when both its ends are inside that element. The page comes from
// the attribute rather than from the URL, so it is right even before p has
// been set by a page turn.
//
// Renders nothing when there is no selection, which keeps the form quiet until
// there is something to put in it.

export function QuoteCapture({ params }: { params: WorkbenchParams }) {
  const router = useRouter();
  const [selection, setSelection] = useState('');
  const [page, setPage] = useState<string | null>(null);

  useEffect(() => {
    function onSelectionChange() {
      const body = document.getElementById('preview-body');
      const sel = document.getSelection();
      if (!body || !sel || sel.isCollapsed) {
        setSelection('');
        return;
      }
      if (!body.contains(sel.anchorNode) || !body.contains(sel.focusNode)) {
        setSelection('');
        return;
      }
      setSelection(normalizeQuotation(sel.toString()));
      setPage(body.dataset.printedPage ?? null);
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  if (!selection) return null;

  const tooLong = selection.length > MAX_QUOTE_CHARS;

  return (
    <span className="ml-auto flex items-baseline gap-2">
      <span className="text-xs text-muted">
        {tooLong ? `${selection.length.toLocaleString()} chars — too long` : page ? `p. ${page}` : null}
      </span>
      <button
        type="button"
        disabled={tooLong}
        onClick={() =>
          router.push(href(params, { quote: selection, p: page ?? params.p ?? null }))
        }
        className="border border-accent px-2 py-0.5 text-xs text-accent hover:bg-accent hover:text-background disabled:opacity-40"
      >
        Use selection
      </button>
    </span>
  );
}
