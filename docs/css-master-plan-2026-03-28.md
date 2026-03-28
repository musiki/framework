# CSS Master Plan

Fecha: 2026-03-28

## Propósito

Este plan define una gramática visual común para Musiki.

No busca volver el sitio más genérico.
Busca volverlo más coherente, más enseñable y más portable entre proyectos.

Musiki no es sólo un LMS. También es una herramienta pedagógica. Por eso la interfaz tiene que enseñar con el ejemplo.

## Idea central

La UI debe minimizar la energía cognitiva necesaria para aprender una herramienta compleja.

En estos términos:

- `affordance` es la capacidad de la interfaz para sugerir su uso antes de explicarlo
- `ruido visual` es toda decisión que obliga a pensar sin aportar sentido
- `anti-ruido` es toda decisión que reduce duda, ordena la atención y vuelve visible la lógica del sistema
- `well-being UI` es cuando esa claridad además se siente calma, estable, respirable y sostenible en el tiempo

## Principio pedagógico

Como las materias del LMS enseñan diseño, interfaz y pensamiento visual, el sitio debe enseñar con su propio comportamiento.

La plataforma debería poder mostrar en la práctica:

- affordance
- jerarquía visual
- folding
- austeridad de labels
- sistemas de color
- motion significativo
- responsive real
- consistencia modular

## Ruido visual

Se considera ruido visual a:

- espacios sin sentido funcional
- dobles bordes o multilíneas que no agregan información
- tipografías desordenadas
- paddings arbitrarios, excesivos o insuficientes
- paletas de color sin semántica real
- fondos decorativos que compiten con el contenido
- hovers que sólo ornamentan
- variaciones caprichosas entre paneles equivalentes
- controles visibles al mismo tiempo aunque no se necesiten

## Anti-ruido

Se considera anti-ruido a:

- estructura wireframe
- fondos mínimos, con como máximo uno o dos planos dominantes
- sistema de variables globales para color, spacing y estados
- labels austeros y consistentes
- affordances visibles pero no gritados
- foldables y sidebars como norma
- motion corto y útil
- ocultamiento progresivo de complejidad
- hover como revelación, no como adorno
- composición modular por dominios

## Affordance

Affordance no significa llenar la UI de pistas obvias.
Significa que la herramienta sugiera su uso con el mínimo ruido posible.

Una buena affordance en Musiki debería cumplir estas condiciones:

- una acción importante se reconoce rápido
- una acción secundaria no contamina el plano principal
- lo esencial aparece primero
- lo avanzado se descubre sin romper la concentración
- la repetición de patrones enseña el sistema

Ejemplos deseables:

- botones mínimos que revelan más información en hover
- labels cortos o de una letra cuando el patrón ya fue enseñado
- paneles foldables para comprimir complejidad
- colores semánticos repetidos con disciplina
- módulos visuales que siempre conservan estructura comparable

## Well-being

La interfaz debe sentirse usable, estable y no agotadora.

Eso implica:

- bajo estrés visual
- ritmo espacial consistente
- contrastes medidos
- movimiento suave
- jerarquía clara
- estados previsibles
- posibilidad de esconder complejidad

El well-being no depende de “poner round a todo”.
Depende de decidir dónde hay suavidad y dónde hay precisión.

## Dos dialectos, un mismo lenguaje

Musiki puede tener dos grandes familias visuales:

- `LMS`
- `ROOM`

No deben ser mundos separados.
Deben ser dos dialectos del mismo lenguaje.

### LMS

- más editorial
- más aire
- algunos radios y rounds
- más confort visual
- mayor presencia de lectura, navegación y gestión

### ROOM

- más seca
- más técnica
- más wireframe
- dark mode estructural
- casi sin round
- más densidad de herramienta y señal

### Lo compartido

Ambos dialectos deben compartir:

- tokens
- escala espacial
- sistema de estados
- affordance
- folding
- motion
- responsive law
- semántica de color

## Sistema de tokens

### Colores

Debe existir un sistema global configurable por variables.

Base mínima:

- `--accent-color`
- `--second-color`
- `--third-color`

Y además una capa semántica:

- `--color-bg`
- `--color-bg-alt`
- `--color-fg`
- `--color-muted`
- `--color-line`
- `--color-success`
- `--color-danger`
- `--color-warn`
- `--color-focus`

Regla:

- primero color semántico
- después mapping de palette

No diseñar componentes contra hexadecimales aislados.

### Espaciado

Definir una escala corta y disciplinada.

Por ejemplo:

- `--space-1`
- `--space-2`
- `--space-3`
- `--space-4`
- `--space-5`
- `--space-6`

Regla:

- evitar paddings “a ojo”
- evitar saltos arbitrarios entre módulos hermanos

### Tipografía

Definir una jerarquía corta:

- caption
- body
- ui
- title
- display si hiciera falta

Regla:

- pocas tallas
- pocos pesos
- labels estables
- evitar mezclar demasiadas familias o intensidades

### Bordes y radios

Definir tokens explícitos:

- `--radius-none`
- `--radius-sm`
- `--radius-md`
- `--border-soft`
- `--border-strong`

Regla:

- `ROOM` puede usar `radius-none` como base
- `LMS` puede usar radios suaves
- no usar round indiscriminadamente

## Gramática visual

### Reglas de composición

- cada panel debe tener una estructura reconocible
- cada módulo debe poder compararse con sus pares
- cada heading debe enseñar su affordance
- cada acción secundaria debe vivir en el segundo plano

### Reglas de heading

- headings austeros
- consistentes en tamaño, ritmo y casing
- con affordance clara si el bloque es foldable

### Reglas de acción

- acción primaria visible
- acción secundaria compacta
- hover para revelar texto adicional o contexto
- no más de una lógica de reset por familia de controles

### Reglas de controles

- knobs, sliders, pans y buses deben compartir familia
- color debe comunicar función
- tamaños deben expresar jerarquía
- ocultar complejidad cuando no sea necesaria

### Reglas de estados

Todo componente importante debe contemplar:

- default
- hover
- focus
- active
- muted
- disabled
- offline
- loading
- warning

## Folding como norma

Los paneles foldables no son opcionales. Son una regla central del sistema.

Razón:

- comprimen complejidad
- mejoran foco
- enseñan estructura
- sostienen escalabilidad

Esto aplica a:

- sidebars
- módulos
- paneles de setup
- grupos avanzados
- herramientas secundarias

## Hovers y revelación

El hover debe revelar, no decorar.

Puede servir para:

- expandir una sigla
- mostrar nombre completo
- revelar una acción secundaria
- anticipar el resultado de una acción
- mostrar metadata sin ensuciar el plano principal

No debería usarse para:

- mover cosas sin sentido
- añadir color gratuito
- competir con el contenido principal

## Austeridad verbal

Las etiquetas pueden ser extremadamente austeras si el sistema ya enseñó el patrón.

Eso habilita:

- letras únicas
- siglas
- labels mínimos
- barras compactas

Pero la austeridad exige consistencia.
Si el patrón no está consolidado, la austeridad se vuelve ambigüedad.

## Motion

La animación debe ayudar al entendimiento y al bienestar.

Reglas:

- transiciones cortas
- easing suave
- apariciones y desapariciones previsibles
- dropdowns y foldables con motion medido
- nada de microanimación permanente que fatigue

La motion debe comunicar:

- apertura
- cierre
- cambio de estado
- prioridad
- foco

## Responsive law

La responsive no es una adaptación secundaria.
Es una condición estructural del sistema.

El sitio debe seguir siendo usable, legible y eficiente en cualquier pantalla.

Caso extremo de referencia:

- `500x3560px`
- teléfono barato
- estudiante
- red o hardware limitados

### Reglas de responsive

- cada pantalla debe priorizar uso real, no réplica miniaturizada del desktop
- la complejidad debe colapsar bien
- los paneles deben poder esconderse o reordenarse
- los targets táctiles deben seguir siendo viables
- no depender de hover para la operación básica
- el flujo crítico siempre debe seguir disponible

## Estructura CSS

La estructura de CSS debe seguir dominios del producto y obedecer la taxonomía ya definida.

### Componentes

- `components/room/core`
- `components/room/generators`
- `components/room/processors`
- `components/room/mixing`
- `components/room/stage`
- `components/room/panels`
- `components/room/overlays`

### Estilos

Cada dominio puede tener su CSS propio, pero gobernado por un plan común.

Regla:

- no partir CSS por partir
- no repartir inconsistencia
- primero gramática
- luego extracción

## Snippets

El design system no tiene que convertirse en una colección infinita de microarchivos.

Puede apoyarse en snippets.

Cada snippet debería:

- encapsular un patrón real
- llevar una línea breve de comentario
- etiquetar tecnología o pattern
- no sobreactuar abstracción

## Priorización de implementación

1. Fijar tokens compartidos.
2. Fijar reglas de affordance y anti-ruido.
3. Fijar gramática de paneles, headings, actions y controls.
4. Terminar de partir `ROOM` siguiendo esa gramática.
5. Trasladar la misma lógica al `LMS`.
6. Recién después podar estilos redundantes o legacy.

## Checklist operativo

Antes de aprobar cualquier UI nueva, preguntar:

- ¿reduce energía cognitiva o la aumenta?
- ¿agrega ruido?
- ¿usa tokens reales?
- ¿respeta el sistema de color?
- ¿respeta la escala espacial?
- ¿enseña el patrón con el ejemplo?
- ¿es foldable o comprimible si hace falta?
- ¿funciona en mobile extremo?
- ¿su hover revela algo útil?
- ¿su motion comunica o distrae?

## Resultado buscado

El objetivo no es sólo “verse mejor”.

El objetivo es que Musiki:

- enseñe con su forma
- escale sin fragilidad visual
- permita mover módulos entre proyectos
- reduzca ruido
- aumente claridad
- y sostenga una sensación de bienestar incluso en herramientas densas y complejas
