// A printed page number, marked when the work's pagination is unverified.
//
// offsets.py could not settle the numbering of some files: an ebook converted
// with calibre prints no page numbers at all, a bad scan prints some that
// cannot be read. The text of those books is still worth reading and searching,
// so they are carried through the pipeline once someone accepts the file
// (migration 016) — but every page number the app derives for one of them may
// be wrong, and the place that matters is where she copies a quotation.
//
// So the marker rides after the number itself, close enough to survive a paste
// into her draft, and the sheet it appears on says once what it means.
//
// Works cited is deliberately unmarked: an essay's page range there is typed
// from the edition into first_page and last_page, not derived from the file,
// and marking it would cast doubt on numbers that are not in doubt.

export function PageNumber({
  page,
  unverified,
  prefix = '',
}: {
  page: number;
  unverified: boolean;
  prefix?: string;
}) {
  if (!unverified) return <>{prefix}{page}</>;
  return (
    <>
      {prefix}
      {page}
      <span
        className="text-accent"
        title="Page number unverified: this file's printed pagination could not be settled. Check it against the PDF before citing."
      >
        *
      </span>
    </>
  );
}

// One line, at the foot of anything that showed a marked page.
export function UnverifiedPagesNote() {
  return (
    <p className="text-xs text-muted">
      <span className="text-accent">*</span> Page number unverified: this
      file&rsquo;s printed pagination could not be settled. Check it against the PDF
      before citing.
    </p>
  );
}
