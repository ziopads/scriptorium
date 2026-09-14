# Cómo tomar notas en Scriptorium

**Versión:** 0.1
**Fecha:** 2026-09-13
**Estado:** Borrador. Este texto es la página de instrucciones dentro de la
aplicación; se versiona junto con el esquema que describe (`db/005-notes-graph.sql`).

---

## Hay cuatro cosas que puedes escribir

**Nota.** Una idea, una observación, una lectura de un pasaje. Es lo que más
vas a escribir. Puede tener cita y página o no tenerlas.

**Pregunta.** Algo que te preguntas y no has resuelto. Se queda abierta hasta
que otra nota la responda; entonces se enlaza a esa nota y no desaparece.

**Ficha.** Un párrafo sobre lo que una obra aporta a un argumento. Siempre
pertenece a un eje. Puede cubrir más de una obra (las colecciones folclóricas,
por ejemplo) si las lees como un solo aporte.

**Eje.** Un argumento que reúne varias obras. Tiene cuatro partes, que son las
que ya usas: la tesis, las fichas, cómo se conectan, y el movimiento de examen.

## Cada nota responde una pregunta: ¿de quién es esta afirmación?

- **Lo dice el autor.** Estás reportando lo que el texto dice. Pon la cita y
  la página. Si no tienes cita, la nota se marcará como afirmación sin
  respaldo, y es la primera que el sinodal va a cuestionar.
- **Lo digo yo.** Es tu puente, tu lectura, tu conexión. No necesita cita.
  Ejemplo: el puente de Adorno a Derrida lo construyes tú.
- **Lo dice otro.** Alguien que no es el autor de la obra que estás leyendo.
  Escribe quién. Ejemplo: *textual cleansing* es de Bolaños, aunque lo anotes
  leyendo a Adorno.

Si una nota mezcla las tres, sepárala en varias. Una afirmación por nota es lo
que te permitirá encontrarla después.

## Citas y traducciones

La cita va tal cual, en el idioma original, con la página impresa del libro.
Tu traducción va en el campo de al lado, junto a la cita. Tu comentario va en
el cuerpo de la nota. Tres cosas, tres lugares.

## Obras

Toda nota puede apuntar a una o más obras del catálogo. Escribe el nombre y
elige de la lista; el código `[I.A.3]` aparece solo. Si la obra no está en tus
listas (Radin, Carpentier), agrégala al catálogo primero; queda marcada como
añadida por ti.

## Etiquetas

Libres, pocas, en minúsculas. Para lugares usa `lugar:abiquiu`,
`lugar:conejos`, `lugar:valle-san-luis`.

## Propuestas de Claude

Cuando pidas a Claude que busque pasajes que apoyen o contradigan una ficha, lo
que encuentre aparece en *Propuestas*, aparte de tus notas. Nada entra a tu
mapa hasta que lo apruebes. Aprobar es un botón; rechazar la esconde, y puedes
reconsiderarla después desde la lista de rechazadas. Una propuesta aprobada
queda marcada para siempre como encontrada por Claude y confirmada por ti.

## Lo que no tienes que hacer

No tienes que clasificar el tipo de relación entre nota y obra, ni decidir qué
es nodo y qué es enlace, ni pensar en el mapa. El mapa se dibuja solo a partir
de lo anterior.

---

## Notas de implementación (no se muestran a la usuaria)

Lo que la página promete y lo que el esquema debe cumplir:

| Promesa en la página | Cómo se cumple |
|---|---|
| Cuatro cosas que escribir | `notes.kind`: `note`, `question`, `ficha`, `axis`. Los kinds `synthesis` y `exam_move` existen pero son campos del formulario de eje, guardados como notas hijas; nunca se nombran. |
| Una pregunta sin default | `notes.attribution` es nullable y el formulario no preselecciona. Tres botones: `author`, `own`, `other`; `attributed_to` aparece sólo con `other`. |
| Afirmación sin respaldo | Vista o consulta: `attribution = 'author'` sin ningún `note_anchors.quote`. |
| Traducción junto a la cita | `note_anchors.translation`. |
| El código aparece solo | Derivado de `exam_lists.sort` (romano), `list_sections.letter`, `list_items.ordinal`; nunca almacenado. |
| Obra fuera de las listas | `works.standing = 'added'`, `purpose = 'unassigned'` (migración 003). |
| Lugares como etiquetas | Convención `lugar:` en `notes.tags`; sin tabla. |
| Propuestas aparte | `origin = 'assistant'`, `reviewed = false`; el mapa y la búsqueda filtran por `reviewed`. Aprobar pone `reviewed = true` y deja `origin`. Rechazar pone `rejected_at`; toda lista y vista excluye las rechazadas salvo la lista de rechazadas. |
| Nota sin cita ni página | `note_works` con `role = 'about'`, nunca un ancla vacía. |
| Obra nueva desde cero | `/works/new`: título y lo que haya; `standing = 'added'`, `purpose = 'unassigned'`; el resto lo llena `/gaps`. |
| No clasificar relaciones | `note_works.role` lo fija el formulario (`ficha`, `yield`) o la aprobación de una propuesta (`supports`, `disputes`); nunca un menú. |
