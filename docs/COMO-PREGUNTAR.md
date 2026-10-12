# Cómo preguntarle a Claude · How to ask Claude

Source of the wording for `/como/claude` (`app/como/claude/page.tsx`). Keep
the two in step by hand, as `docs/COMO-TOMAR-NOTAS.md` is kept with `/como`.
Spanish first, English after; the two say the same thing.

The page points to Gaps → Files for the works Claude cannot search, and
says Claude can list them: the MCP servers' `list_gaps` tool gives the same
list, by the same rule (`fileStates()` in `lib/gaps.ts`).

The section on projects (added 24 Sept) rests on the servers' 0.7.0 tools:
`list_projects`, and the `project` argument of `find_works`, `search` and
`list_notes`. Its Spanish is a draft for Zazil to read.

The section on outlines (added 11 Oct, the eve of comps) rests on the
servers' 0.8.0 instructions and on `origin` and `truncated` in `list_notes`.
Its Spanish is also a draft for Zazil to read.

---

## Español

*Claude puede buscar y leer en tus libros desde claude.ai, y proponerte
notas. Aquí está cómo conectarlo, cómo preguntar para que la respuesta se
pueda citar, y lo que no puede saber.*

### Conectarlo (una sola vez)

En claude.ai: *Customize → Connectors → Add custom connector*. Nombre:
Scriptorium. URL: `https://scriptorium-mauve.vercel.app/api/mcp`. Luego
*Connect*, entra con tu cuenta de Scriptorium y pulsa *Allow*. Si en una
conversación Claude no parece ver tus libros, activa Scriptorium en el menú
*+* de esa conversación.

### Lo que Claude puede hacer con tus libros

- Buscar pasajes por tema en toda la colección, en español y en inglés: una
  pregunta en un idioma encuentra texto en el otro.
- Leer páginas por su número impreso.
- Comprobar una cita contra el libro y darte las palabras exactas y la página.
- Leer las guías de estudio (por ahora Rama, Mignolo y Adorno) y tus notas.
- Proponerte notas, que llegan a Propuestas y no entran a tus notas hasta que
  las apruebes.

No puede editar ni borrar nada.

### Cómo preguntar

Una pregunta amplia funciona, por ejemplo: «¿Qué papeles tiene la lechuza en
la literatura de la frontera, qué marcos teóricos la leen, y qué obras del
corpus los ilustran o los subvierten?». La respuesta es mejor si pides también
el método. Puedes pegar esto al final:

> Busca en el corpus en español y en inglés, con varias búsquedas distintas,
> lee las páginas alrededor de lo que encuentres y cita cada pasaje con su
> página. Separa lo que muestra el corpus de lo que sabes por otras fuentes, y
> dime qué obras buscaste y no encontraste.

Una pregunta muy amplia hace muchas búsquedas y gasta tu límite de uso.
Conviene dividirla: primero el folclor, luego la ficción, luego la teoría.
Cuando una conversación se alarga mucho, empieza otra.

### Tus proyectos

Un proyecto reúne las obras y las notas de un solo escrito, por ejemplo uno de
los cinco ensayos del examen. Se crean en Projects; las obras se añaden desde
el catálogo y las notas desde Notes. Claude puede trabajar dentro de un
proyecto: nombra el proyecto en la pregunta («en mi proyecto Ensayo 1,
busca…») y puede limitar la búsqueda a sus obras y la lectura a sus notas.
También te dirá qué obras del proyecto no puede buscar.

### Un esquema desde tus notas

Para un ensayo, crea antes su proyecto y añade las obras que vas a usar.
Luego pega la pregunta del examen y esto:

> Hazme un esquema para responder esta pregunta. Empieza por mis notas del
> proyecto [nombre] y después completa con búsquedas en el corpus. En el
> esquema separa a la vista:
>
> - mis palabras, tal como las escribí, sin reformular, diciendo si es una
>   afirmación mía o mi lectura del autor;
> - las citas, en bloque, con obra y página; si una cita está escrita dentro
>   de mi nota, compruébala o márcala «sin verificar»;
> - las notas que acepté de Claude, marcadas como «propuesta aceptada»;
> - lo que añades tú (búsquedas, guías de estudio, tu análisis, lo que sabes
>   de otras fuentes), en una sección aparte al final.
>
> Dime si quedaron notas mías que no alcanzaste a leer.

Una nota que Claude propuso y tú aceptaste sigue marcada como suya aunque la
hayas editado: así sabes después qué frases escribiste tú.

### Lo que Claude no puede saber

- **Sólo ve los libros cargados.** Las obras sin archivo, o con el archivo
  todavía sin procesar, aparecen en Gaps → Files, y Claude no puede buscar en
  ellas; también te las puede listar. Que no encuentre algo en el corpus no
  quiere decir que no exista en la literatura.
- **Lo que Claude sabe de otras lecturas no se puede citar a tus libros.** Eso
  incluye teoría que conoce y libros que no están aquí. Pídele que lo marque.
- **El texto viene de un escaneo (OCR) y tiene errores de lectura**, por
  ejemplo «ongenes» por «orígenes». Antes de citar, pídele que compruebe la
  cita: te devuelve las palabras del libro y la página exacta. Una búsqueda da
  un intervalo de páginas; la comprobación da la página.

### Las páginas

Claude cita la página impresa, como el resto de la aplicación. Un asterisco
(104\*) quiere decir que el número no está verificado contra la edición:
cítalo con cuidado, o compruébalo en el libro.

### Las notas que propone

Cada cita de una propuesta se comprobó contra el libro antes de guardarse; si
una no aparece, Claude no puede guardar la nota. Cuando la nota es análisis de
Claude, no dice de quién es la afirmación: eso lo decides tú, como en tus
notas.

---

## English

*Claude can search and read your books from claude.ai, and propose notes to
you. This page covers connecting it, asking so the answer can be cited, and
what it cannot know.*

### Connecting it (once)

In claude.ai: *Customize → Connectors → Add custom connector*. Name:
Scriptorium. URL: `https://scriptorium-mauve.vercel.app/api/mcp`. Then
*Connect*, sign in with your Scriptorium account and press *Allow*. If Claude
doesn't seem to see your books in a conversation, turn Scriptorium on in that
conversation's *+* menu.

### What Claude can do with your books

- Search the whole collection for passages on a topic, in Spanish and in
  English: a question in one language finds text in the other.
- Read pages by their printed number.
- Check a quotation against the book and give you its exact words and page.
- Read the study aids (for now Rama, Mignolo and Adorno) and your notes.
- Propose notes, which arrive in Proposals and join your notes only when you
  approve them.

It cannot edit or delete anything.

### How to ask

A broad question works, for example: "What roles does the owl play in border
literature, which theoretical frameworks read it, and which works in the
corpus illustrate or subvert them?" The answer is better if you also ask for
the method. You can paste this at the end:

> Search the corpus in Spanish and in English, with several different
> searches, read the pages around what you find, and cite every passage with
> its page. Keep what the corpus shows separate from what you know from
> elsewhere, and tell me which works you looked for and didn't find.

A very broad question makes many searches and uses up your usage limit.
Splitting it helps: the folklore first, then the fiction, then the theory.
When a conversation gets long, start a new one.

### Your projects

A project gathers the works and notes for one piece of writing, such as one of
the five exam essays. Projects are made on the Projects page; works are added
from the catalogue and notes from Notes. Claude can work inside a project: name
it in your question ("in my project Essay 1, search…") and it can limit its
searches to that project's works and its reading to its notes. It will also
tell you which of the project's works it cannot search.

### An outline from your notes

For an essay, make its project first and add the works you will use. Then
paste the exam question and this:

> Make me an outline for answering this question. Start from my notes in the
> project [name], then add from searches of the corpus. In the outline, keep
> these visibly apart:
>
> - my words, as I wrote them, unreworded, saying whether each is my own
>   claim or my reading of the author;
> - quotations, as block quotations with the work and page; if a quotation is
>   typed inside my note, check it or mark it "unverified";
> - notes I accepted from Claude, marked "accepted proposal";
> - what you add (searches, study aids, your analysis, what you know from
>   elsewhere), in a separate section at the end.
>
> Tell me if any of my notes were left unread.

A note Claude proposed and you accepted stays marked as Claude's even after
you edit it, so you can later tell which sentences you wrote.

### What Claude cannot know

- **It sees only the books that are loaded.** Works with no file, or whose
  file is not yet processed, are listed in Gaps → Files, and Claude cannot
  search them; it can list them for you. Not finding something in the corpus
  doesn't mean it is absent from the literature.
- **What Claude knows from other reading cannot be cited to your books.** That
  includes theory it knows and books that aren't here. Ask it to mark it.
- **The text comes from a scan (OCR) and has misreadings**, for example
  "ongenes" for "orígenes". Before citing, ask Claude to check the quotation:
  it gives back the book's words and the exact page. A search gives a range of
  pages; the check gives the page.

### Page numbers

Claude cites the printed page, as the rest of the application does. An
asterisk (104\*) means the number has not been verified against the edition:
cite it with care, or check it in the book.

### The notes it proposes

Every quotation in a proposal was checked against the book before it was
saved; if one isn't found, Claude cannot save the note. When the note is
Claude's own analysis, it doesn't say whose claim it is: you decide that, as
with your own notes.
