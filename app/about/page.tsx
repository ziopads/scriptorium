import Link from 'next/link';

import { InitialS } from '@/components/initial-s';
import { requireAllowedUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

// What Scriptorium is, how it is used, and why it is shaped as it is. Reached
// from the wordmark, so it is the first page anyone lands on who wants to know
// what they are looking at.
//
// The instructions she needs in order to work are on /como, in Spanish; nothing
// here is required to use the application. The image credit and the typefaces
// are on /colophon, which is public. Decisions are recorded in the repo under
// docs/; this page is the argument, kept short.

function H({ children, id }: { children: React.ReactNode; id?: string }) {
  return <h2 id={id} className="scroll-mt-6 pt-3 text-lg">{children}</h2>;
}

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="inline font-semibold">{name}. </dt>
      <dd className="inline text-muted">{children}</dd>
    </div>
  );
}

export default async function AboutPage() {
  await requireAllowedUser();

  return (
    <div className="reading max-w-2xl space-y-5">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
        <InitialS size={132} className="shrink-0 border border-rule" />
        <div>
          <h1 className="mb-1 text-2xl">Scriptorium</h1>
          <p className="text-muted">
            A reading instrument: a catalogue of the works on an examination list, the
            books themselves to read from, and notes that keep hold of the page they
            came from. Instructions for use are on{' '}
            <Link href="/como" className="text-accent hover:underline">Cómo</Link>; the
            initial above and the faces it is set in are on the{' '}
            <Link href="/colophon" className="text-accent hover:underline">colophon</Link>.
          </p>
        </div>
      </div>

      <H>How it is used</H>
      <p>
        The workbench is three columns. The catalogue is on the left; choosing a work
        opens it in the middle, where its contents, its pages and the notes already
        written about it are tabs. A note is written on the right, and it is written by
        pointing rather than by typing identifiers: the work she has open is attached
        already, other works are attached by clicking them, and selecting a passage in
        the page view fills the quotation and its printed folio into the form.
      </p>
      <p>
        That last part is the whole of it. A quotation arrives with the page it was
        printed on, taken from the book rather than typed from memory, so a citation
        written in October can be checked against the edition it claims. Everything
        else — the axes, the review queues, the search — is built on notes that have
        that property.
      </p>
      <p>
        Notes gather into <em>ejes</em>: arguments over four to six works, each with a
        thesis, a paragraph on what each work contributes, a synthesis, and what to say
        when an exam question opens on that ground. A note written while reading can be
        promoted into an axis later, or linked to one without moving.
      </p>

      <H>The design, in one line</H>
      <p>
        Nothing is asserted that cannot be traced to a page, and nothing she wrote is
        ever confused with something she read. The rest of this page is what follows
        from those two.
      </p>

      <H>What the exam asks</H>
      <p>
        An oral examination asks a candidate to report scholarship accurately, to make
        her own arguments across it, and to keep the two apart under questioning. The
        third is the one that fails silently. A note that says Adorno&rsquo;s ghosts
        are Derrida&rsquo;s hauntology is a good bridge if she says it is hers and a
        misattribution if she lets it sound like Adorno. She was already tracking this
        by hand in prose: &ldquo;el puente hauntológico con Derrida lo construyes tú; no
        se lo atribuyas a Adorno.&rdquo; The model exists to hold that distinction as
        data, so it survives the deadline.
      </p>

      <H>Two genres of writing</H>
      <p>
        Her working documents are of two kinds. Reading notes are written while
        reading: a verbatim quotation with a page, her translation beneath it, her
        commentary after, with open questions and cross-references threaded through.
        The <em>mapa de cruces</em> is written afterwards: seven <em>ejes</em>, each
        an argument over four to six works, with a thesis, a paragraph per work
        (<em>ficha</em>), a synthesis, and what to say when an exam question opens on
        that ground. The fichas cite no pages. They are claims about whole works, and
        the same work gets a different ficha in each axis it belongs to.
      </p>
      <p>
        Those two facts settle most of the schema. A passage anchor and a whole-work
        relation are different edges. An axis is a note whose parts are notes.
      </p>

      <H>The shape</H>
      <p>
        Two kinds of node, works and notes, and three kinds of edge. A note reaches a
        work either by quoting a passage (page, verbatim quote, translation) or by
        being about the whole work in some role (a ficha, a work named in a synthesis,
        a passage found to support or dispute a claim). A note reaches another note by
        a typed link: a bridge between axes, a contrast, an answer to a question. An
        axis is a note whose body is the thesis; its fichas, synthesis, and exam move
        are child notes, so each part keeps its own history, tags, and attribution.
        Which works an axis binds is derived from its parts, never stored on the axis.
      </p>
      <p>
        Two provenance columns sit on every note and are independent. <em>Origin</em>{' '}
        records who typed the words, her or Claude. <em>Attribution</em> records whose
        claim the note asserts: the author of the work, herself, or a named third
        party. It has no default. An author&rsquo;s claim with no quotation behind it
        is flagged, because that is the one an examiner presses on.
      </p>
      <p>
        Claude&rsquo;s proposals arrive as notes marked as Claude&rsquo;s and
        unreviewed, held apart from her graph until she accepts them. Accepting keeps
        the origin, so a year from now she can still tell what she found and what she
        confirmed. Rejecting hides rather than deletes. Retrieval finds passages that
        share a topic; whether a passage supports or disputes a claim is a judgement
        made by reading it, and the application never makes it.
      </p>

      <H>Prior art</H>
      <p>
        None of this is invented. Each piece has a literature, and the vocabulary in
        the repository comes from it.
      </p>
      <dl className="space-y-3">
        <Term name="Web Annotation Data Model (W3C, 2017)">
          An annotation has a body, one or more targets, and a motivation
          (commenting, questioning, translating, linking). Targets are located by a
          selector; the text-quote selector finds a passage by its exact words, which
          is why notes here anchor to a quotation and never to a page-derived chunk
          that might be rebuilt.
        </Term>
        <Term name="TEI and PROV">
          The Text Encoding Initiative separates who is responsible for a piece of
          text from whose statement it reports; the W3C provenance model separates
          entities, activities, and agents. Origin and attribution are those two
          relations.
        </Term>
        <Term name="Toulmin (1958)">
          An argument is a claim, the grounds for it, and the warrant connecting them.
          An axis is a claim; its fichas are grounds; its synthesis is the warrant.
        </Term>
        <Term name="Citation Typing Ontology (CiTO)">
          A controlled vocabulary for why one text cites another: supports, disputes,
          extends, uses the method of. The role on a note-to-work relation is drawn
          from it; the interface sets roles by which form was used, never by menu.
        </Term>
        <Term name="Issue-Based Information Systems (Rittel)">
          Issues, positions, and arguments. A question here is an issue; it is
          answered by a later note and stays on record.
        </Term>
        <Term name="Zettelkasten (Luhmann)">
          The literature note reports what an author says, with page; the permanent
          note is the reader&rsquo;s own claim; a structure note organises permanent
          notes into an argument. Her reading notes are the first two interleaved; an
          axis is the third.
        </Term>
        <Term name="Qualitative data analysis (Strauss and Corbin)">
          Codes on text segments, memos about codes, and axial coding, where codes are
          grouped around a central category and their relations worked out. An{' '}
          <em>eje</em> is axial coding by name.
        </Term>
        <Term name="Hypergraphs">
          A relation among more than two things is a hyperedge, and the standard way
          to store one is a membership table, which is also a bipartite graph. That is
          why the map draws axes and works as two kinds of node rather than collapsing
          seven axes into pairs of works.
        </Term>
      </dl>

      <H>What is deliberately kept out of view</H>
      <p>
        The role vocabulary, note-to-note links, and the idea of a concept note as a
        hub all exist in the data and none of them appears as a control. The only
        question the interface asks that she would not ask herself is whose claim a
        note asserts. The rest can be exposed later without touching the schema; a
        six-option role picker on every note would produce blank or wrong roles, and
        a wrong role is worse than none.
      </p>

      <p className="text-xs text-muted">
        Decisions and the entity-relationship diagram are in the repository under{' '}
        <code>docs/</code>: <code>ERD.md</code>, <code>COMO-TOMAR-NOTAS.md</code>, and
        the design brief.
      </p>
    </div>
  );
}
