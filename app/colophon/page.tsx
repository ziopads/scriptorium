import Link from 'next/link';

import { InitialS, InitialSCredit } from '@/components/initial-s';

// Public, and the only page that is.
//
// A colophon is where a printer records what the book was set in — the face,
// the paper, the press — and it is the traditional home for exactly this kind
// of note. It exists here because the sign-in page shows a woodcut that wants
// crediting, and the page that carried the credit was itself behind the
// sign-in form.
//
// Nothing about her work belongs on this page. /about describes the exam, the
// working documents and the note model, and stays behind requireAllowedUser
// until she says otherwise. This page is about an initial and two typefaces.
//
// Kept out of the proxy's matcher alongside /auth, so it renders with no
// session.

export const metadata = {
  title: 'Colophon — Scriptorium',
  description: 'The initial, the faces, and what this is built on.',
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-3 text-lg">{children}</h2>;
}

export default function ColophonPage() {
  return (
    <div className="max-w-2xl space-y-5 py-10">
      <div>
        <h1 className="text-2xl">Colophon</h1>
        <p className="mt-1 text-sm text-muted">
          Scriptorium — a reading list, a bibliography, and the notes that come of them.
        </p>
      </div>

      <H>The initial</H>
      <figure className="m-0 space-y-4">
        <InitialS size={208} className="border border-rule" />
        <figcaption>
          <InitialSCredit full />
        </figcaption>
      </figure>

      <H>The faces</H>
      <p className="reading-sm text-muted">
        Reading copy is set in <strong>Literata</strong>, drawn by TypeTogether as a screen face
        for long-form reading; it has true italics, which the Spanish titles need. The instrument
        around the reading — navigation, labels, filters — is <strong>Geist</strong>. Page text
        from a book is justified with hyphenation in the language of that book, and paragraphs
        are marked by an indent rather than by a space, which is how the books themselves are
        set.
      </p>

      <H>The rest</H>
      <p className="reading-sm text-muted">
        Next.js on Vercel; Postgres with pgvector on Neon; embeddings from Voyage. Page text is
        extracted from PDFs with PyMuPDF and kept verbatim, down to the printed folio, because a
        quotation that cannot be checked against the page it came from is not evidence.
      </p>

      <p className="pt-4 text-xs text-muted">
        <Link href="/auth/sign-in" className="hover:text-accent">
          Sign in
        </Link>
      </p>
    </div>
  );
}
