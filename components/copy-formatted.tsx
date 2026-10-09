'use client';

import { useState } from 'react';

// Copies a works cited with its formatting: HTML (italics, hanging indent) for
// Word and Google Docs, and the plain text beside it for anywhere that takes
// only text. Where the browser cannot write HTML to the clipboard, the plain
// text is copied and the button says so; the plain-text box stays on the page
// as the last resort.

type State = 'idle' | 'copied' | 'plain' | 'failed';

const LABEL: Record<State, string> = {
  idle: 'Copy with formatting',
  copied: 'Copied, with italics',
  plain: 'Copied as plain text only (this browser would not copy formatting)',
  failed: 'Could not copy: select the list below instead',
};

export function CopyFormatted({ html, text }: { html: string; text: string }) {
  const [state, setState] = useState<State>('idle');

  async function copy() {
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]);
        setState('copied');
      } else {
        await navigator.clipboard.writeText(text);
        setState('plain');
      }
    } catch {
      setState('failed');
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="border border-accent px-3 py-1 text-sm text-accent hover:bg-accent hover:text-background"
    >
      {LABEL[state]}
    </button>
  );
}
