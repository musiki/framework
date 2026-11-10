# Itinerario, taxonomía y progreso

Plan de maduración para la relación entre `chapter`, las carpetas, el árbol lateral y Progreso.
Escrito antes de tocar código, a pedido.

## 1. Lo que hay hoy, verificado en el código

Hay **tres** maneras simultáneas de organizar el mismo material, y ninguna manda sobre las otras.

**La carpeta del repo.** Es lo que el docente ve en Obsidian. Es la verdad para el contenido que viene de git.

**El campo `chapter`.** Para el contenido de repo no se escribe: se calcula al ensamblar.
`scripts/assemble-content.mjs:240` hace `extra.chapter = relParts.slice(1, -1).join('/')`.
O sea: `chapter` *es* la carpeta, derivada en build. Para las notas de base de datos, en
cambio, `chapter` es un campo real y editable.

**Los capítulos del sistema, con su convención numérica escondida en TypeScript.** Esto es
lo que explica el síntoma concreto y es más profundo de lo que parecía. En
`src/scripts/course/sidebar/notes-sidebar.ts` hay dos reglas que no están escritas en
ningún lado salvo en el código de la UI.

Primero, cuatro nombres tienen comportamiento especial (línea 601):

```ts
const isGlobal = chapter.toUpperCase().includes('CONCEPTOS')
  || chapter.toUpperCase().includes('INSTRUMENTOS')
  || chapter.toUpperCase().includes('SPEAKERS')
  || chapter.toUpperCase().includes('GLOSARIO');
```

Segundo, y más fuerte: **el número 70 es un umbral semántico** (línea ~290). Todo capítulo
cuyo prefijo numérico sea 70 o mayor se trata como «sistema o global» a la hora de ordenar:

```ts
const isSystemOrGlobal = (fallbackFromTitle !== null && fallbackFromTitle >= 70) || ...
```

Y hay capítulos virtuales que la sidebar inyecta si no existen: `80 RECURSOS`,
`90 NOTAS`, y `85 AMIGX CRÍTICX` sólo cuando `courseId === 's123'`.

Así que *70 Conceptos* y *71 Glosario* no son carpetas de s123: son el resultado de una
convención numérica implícita más nombres reservados en la UI. El vault puede reorganizarse
entero y esos capítulos van a seguir apareciendo, porque no salen del contenido.

A eso se suma que **`public/` es un namespace compartido entre todas las materias**: el
ensamblado vuelca el `public/` de i1, i2, cym, s123 e internetmusic en un solo árbol,
`src/content/public/`, donde hoy conviven `conceptos` —con notas de `project: cym`—,
`glosario`, `MIM`, `concepts`, `events`, `people` y `personas`.

No pude confirmar el origen exacto de cada capítulo que ves porque i1, i2 y cym no están
clonados en esta máquina; lo verificable es la convención, que alcanza para explicarlo.

Dos cosas que **sí** funcionan y conviene no reescribir: arrastrar entre capítulos ya está
implementado (`text/x-musiki-course-chapter`, con sus drop lines y el caso `crossChapter`),
y las notas en `draft` ya se renderizan con badge para quien puede gestionar
(`notes-sidebar.ts:387`, `[...slug].astro:66`).

## 2. El problema, en una oración

`chapter` es un valor derivado que además se puede editar: la carpeta lo calcula y el árbol
lo sobrescribe, y como son dos fuentes de verdad para el mismo campo, la reciprocidad que
pedimos no se puede resolver sincronizándolas.

El corolario pedagógico es el que ya intuías: cuando la carpeta es la unidad pedagógica, la
estructura del conocimiento queda congelada en el filesystem. *Conceptos* y *Glosario* como
carpetas no son temas, son tipos de nota; nadie entra ahí a buscar algo.

## 3. Qué hacen otros

**Moodle.** Curso → secciones → actividades. La sección es un objeto de primera clase: tiene
nombre, resumen, condiciones de disponibilidad y orden. No se deriva de ninguna ruta de
archivos. El *course index* es un cajón lateral que lista secciones y actividades, resalta
dónde estás mientras scrolleás, y permite arrastrar tanto desde el índice como desde el
centro. Lo que hay que robar: **la sección como contenedor con identidad propia, separada
del archivo**.

**Duolingo.** No hay taxonomía navegable. Hay un camino: unidades en secuencia, y los temas
se introducen sobre la marcha en vez de ofrecerse en una tabla. El conocimiento se modela
como habilidades con decaimiento, y lo que se ve no es un índice sino lo que toca hacer
ahora y lo que conviene repasar. Lo que hay que robar: **la materia como recorrido**, y que
el estado del alumno sea sobre conceptos, no sobre ítems tildados.

**Obsidian y el zettelkasten.** Las carpetas son comodidad, no estructura. La organización
emerge de los enlaces y de los MOC. Lo que hay que robar: **los índices se generan, no se
guardan** — que es exactamente lo que dijiste sobre Glosario y Conceptos.

**Notion, Airtable.** Un solo almacén y muchas vistas. Lo que hay que robar: **una nota vive
en un lugar y aparece en muchas listas**.

Lo que **no** hay que robar: de Moodle, la rigidez de que todo cuelgue de una sección y nada
exista fuera; de Duolingo, la opacidad —un posgrado necesita poder ver el mapa completo, no
sólo el próximo paso.

## 4. La propuesta: separar almacenamiento, taxonomía e itinerario

Tres capas que hoy están colapsadas en una.

| Capa | Qué es | Quién manda | Cambia |
|---|---|---|---|
| **Almacenamiento** | dónde vive el archivo: `public/20-densidad-decisional/timbre.md` | la carpeta del repo | casi nunca |
| **Taxonomía** | de qué trata: área, tags, `hypo`/`hyper`/`connect` | el frontmatter de la nota | cuando madura el concepto |
| **Itinerario** | el recorrido de la cursada: qué se ve y en qué orden | el docente, arrastrando | todo el tiempo |

La carpeta deja de tener significado pedagógico. Es archivo: estable, aburrida, agrupada por
área temática y nada más. El itinerario pasa a ser un objeto propio —una lista ordenada de
paradas que referencian notas— y es lo único que se arrastra a diario.

*Conceptos* y *Glosario* dejan de ser carpetas y pasan a ser **vistas generadas**: páginas
que listan todo lo que tiene `type: concept` o `type: glossary` en la materia, ordenado como
convenga. Eso resuelve de una el problema de los nombres hardcodeados en la UI y el de las
carpetas que nadie visita.

### Qué pasa con `chapter`

`chapter` se convierte en **la parada del itinerario**, y deja de derivarse de la carpeta.

La transición es suave porque admite un default: si la nota no declara `chapter` en su
frontmatter, se sigue usando la carpeta como hoy. Si lo declara, gana el frontmatter. Así
nada se rompe el día uno y las materias migran cuando quieren.

Eso además responde el pedido de reciprocidad, pero no como lo planteamos. Sincronizar
carpeta y capítulo es sincronizar dos verdades; lo que corresponde es que sean independientes
y que el arrastre escriba `chapter` en el frontmatter vía la API de publicación —que ya sabe
commitear con autor y fecha. Mover el archivo de carpeta queda como una acción aparte, poco
frecuente y explícita.

Decisión que conviene tomar con los ojos abiertos: esto significa que **el árbol de musiki y
el árbol de Obsidian dejan de coincidir**. Hoy coinciden porque chapter = carpeta. Mañana
Obsidian muestra el archivo y musiki muestra el recorrido. Creo que es correcto —son dos
preguntas distintas, "dónde está" y "cuándo se ve"— pero es un cambio de modelo mental y hay
que quererlo.

### Progreso

Hoy Progreso es una tabla de comprobación. La propuesta es que sea la proyección del alumno
sobre el itinerario, con dos ejes que ya existen por separado:

- **Avance**: dónde está en el recorrido, qué viene, qué se saltó.
- **Retención**: cómo están los conceptos que ya tocó, con la repetición espaciada que ya
  está especificada en `EVALUATION.md`.

La diferencia con el checklist es que el segundo eje no se completa nunca: decae. Eso es lo
que convierte la materia en recorrido en vez de lista, y es lo que hace Duolingo.

## 5. Los tres pedidos, ubicados

**Sidebar Info editable con dropdowns.** Es la pieza más barata y la más útil, y no depende
de nada de lo anterior. Se hace ya. El editor abre y el panel derecho se abre con él,
mostrando los campos del frontmatter con el control que corresponda a cada uno: select para
`type` y `status`, chips para `tags`, autocompletado contra las notas existentes para
`hypo`/`hyper`/`connect`, texto para `def`. Guarda por la API de publicación que ya existe.
Mejor que un CMS externo porque los valores posibles salen de la materia misma.

**Carpeta ↔ capítulo recíproco.** Se reformula como está arriba: `chapter` explícito gana
sobre la carpeta, y el arrastre lo escribe. La mitad que ya funciona —arrastrar entre
capítulos— se conserva.

**Ver las notas en draft.** Es un bug de datos, no de permisos: el código ya las muestra con
badge. Lo que ves viejo es el ensamblado, que todavía tiene la estructura previa de s123.
Hay que verificar que el sync corrió después del push y que el assemble limpia el destino en
vez de copiar encima. Es lo primero a revisar y es independiente del resto.

## 6. Plan por etapas

**Etapa 0 · destrabar.** El assemble sí limpia el destino —`prepDir` hace `rmSync` antes de
copiar—, así que lo que ves viejo es que no corrió desde la reorganización: hay que
sincronizar y mirar de nuevo. Después, sacar la convención del 70 y los nombres reservados
de la UI, y filtrar el árbol por `project` para que s123 deje de ver las carpetas de cym.
Sin esto no podés evaluar nada de lo que sigue, porque lo que mirás no es tu contenido.

**Etapa 1 · panel Info editable.** Autónoma, visible, sin migración. Da el editor de YAML que
queríamos y deja de depender de ideas externas.

**Etapa 2 · `chapter` explícito.** El frontmatter gana sobre la carpeta cuando está presente.
El arrastre escribe. Nada se rompe para quien no lo use.

**Etapa 3 · índices generados.** *Conceptos* y *Glosario* pasan de carpeta a vista. Se sacan
los cuatro nombres hardcodeados de `notes-sidebar.ts`.

**Etapa 4 · itinerario como objeto.** La parada deja de ser un string y pasa a ser una
entidad con nombre, orden y estado. Acá recién aparece el modelo Moodle completo.

**Etapa 5 · Progreso como recorrido.** Avance más retención, sobre el itinerario de la etapa 4.

Las etapas 0 a 3 son semanas. La 4 y la 5 son un cuatrimestre y conviene no empezarlas hasta
que las primeras estén en uso real.

## 7. Dónde puede salir mal

El riesgo mayor no es técnico. Es que un sistema de tres capas es más difícil de explicar que
uno de carpetas, y el año pasado ya aprendimos qué pasa cuando se introduce complejidad más
rápido de lo que el contexto la absorbe. Mitigación: las etapas 0 a 3 no cambian nada para
quien no las use, y la 4 no se empieza sin haber usado la 2 durante un cuatrimestre entero.

El segundo riesgo es la divergencia entre el árbol de Obsidian y el de musiki. Si resulta
desorientadora, la salida es mostrar la ruta del archivo en el panel Info, para que siempre
se pueda contestar "¿dónde está esto en el vault?".

El tercero es que el itinerario se vuelva otra tabla de comprobación con otro nombre. La
prueba para saber si funcionó: si al final del cuatrimestre Progreso se puede leer como un
relato de lo que pasó, funcionó; si se lee como una planilla de tildes, no.

---

# Parte 2 · después de la conversación

Lo que sigue incorpora las decisiones tomadas y agrega lo que apareció al discutirlas.

## 8. El principio que ordena todo: la gradiente de durabilidad

La observación que resuelve el diseño es esta: **una clase es un ensamblaje de notas
atómicas más algo de contenido propio, y es lo más cambiable de todo**. Depende del momento
de la cursada, de la cohorte, del contexto. Un concepto, en cambio, puede sobrevivir años
sin mutar.

Eso no es una anécdota: es un criterio de arquitectura. Cada cosa tiene una vida media
distinta y debería tratarse distinto.

| Qué | Vida media | Se versiona | Vive en |
|---|---|---|---|
| Concepto, glosario | años | poco | `public/`, compartido |
| Protocolo, metodología | varios cuatrimestres | a veces | `public/`, por materia |
| Clase | una cohorte | cada vez | `cursos/<id>/`, efímero |
| Assignment | una cohorte, con historia | sí | itinerario |
| Output del estudiante | atado a su cohorte | archivo | fuera del repo |

La consecuencia práctica: **lo que más se edita debería ser lo más liviano de editar, y lo
que más dura debería ser lo más difícil de romper**. Hoy es al revés: cambiar una clase
implica mover archivos y recalcular capítulos, mientras que un concepto se edita sin ningún
control de que siga siendo coherente con los que lo citan.

## 9. Progreso como superficie de composición

Progreso pasa a ser el índice maestro: el docente arma ahí el recorrido al principio de la
cursada, arrastrando y combinando conceptos, assignments, outputs y protocolos, cada uno con
su color e ícono.

**Una estructura, dos vistas, nunca dos significados.** El docente ve la composición: qué
hay, en qué orden, qué falta. El estudiante ve su posición sobre esa misma estructura. Es el
mismo objeto renderizado distinto, no dos objetos.

Y acá va la advertencia que corresponde hacer. En 2026 el problema no fue la rúbrica: fue
que un solo instrumento hacía de guía formativa y de mecanismo sancionatorio a la vez. Si
Progreso se vuelve además la superficie donde se califica, volvemos exactamente ahí. Progreso
muestra recorrido y retención; la nota vive en otro lado y se conversa en otro momento.

### Los kinds, con su ícono

El inventario real del contenido tiene unos diecisiete valores de `type` en uso —`concept`,
`glossary`, `lesson`, `person`, `obra`, `work`, `technology`, `note`, `info`, `course`,
`service`, `proyecto`, `imc`, `hemworks`, `latex-template`, `art_process`,
`lilypond_recipe`— y al menos uno escrito mal (`type: concept | glossary`, copiado literal
de la documentación del MANUAL; ya corregido en s123).

Para la UI no hacen falta diecisiete íconos. Hacen falta cinco **kinds**, y el resto queda
como subtipo:

| Kind | Agrupa | Qué es para el estudiante |
|---|---|---|
| Concepto | `concept`, `glossary` | algo que hay que entender y retener |
| Protocolo | `info`, `note`, métodos | cómo se hace algo |
| Clase | `lesson` | un encuentro, con su fecha |
| Assignment | `assignment`, evaluaciones | algo que hay que entregar |
| Output | `obra`, `work`, `proyecto` | algo que se produjo |

El resto —`person`, `technology`, `service`, `latex-template`, `lilypond_recipe`— son
recursos de apoyo y no necesitan estar en el itinerario.

## 10. El reservorio: por qué no debería ser un `status`

La idea de que una clase salga del recorrido pero quede en preparación es correcta. La
implementación como `status: idle` no, y conviene decirlo antes de que se escriba.

`status` ya mezcla cosas (`draft`, `published`, `nonshown`, `public`, `inprocess`). Agregarle
`idle` sumaría una tercera dimensión al mismo campo, porque **el estado editorial y la
pertenencia al itinerario son ortogonales**: una clase puede estar terminada y fuera del
recorrido de este cuatrimestre, y una clase en borrador puede estar adentro porque se da la
semana que viene.

Si el itinerario es un objeto de primera clase —una lista ordenada de paradas que referencian
notas—, entonces **el reservorio no necesita ningún campo**: es el complemento. Todo lo que
la materia tiene y el itinerario de este cuatrimestre no referencia. Un cajón en la UI sobre
un conjunto que ya existe, sin estado nuevo que mantener sincronizado.

Ventaja secundaria: el itinerario del cuatrimestre pasado queda como objeto completo. Se
puede duplicar para armar el siguiente, que es exactamente lo que un docente quiere hacer en
marzo.

## 11. `public/` y el grafo: lo que hay que revisar es el tipo de arista

Que `public/` sea la fuente de conocimiento común a todo musiki está bien y conviene
conservarlo. Lo que no está bien es que la pertenencia sea implícita y que la UI la resuelva
con nombres reservados.

Sobre el grafo universal hay una cosa que revisar y es más de fondo que el filtrado. Hoy
conviven relaciones de naturaleza distinta y el grafo las dibuja igual:

- `hyper` / `hypo` son **semánticas**: hiperonimia e hiponimia, género y especie.
- `connect` es **lateral declarada**: el autor dice que dos cosas se tocan.
- La carpeta es **estructural**: dónde está el archivo.
- El wikilink en el cuerpo es **referencial**: lo nombré al pasar.

Si las cuatro producen la misma arista, la cercanía en el grafo no significa nada, y un grafo
donde la cercanía no significa nada es un adorno. **Las aristas tienen que ser tipadas y
filtrables**: ver sólo la jerarquía semántica, o sólo lo lateral, o todo. Es lo que separa un
grafo que se usa de uno que se mira una vez.

Segundo punto a revisar: hoy `hyper` suele apuntar al nombre de la carpeta —lo vimos en s123,
donde varias notas tenían `hyper: [[timbre-orquestacion]]`, que no era una nota sino un
directorio. Si la carpeta deja de ser pedagógica, esos enlaces tienen que apuntar a conceptos
reales o desaparecer.

## 12. Plan revisado

Las etapas 0 a 3 quedan como estaban. Se precisan las dos últimas:

**Etapa 4 · itinerario como objeto.** La parada deja de ser un string y pasa a ser una
entidad con nombre, orden, kind y referencia a la nota. El reservorio aparece solo, como
complemento. El itinerario se puede duplicar de un cuatrimestre al siguiente.

**Etapa 5 · Progreso como composición y recorrido.** Vista docente para armar, vista
estudiante para ubicarse. Avance sobre el itinerario, retención sobre los conceptos.

**Etapa 6 · aristas tipadas en el grafo.** Separar jerarquía semántica, lateral, estructural
y referencial. Filtros por tipo de arista. Limpiar los `hyper` que apuntan a carpetas.

El orden importa: la 6 depende de que la carpeta haya dejado de significar algo, o sea de la 2.

---

# Parte 3 · revisión del 2026-11-10, después de 47 commits

## 13. Dónde quedó cada etapa, verificado en el código

**Etapa 0 · a medias.** `8bc74dd` juntó la convención en un solo objeto,
`CHAPTER_CONVENTION` (`notes-sidebar-utils.mjs`), pero no la sacó: el umbral 70 y los
cuatro nombres reservados siguen ahí, ahora en un lugar en vez de cinco. Además
`[...slug].astro` tiene su propia copia para el árbol de estudiantes (`80-recursos`,
`85 AMIGX CRÍTICX`, `90-notas`, el `if s123`), que la etapa 0 no tocó. El filtro del
árbol por `project` no está hecho.

**Etapa 1 · hecha en lo esencial.** `f24a1bb` (esquema `note-metadata-schema.mjs`),
`94f79bd` y `3c40a42`: las propiedades se editan en el pod Info, en la misma lista,
como en Obsidian, y se guardan con js-yaml. Falta verificarla en uso real.

**Etapas 2 a 6 · sin empezar.**

**Lo que apareció en el medio y toca este plan:**

- **Cohortes** (`a058ce1`, `365ce3c`): tabla `Cohort` con una activa por materia y
  `cohortId` en `Enrollment`. Es la pieza que faltaba para que el itinerario sea
  *de una cohorte* y se duplique a la siguiente (sección 10).
- **Servicios con nota de concepto** (`81801a9`): la lista de rutas de servicios
  (`scripts/content/service-routes.json`) es el primer caso de configuración por
  materia sacada del código. Es el formato al que tiene que ir `CHAPTER_CONVENTION`.
- **Validador global** (`cfc4c44` y siguientes): ya frena pushes por slugs, tags y
  enlaces. Es donde se valida un itinerario cuando exista.

## 14. Lo que muestra Progreso hoy, y por qué es el caos

Hay dos «progresos» que no se hablan:

- **El bloque «Progreso» de la sidebar izquierda** (`#page-progress`) lista las
  evaluaciones de la página. Se arma una vez por carga, a partir del DOM, y no
  sigue a la nota activa de Dockview: cambiás de nota y sigue mostrando la de fondo.
  Visualmente es un capítulo más del árbol, cuando es otra cosa.
- **El pod Progreso de la derecha** (`CourseProgressPod.astro`, `/api/progress/pod`)
  arma las «unidades» con `unitForNode`, o sea **desde la carpeta de cada nota**:
  bottom-up puro. Y trae una rúbrica fija en código,
  `REQUIRED = { proyecto: 1, conexiones: 5, coloquios: 2, estigmergia: 1, aporte: 1 }`.

Lo segundo es justo lo que la sección 9 advertía: un contador de requisitos en la
misma superficie que el recorrido es el instrumento doble —guía formativa y mecanismo
sancionatorio— que falló en 2026. Hay que decidir si se queda.

## 15. La reconsideración: el itinerario va antes que `chapter`

El plan original decía no empezar la etapa 4 sin haber usado la 2 un cuatrimestre.
Pido revisar eso, porque el pedido de hoy —que el docente arme el árbol *top-down* en
Progreso— cambia el razonamiento:

Si el itinerario vive en Progreso como objeto propio, **el árbol de la izquierda puede
quedarse como archivo** (la carpeta, como en Obsidian) y no hace falta que `chapter`
signifique nada pedagógico. La etapa 2 existía para que el árbol pudiera expresar el
recorrido; si el recorrido tiene su lugar, la 2 pierde razón de ser, y con ella el
riesgo mayor de la sección 7 —que el árbol de musiki y el de Obsidian dejen de
coincidir—. Quedan dos superficies con dos preguntas distintas: la izquierda contesta
«dónde está», Progreso contesta «cuándo y para qué».

Es un modelo más simple de explicar que «chapter explícito que gana sobre la carpeta»,
y por eso creo que el adelanto es razonable y no es meter complejidad antes de tiempo.

## 16. Plan revisado

**Paso A · la nota activa en Progreso.** Sacar `#page-progress` de la izquierda. En
el pod Progreso, arriba, un bloque visualmente distinto —«En esta nota»— con lo que
se evalúa en la nota que estás leyendo: sigue a `musiki:active-note`, se recalcula al
cambiar de panel y al entregar. Chico, sin modelo nuevo, arregla el bug de hoy.

**Paso B · itinerario como objeto, mínimo, por cohorte.** Etapa 4 adelantada y
recortada: una lista ordenada de paradas, cada una con nombre, kind (los cinco de la
sección 9) y referencias a notas. Pertenece a una cohorte; al abrir una cohorte nueva
se ofrece duplicar la anterior. El docente lo arma en Progreso arrastrando notas desde
el árbol de la izquierda o buscándolas. El reservorio es el complemento, sin campo.

**Paso C · el estudiante se ubica sobre el itinerario.** El pod deja de derivar
unidades de la carpeta cuando hay itinerario (sin itinerario, queda como hoy). Avance
sobre las paradas; la retención por concepto viene después, con SRS (`SrsState` ya
existe en la base).

**Paso D · terminar la etapa 0.** `CHAPTER_CONVENTION` y la copia de `[...slug].astro`
pasan a configuración por materia, con el formato de `service-routes.json`. Filtro
por `project`.

**Etapas 3 y 6 siguen como estaban.** La 3 (índices generados) se vuelve más fácil
con el itinerario: Conceptos es «los `type: concept` de la materia», no una carpeta.
La 6 dependía de la 2; ahora depende de que el árbol se acepte como archivo.

**Etapa 2 · en suspenso.** Se retoma sólo si, usando el itinerario, el árbol de la
izquierda sigue necesitando expresar recorrido.

## 17. Decisiones que tiene que tomar una persona

1. **Dónde vive el itinerario.** En la base, por cohorte (se edita desde la UI, se
   duplica con un click, no aparece en Obsidian), o como archivo en el repo de la
   materia, `cursos/<id>/itinerario-<cohorte>.yaml`, escrito por la UI con la API de
   publicación (versionado, legible en Obsidian, pero un commit por cada arrastre).
2. **La rúbrica fija del pod.** Si el contador `REQUIRED` se queda en Progreso, se
   va a otro lado (la nota se conversa en otro momento, sección 9), o se vuelve parte
   del itinerario como paradas de kind Assignment.
3. **Qué ve el estudiante al principio.** Sólo su posición sobre el itinerario, o
   también el mapa completo (la advertencia sobre Duolingo, sección 3).

## 18. Decisiones tomadas (2026-11-10)

**El principio: Obsidian genera conocimiento, musiki ordena la clase.** Todo lo que es
acción en clase —agenda, asistencia, calificaciones, y ahora el itinerario— vive en
musiki, en la base. Obsidian es donde se escribe el contenido. Es el mismo criterio
que la gradiente de durabilidad (sección 8): lo durable en el repo, lo del día a día
en la base.

1. **El itinerario vive en la base, por cohorte.** No es un archivo del repo.
2. **La rúbrica fija pasa a «En esta nota»**, arriba del pod Progreso: cada
   evaluación de la nota activa muestra a qué requisito suma, y la rúbrica completa
   queda debajo con esos requisitos resaltados. Trazabilidad de la nota activa sobre
   el mapa total, sin una superficie aparte de requisitos.
3. **El estudiante ve el mapa completo, con todo lo que no es su posición en muted.**
   Un ícono alterna con una vista plegada que muestra sólo el lugar actual y sus
   vecinos.

Además: **el árbol de la sidebar izquierda arranca plegado** y recuerda, por persona y
por materia, lo que cada uno dejó abierto (localStorage), más el camino a la nota activa.
