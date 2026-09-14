import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

// Why the notes model is shaped the way it is. For James, for a future
// collaborator, for her advisor, and for her on a day with time. The
// instructions she needs are on /como; nothing here is required to use the
// application. Decisions are recorded in the repo under docs/; this page is
// the argument, kept short.

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-3 text-lg">{children}</h2>;
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
      <div>
        <h1 className="text-2xl mb-1">Why it is built this way</h1>
        <p className="text-muted">
          The problem, the prior art the design borrows from, and what each table is
          for. Instructions for use are on{' '}
          <Link href="/como" className="text-accent hover:underline">Cómo</Link>.
        </p>
      </div>

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
