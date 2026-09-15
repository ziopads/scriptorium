# Cómo tomar notas en Scriptorium

**Versión:** 0.2
**Fecha:** 2026-09-14
**Estado:** Borrador. Este texto es la página de instrucciones dentro de la
aplicación; se versiona junto con el esquema que describe (`db/005-notes-graph.sql`).

---

## Hay cuatro cosas que puedes escribir

Una nota o una pregunta se escribe en la página de inicio: elige la obra en la
lista de la izquierda y escribe en el panel derecho; con el *+* de cada fila
añades más obras a la misma nota. También desde *Notes* (*New note*) o desde la
página de la obra (*Add a note*). Una ficha se escribe en el panel derecho con
el eje elegido a la izquierda, o en la página del eje. Un eje se crea en el
mismo panel derecho, con *New axis*, o en *Axes*.

**Nota.** Una idea, una observación, una lectura de un pasaje. Es lo que más
vas a escribir. Puede tener cita y página o no tenerlas.

**Pregunta.** Algo que te preguntas y no has resuelto. Se queda abierta hasta
que otra nota la responda; entonces se enlaza a esa nota y no desaparece.

**Ficha.** Un párrafo sobre lo que una obra aporta a un argumento. Siempre
pertenece a un eje. Puede cubrir más de una obra (las colecciones folclóricas,
por ejemplo) si las lees como un solo aporte.

**Eje.** Un argumento que reúne varias obras. Tiene cuatro partes, que son las
que ya usas: la tesis, las fichas, cómo se conectan, y el movimiento de examen.

¿Nota o eje? Mientras lees, es una nota: una afirmación sobre un pasaje o sobre
una obra. Cuando la misma idea ya apareció en tres o cuatro obras y quieres
decir qué suman, es un eje, y las notas que ya tienes sobre esas obras son el
material de sus fichas. Tus notas de preparación son notas; tu mapa de cruces
son ejes. Una nota que crece, nombra más obras y pide una tesis es un eje que
empezó como nota; créalo y pasa los párrafos a fichas.

## Una nota que ya escribiste y un eje

Selecciona la nota en la lista de la izquierda y, debajo de ella en el panel
derecho, tienes dos maneras de unirla a un eje. No son lo mismo.

**Hacerla ficha de un eje.** La nota se vuelve parte de ese eje: deja de estar
en la lista de notas sueltas y aparece entre las fichas. Es lo que quieres
cuando la nota ya dice qué aporta esa obra al argumento. La cita y la página se
quedan con ella. Una nota sólo puede ser ficha de un eje, porque una ficha se
escribe para un eje y una obra en concreto: la ficha de Anzaldúa en el Eje 2 no
es su ficha en el Eje 4. Si te arrepientes, *Make it a plain note again* la
devuelve a su sitio.

**Decir que también toca un eje.** La nota se queda donde está y sólo queda
registrado el cruce. Puedes hacerlo con tantos ejes como quieras. Sirve para lo
que en tu mapa era «puente al Eje 3»: la nota no es una ficha de ese eje, pero
al leer ese eje quieres acordarte de ella.

Para hacerla ficha, la nota tiene que apuntar a alguna obra: una ficha dice qué
aporta una obra, y sin obra no hay nada que decir.

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
listas (Radin, Carpentier), agrégala desde el mismo panel derecho, en *Add a
work*, sin salir de lo que estás escribiendo: queda marcada como añadida por ti
y se adjunta a la nota. Lo que falte para citarla bien lo llenas después en
*Gaps*.

Si estás leyendo un libro en *Preview* y quieres agregar un cuento o un ensayo
que está dentro de él, el mismo formulario te ofrece marcarlo como parte de ese
libro, con la página en la que estás. Así el cuento se puede citar por su
nombre sin tener que dar de alta la colección entera.

## Etiquetas

Libres, pocas, en minúsculas. Para lugares usa `lugar:abiquiu`,
`lugar:conejos`, `lugar:valle-san-luis`.

Si inventas una etiqueta nueva y quieres ponérsela a notas que ya escribiste:
en *Notes*, marca las casillas de las notas (con *shift* marcas todo un tramo),
escribe la etiqueta en la barra de arriba y *Add tag*.

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
| Obra nueva desde cero | `/works/new`, o *Add a work* en el panel derecho (`addStubWork`): título y lo que haya; `standing = 'added'`, `purpose = 'unassigned'`; el resto lo llena `/gaps`. Desde el panel, la obra queda adjunta a la nota que se está escribiendo. |
| Cuento o ensayo dentro de un libro | `works.container_id`, `first_page`, `last_page`, propuestos desde la obra abierta en *Preview* y la página en pantalla. |
| Nota que se vuelve ficha | `promoteToFicha`: `kind`, `parent_id` y `ordinal` a la vez, y las obras que toca pasan a `note_works` con `role = 'ficha'`. Las anclas se quedan. `demoteFicha` lo revierte y devuelve el rol a `about`. |
| Nota que «también toca» un eje | `note_links` de tipo `bridge`. No añade sus obras al eje: `axis_works` deriva la pertenencia sólo de los hijos. |
| Etiquetar en lote | `addTags` / `removeTags`; no escriben `note_revisions` ni tocan `reviewed`. |
| No clasificar relaciones | `note_works.role` lo fija el formulario (`ficha`, `yield`) o la aprobación de una propuesta (`supports`, `disputes`); nunca un menú. |
