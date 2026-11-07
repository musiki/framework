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
