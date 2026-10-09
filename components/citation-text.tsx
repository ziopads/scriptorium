import { runs } from '@/lib/citation';

// A citation with its italics rendered. The text carries them as paired
// asterisks (lib/citation.ts); plain() deletes them, which loses every book
// title's italics, so the display goes through here instead.

export function CitationText({ text }: { text: string }) {
  return (
    <>
      {runs(text).map((run, i) => (run.italic ? <i key={i}>{run.text}</i> : <span key={i}>{run.text}</span>))}
    </>
  );
}
