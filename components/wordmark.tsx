import Link from 'next/link';

// The wordmark. Literata, with the initial rubricated: in a scriptorium the
// copyist wrote the black text first and the rubricator added the red
// initials after, and the accent colour is already that red-brown. A small
// mark follows, drawn rather than typed so it is the same on every machine: a
// pilcrow's descendant, the sign a copyist put where a new section began.
//
// Hover lifts the mark's colour into the initial's; that is the whole
// animation, and it is deliberate that there is no more.

export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <Link
      href={href}
      className="wordmark group inline-flex items-baseline gap-1.5 select-none"
      aria-label="Scriptorium — home"
    >
      <span className="wordmark-text">
        <span className="wordmark-initial">S</span>criptorium
      </span>
      <svg
        className="wordmark-mark"
        viewBox="0 0 12 16"
        width="9"
        height="12"
        aria-hidden="true"
      >
        {/* A section mark: two bowls and a stem, the pilcrow reduced to a sign. */}
        <path
          d="M7.2 1.2c-2.6 0-4.4 1.5-4.4 3.6 0 1.9 1.4 3.2 3.4 3.4v6.6h1.6V2.6h1.1v12.2h1.6V2.6h.9V1.2H7.2z"
          fill="currentColor"
        />
      </svg>
    </Link>
  );
}
