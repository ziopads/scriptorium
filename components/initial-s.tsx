import Link from 'next/link';

// The woodcut initial on the sign-in page, and the note that credits it.
//
// Heinrich Vogtherr the Elder cut an alphabet of these around 1538, each letter
// about an inch and a half square, each with a putto climbing through it. The
// Met holds the set; it is Open Access, so the image is free to use.
//
// It earns its place beyond decoration. The wordmark already rubricates its own
// initial, and a printer's initial is the thing this application is named for:
// a scriptorium is where a text is copied by hand and the first letter is where
// the labour shows. The whole apparatus here — printed folios, verbatim
// quotation, a citation that survives a defence — is an argument that the page
// a passage sits on is not incidental. So is a sixteenth-century initial.
//
// Sized for the page at 640px; the Met's scan is 2,783px and 2.5 MB, which is
// not a thing to ship to a browser.

export function InitialS({
  size = 200,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/initial-s-vogtherr.jpg"
      width={size}
      height={size}
      alt="A woodcut initial S with a putto climbing through it, cut by Heinrich Vogtherr the Elder around 1538"
      className={className}
      style={{ width: size, height: 'auto' }}
    />
  );
}

export function InitialSCredit({ full = false }: { full?: boolean }) {
  if (!full) {
    return (
      <p className="reading-sm text-muted">
        Heinrich Vogtherr the Elder, <span className="italic">Initial letter S with putto</span>,
        ca. 1538.{' '}
        <Link href="/colophon" className="hover:text-accent">
          About this image
        </Link>
      </p>
    );
  }

  return (
    <div className="reading-sm space-y-3 text-muted">
      <p>
        The initial is a woodcut by <strong>Heinrich Vogtherr the Elder</strong> (German, born
        1490, active 1538–1540), one of an alphabet of ornamental capitals he cut around 1538.
        Each letter is a block about an inch and a half square — 4.7 by 4.7 centimetres — with a
        putto climbing through the letterform. Vogtherr worked in Strasbourg and Augsburg as a
        painter, block-cutter and printer, and published pattern books of ornament for other
        craftsmen to copy; an initial like this one was a working tool, sold to be set at the head
        of a chapter.
      </p>
      <p>
        The sheet is in the collection of the Metropolitan Museum of Art, New York, acquired by
        purchase through the Anne and Carl Stern Gift in 1959, and released under the Museum’s
        Open Access programme. This copy came by way of{' '}
        <a
          href="https://commons.wikimedia.org/wiki/File:Initial_letter_S_with_putto_MET_DP855220.jpg"
          className="hover:text-accent"
          rel="noopener"
        >
          Wikimedia Commons
        </a>
        .
      </p>
      <p>
        It is here because a printer’s initial is the thing this application is named for. A
        scriptorium is where a text is copied by hand, and the initial is where the copying shows
        itself as labour rather than as transmission. Everything below it — the printed folio on
        every quotation, the passage kept verbatim, the citation built to survive a defence —
        rests on the same claim: that the page a sentence sat on is part of what the sentence is.
      </p>
    </div>
  );
}
