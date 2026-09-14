import Link from 'next/link';

import { requireAllowedUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

// The instructions page, in her language. The source of truth for the wording
// is docs/COMO-TOMAR-NOTAS.md; keep the two in step by hand. The hidden
// implementation table in that file is not shown here.

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base pt-2">{children}</h2>;
}

export default async function ComoPage() {
  await requireAllowedUser();

  return (
    <div className="max-w-2xl space-y-6 text-sm leading-relaxed">
      <div>
        <h1 className="text-2xl mb-1">Cómo tomar notas aquí</h1>
        <p className="text-muted">
          Cuatro cosas que puedes escribir, una pregunta que responde cada nota, y
          nada más que decidir.
        </p>
      </div>

      <H>Hay cuatro cosas que puedes escribir</H>
      <p>
        Una nota o una pregunta se escribe en{' '}
        <Link href="/notes" className="text-accent hover:underline">Notes</Link> (el
        botón <em>New note</em> arriba de la lista) o desde la página de la obra (
        <Link href="/works" className="text-accent hover:underline">Catálogo</Link> → la
        obra → <em>Add a note</em>). Una ficha se escribe en la página de su eje. Un
        eje se crea en <Link href="/axes" className="text-accent hover:underline">Axes</Link>.
      </p>
      <dl className="space-y-3">
        <div>
          <dt className="font-medium">Nota.</dt>
          <dd>
            Una idea, una observación, una lectura de un pasaje. Es lo que más vas a
            escribir. Puede tener cita y página o no tenerlas.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Pregunta.</dt>
          <dd>
            Algo que te preguntas y no has resuelto. Se queda abierta hasta que otra
            nota la responda; entonces se enlaza a esa nota y no desaparece.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Ficha.</dt>
          <dd>
            Un párrafo sobre lo que una obra aporta a un argumento. Siempre pertenece
            a un eje. Puede cubrir más de una obra (las colecciones folclóricas, por
            ejemplo) si las lees como un solo aporte.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Eje.</dt>
          <dd>
            Un argumento que reúne varias obras. Tiene cuatro partes, que son las que
            ya usas: la tesis, las fichas, cómo se conectan, y el movimiento de examen.
          </dd>
        </div>
      </dl>

      <p>
        ¿Nota o eje? Mientras lees, es una nota: una afirmación sobre un pasaje o
        sobre una obra. Cuando la misma idea ya apareció en tres o cuatro obras y
        quieres decir qué suman, es un eje, y las notas que ya tienes sobre esas obras
        son el material de sus fichas. Tus notas de preparación son notas; tu mapa de
        cruces son ejes. Una nota que crece, nombra más obras y pide una tesis es un
        eje que empezó como nota; créalo y pasa los párrafos a fichas.
      </p>

      <H>Cada nota responde una pregunta: ¿de quién es esta afirmación?</H>
      <ul className="space-y-2 border-l-2 border-rule pl-3">
        <li>
          <span className="font-medium">Lo dice el autor.</span> Estás reportando lo que
          el texto dice. Pon la cita y la página. Si no tienes cita, la nota se marcará
          como afirmación sin respaldo, y es la primera que el sinodal va a cuestionar.
        </li>
        <li>
          <span className="font-medium">Lo digo yo.</span> Es tu puente, tu lectura, tu
          conexión. No necesita cita. Ejemplo: el puente de Adorno a Derrida lo
          construyes tú.
        </li>
        <li>
          <span className="font-medium">Lo dice otro.</span> Alguien que no es el autor
          de la obra que estás leyendo. Escribe quién. Ejemplo: <em>textual cleansing</em>{' '}
          es de Bolaños, aunque lo anotes leyendo a Adorno.
        </li>
      </ul>
      <p>
        Si una nota mezcla las tres, sepárala en varias. Una afirmación por nota es lo
        que te permitirá encontrarla después.
      </p>

      <H>Citas y traducciones</H>
      <p>
        La cita va tal cual, en el idioma original, con la página impresa del libro.
        Tu traducción va en el campo de al lado, junto a la cita. Tu comentario va en
        el cuerpo de la nota. Tres cosas, tres lugares.
      </p>

      <H>Obras</H>
      <p>
        Toda nota puede apuntar a una o más obras del catálogo. Escribe el nombre y
        elige de la lista; el código <code>[I.A.3]</code> aparece solo. Si la obra no
        está en tus listas (Radin, Carpentier),{' '}
        <Link href="/works/new" className="text-accent hover:underline">agrégala al catálogo</Link>{' '}
        primero; queda marcada como añadida por ti.
      </p>

      <H>Etiquetas</H>
      <p>
        Libres, pocas, en minúsculas. Para lugares usa <code>lugar:abiquiu</code>,{' '}
        <code>lugar:conejos</code>, <code>lugar:valle-san-luis</code>.
      </p>

      <H>Propuestas de Claude</H>
      <p>
        Cuando pidas a Claude que busque pasajes que apoyen o contradigan una ficha, lo
        que encuentre aparece en{' '}
        <Link href="/notes?filter=proposals" className="text-accent hover:underline">Propuestas</Link>,
        aparte de tus notas. Nada entra a tu mapa hasta que lo apruebes. Aprobar es un
        botón; rechazar la esconde, y puedes reconsiderarla después desde la lista de
        rechazadas. Una propuesta aprobada queda marcada para siempre como encontrada
        por Claude y confirmada por ti.
      </p>

      <H>Lo que no tienes que hacer</H>
      <p>
        No tienes que clasificar el tipo de relación entre nota y obra, ni decidir qué
        es nodo y qué es enlace, ni pensar en el mapa. El mapa se dibuja solo a partir
        de lo anterior.
      </p>

      <H>Antes del examen</H>
      <p>
        En <Link href="/notes" className="text-accent hover:underline">Notes</Link> hay
        una fila de revisión con tres listas: notas donde no dijiste de quién es la
        afirmación, afirmaciones del autor sin cita detrás, y propuestas de Claude sin
        revisar. Las tres deberían estar en cero.
      </p>
    </div>
  );
}
