# Cómo preguntarle a Claude · How to ask Claude

Source of the wording for `/como/claude` (`app/como/claude/page.tsx`). Keep
the two in step by hand, as `docs/COMO-TOMAR-NOTAS.md` is kept with `/como`.
Spanish first, English after; the two say the same thing.

The page points to Gaps → Files for the works Claude cannot search, and
says Claude can list them: the MCP servers' `list_gaps` tool gives the same
list, by the same rule (`fileStates()` in `lib/gaps.ts`).

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
