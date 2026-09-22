import Link from 'next/link';

import { PageNumber } from '@/components/page-number';
import { acceptNote, declineNote, reconsiderNote } from '@/lib/actions';
import type { NoteWithRelations } from '@/lib/types';
import { unverifiedPages } from '@/lib/works';

// One dossier claim: an assistant note tagged 'dossier', written by
// pipeline/dossier.py --load (lib/notes.ts). The claim is the author's
// (attribution 'author'); each anchor is a quotation found in the book, with
// the printed page it was found on.
//
// Lighter than NoteCard on purpose. NoteCard reads each note's revisions and
// links, two queries per card, and a book has two hundred claims; a claim has
// neither until she accepts and works with it, at which point it is an
// ordinary note and NoteCard shows it everywhere else.
//
// review: accept and reject for a pending claim, reconsider for a rejected one.
// read: the claim and its quotations only, for the workbench.

const PARTIAL_TAG = 'respaldo-parcial';
const NAMES_TAG = 'revisar-nombres';

export async function ClaimCard({
  claim,
  workId,
  pageHref,
  lang,
  mode,
}: {
  claim: NoteWithRelations;
  workId: string;
  pageHref: (page: number) => string;
  lang?: string;
  mode: 'review' | 'read';
}) {
  const anchors = claim.anchors.filter((a) => a.work_id === workId);
  const unverified = (await unverifiedPages()).has(workId);
  const rejected = claim.rejected_at !== null;
  const pending = !claim.reviewed && !rejected;

  return (
    <li className={`space-y-2 py-4 text-sm ${rejected ? 'opacity-70' : ''}`}>
      <p className="reading whitespace-pre-wrap">{claim.body}</p>

      {claim.tags.includes(PARTIAL_TAG) ? (
        <p className="text-xs text-accent">
          Its quotations support it only in part: check the claim against them.
        </p>
      ) : null}
      {claim.tags.includes(NAMES_TAG) ? (
        <p className="text-xs text-accent">
          A name or number in it does not appear in the book&rsquo;s text: check the page.
        </p>
      ) : null}

      {anchors.map((a) => (
        <blockquote key={a.ordinal} lang={lang} className="reading-sm border-l-2 border-rule pl-3">
          {a.quote ? <>&ldquo;{a.quote}&rdquo; </> : null}
          {a.printed_page !== null ? (
            <Link
              href={pageHref(a.printed_page)}
              className="whitespace-nowrap text-xs text-muted hover:text-accent hover:underline underline-offset-2"
            >
              p. <PageNumber page={a.printed_page} unverified={unverified} />
            </Link>
          ) : null}
        </blockquote>
      ))}

      {mode === 'review' ? (
        <div className="flex items-center gap-3 text-xs">
          {pending ? (
            <>
              <form action={acceptNote}>
                <input type="hidden" name="id" value={claim.id} />
                <button
                  type="submit"
                  className="border border-accent px-3 py-1 text-accent hover:bg-accent hover:text-background"
                >
                  Accept
                </button>
              </form>
              <form action={declineNote}>
                <input type="hidden" name="id" value={claim.id} />
                <button type="submit" className="text-muted hover:text-accent">Reject</button>
              </form>
            </>
          ) : rejected ? (
            <>
              <span className="text-muted">Rejected</span>
              <form action={reconsiderNote}>
                <input type="hidden" name="id" value={claim.id} />
                <button type="submit" className="text-muted hover:text-accent">Reconsider</button>
              </form>
            </>
          ) : (
            <>
              <span className="text-accent">Accepted</span>
              <form action={declineNote}>
                <input type="hidden" name="id" value={claim.id} />
                <button type="submit" className="text-muted hover:text-accent">Reject</button>
              </form>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
