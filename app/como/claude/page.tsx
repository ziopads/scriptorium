import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

// Asking Claude through the Scriptorium connector, in Spanish and English.
// The source of truth for the wording is docs/COMO-PREGUNTAR.md; keep the two
// in step by hand, as /como is kept with docs/COMO-TOMAR-NOTAS.md. The two
// languages say the same thing: a change to one is a change to both.

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-3 text-lg">{children}</h2>;
}

function Prompt({ children }: { children: React.ReactNode }) {
  return <blockquote className="border-l-2 border-rule pl-4 text-muted">{children}</blockquote>;
}

const MCP_URL = 'https://scriptorium-mauve.vercel.app/api/mcp';

const link = 'text-accent hover:underline';

export default async function ComoClaudePage() {
  await requireAllowedUser();

  return (
    <div className="reading max-w-2xl space-y-5">
      <p className="text-sm text-muted">
        <a href="#es" className={link}>Español</a> · <a href="#en" className={link}>English</a>
      </p>

      {/* ------------------------------------------------------------ Español */}
      <section id="es" lang="es" className="scroll-mt-6 space-y-5">
        <div>
          <h1 className="mb-1 text-2xl">Cómo preguntarle a Claude</h1>
          <p className="text-muted">
            Claude puede buscar y leer en tus libros desde claude.ai, y proponerte
            notas. Aquí está cómo conectarlo, cómo preguntar para que la respuesta se
            pueda citar, y lo que no puede saber.
          </p>
        </div>

        <H>Conectarlo (una sola vez)</H>
        <p>
          En claude.ai: <em>Customize → Connectors → Add custom connector</em>. Nombre:
          Scriptorium. URL: <code>{MCP_URL}</code>. Luego <em>Connect</em>, entra con tu
          cuenta de Scriptorium y pulsa <em>Allow</em>. Si en una conversación Claude
          no parece ver tus libros, activa Scriptorium en el menú <em>+</em> de esa
          conversación.
        </p>

        <H>Lo que Claude puede hacer con tus libros</H>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Buscar pasajes por tema en toda la colección, en español y en inglés: una
            pregunta en un idioma encuentra texto en el otro.
          </li>
          <li>Leer páginas por su número impreso.</li>
          <li>Comprobar una cita contra el libro y darte las palabras exactas y la página.</li>
          <li>Leer las guías de estudio (por ahora Rama, Mignolo y Adorno) y tus notas.</li>
          <li>
            Proponerte notas, que llegan a{' '}
            <Link href="/notes?filter=proposals" className={link}>Propuestas</Link> y no
            entran a tus notas hasta que las apruebes.
          </li>
        </ul>
        <p>No puede editar ni borrar nada.</p>

        <H>Cómo preguntar</H>
        <p>
          Una pregunta amplia funciona, por ejemplo: «¿Qué papeles tiene la lechuza en
          la literatura de la frontera, qué marcos teóricos la leen, y qué obras del
          corpus los ilustran o los subvierten?». La respuesta es mejor si pides también
          el método. Puedes pegar esto al final:
        </p>
        <Prompt>
          Busca en el corpus en español y en inglés, con varias búsquedas distintas, lee
          las páginas alrededor de lo que encuentres y cita cada pasaje con su página.
          Separa lo que muestra el corpus de lo que sabes por otras fuentes, y dime qué
          obras buscaste y no encontraste.
        </Prompt>
        <p>
          Una pregunta muy amplia hace muchas búsquedas y gasta tu límite de uso.
          Conviene dividirla: primero el folclor, luego la ficción, luego la teoría.
          Cuando una conversación se alarga mucho, empieza otra.
        </p>

        <H>Lo que Claude no puede saber</H>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-semibold">Sólo ve los libros cargados.</span> Las obras
            sin archivo, o con el archivo todavía sin procesar, aparecen en{' '}
            <Link href="/gaps/files" className={link}>Gaps → Files</Link>, y Claude no
            puede buscar en ellas. Que no encuentre algo en el corpus no quiere decir que
            no exista en la literatura.
          </li>
          <li>
            <span className="font-semibold">
              Lo que Claude sabe de otras lecturas no se puede citar a tus libros.
            </span>{' '}
            Eso incluye teoría que conoce y libros que no están aquí. Pídele que lo
            marque.
          </li>
          <li>
            <span className="font-semibold">
              El texto viene de un escaneo (OCR) y tiene errores de lectura
            </span>
            , por ejemplo «ongenes» por «orígenes». Antes de citar, pídele que compruebe
            la cita: te devuelve las palabras del libro y la página exacta. Una búsqueda
            da un intervalo de páginas; la comprobación da la página.
          </li>
        </ul>

        <H>Las páginas</H>
        <p>
          Claude cita la página impresa, como el resto de la aplicación. Un asterisco
          (104*) quiere decir que el número no está verificado contra la edición: cítalo
          con cuidado, o compruébalo en el libro.
        </p>

        <H>Las notas que propone</H>
        <p>
          Cada cita de una propuesta se comprobó contra el libro antes de guardarse; si
          una no aparece, Claude no puede guardar la nota. Cuando la nota es análisis de
          Claude, no dice de quién es la afirmación: eso lo decides tú, como en tus
          notas.
        </p>
      </section>

      <hr className="border-rule" />

      {/* ------------------------------------------------------------ English */}
      <section id="en" lang="en" className="scroll-mt-6 space-y-5">
        <div>
          <h1 className="mb-1 text-2xl">How to ask Claude</h1>
          <p className="text-muted">
            Claude can search and read your books from claude.ai, and propose notes to
            you. This page covers connecting it, asking so the answer can be cited, and
            what it cannot know.
          </p>
        </div>

        <H>Connecting it (once)</H>
        <p>
          In claude.ai: <em>Customize → Connectors → Add custom connector</em>. Name:
          Scriptorium. URL: <code>{MCP_URL}</code>. Then <em>Connect</em>, sign in with
          your Scriptorium account and press <em>Allow</em>. If Claude doesn&rsquo;t seem
          to see your books in a conversation, turn Scriptorium on in that
          conversation&rsquo;s <em>+</em> menu.
        </p>

        <H>What Claude can do with your books</H>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Search the whole collection for passages on a topic, in Spanish and in
            English: a question in one language finds text in the other.
          </li>
          <li>Read pages by their printed number.</li>
          <li>Check a quotation against the book and give you its exact words and page.</li>
          <li>Read the study aids (for now Rama, Mignolo and Adorno) and your notes.</li>
          <li>
            Propose notes, which arrive in{' '}
            <Link href="/notes?filter=proposals" className={link}>Proposals</Link> and
            join your notes only when you approve them.
          </li>
        </ul>
        <p>It cannot edit or delete anything.</p>

        <H>How to ask</H>
        <p>
          A broad question works, for example: &ldquo;What roles does the owl play in
          border literature, which theoretical frameworks read it, and which works in the
          corpus illustrate or subvert them?&rdquo; The answer is better if you also ask
          for the method. You can paste this at the end:
        </p>
        <Prompt>
          Search the corpus in Spanish and in English, with several different searches,
          read the pages around what you find, and cite every passage with its page.
          Keep what the corpus shows separate from what you know from elsewhere, and
          tell me which works you looked for and didn&rsquo;t find.
        </Prompt>
        <p>
          A very broad question makes many searches and uses up your usage limit.
          Splitting it helps: the folklore first, then the fiction, then the theory.
          When a conversation gets long, start a new one.
        </p>

        <H>What Claude cannot know</H>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-semibold">It sees only the books that are loaded.</span>{' '}
            Works with no file, or whose file is not yet processed, are listed in{' '}
            <Link href="/gaps/files" className={link}>Gaps → Files</Link>, and Claude
            cannot search them. Not finding something in the corpus doesn&rsquo;t mean it
            is absent from the literature.
          </li>
          <li>
            <span className="font-semibold">
              What Claude knows from other reading cannot be cited to your books.
            </span>{' '}
            That includes theory it knows and books that aren&rsquo;t here. Ask it to
            mark it.
          </li>
          <li>
            <span className="font-semibold">
              The text comes from a scan (OCR) and has misreadings
            </span>
            , for example &ldquo;ongenes&rdquo; for &ldquo;orígenes&rdquo;. Before
            citing, ask Claude to check the quotation: it gives back the book&rsquo;s
            words and the exact page. A search gives a range of pages; the check gives
            the page.
          </li>
        </ul>

        <H>Page numbers</H>
        <p>
          Claude cites the printed page, as the rest of the application does. An
          asterisk (104*) means the number has not been verified against the edition:
          cite it with care, or check it in the book.
        </p>

        <H>The notes it proposes</H>
        <p>
          Every quotation in a proposal was checked against the book before it was saved;
          if one isn&rsquo;t found, Claude cannot save the note. When the note is
          Claude&rsquo;s own analysis, it doesn&rsquo;t say whose claim it is: you decide
          that, as with your own notes.
        </p>
      </section>
    </div>
  );
}
