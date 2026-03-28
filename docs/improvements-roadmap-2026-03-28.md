# Improvements Roadmap

Fecha: 2026-03-28

## Prioridad actual

Las prioridades activas son:

- 3. Partir los archivos grandes antes de seguir agregando features.
- 4. Definir una gramática visual estable para toda la UI performativa.

Estas dos prioridades se potencian entre sí: si la UI se vuelve más consistente pero sigue viviendo en archivos gigantes, cuesta sostenerla; si los archivos se parten sin una gramática clara, sólo se distribuye el desorden.

## Principio estructural

La estructura de carpetas debe seguir dominios del producto, no categorías técnicas genéricas.

- Mejor `generators/fm-synth` que `components/sliders`.
- Mejor `processors/video` que `ui/controls/video`.
- Mejor `mixing/channel-strip` que `common/widgets`.

Esto es importante por tres motivos:

- ordena el proyecto según la lógica real del instrumento
- facilita replicar la arquitectura en otros proyectos
- permite mover o importar módulos entre repositorios sin rehacer todo desde cero

La idea no es multiplicar archivos pequeños porque sí. La meta es que cada carpeta represente una unidad conceptual exportable.

## Design system austero

El design system no necesita transformarse en una colección infinita de archivitos.

- Puede apoyarse en snippets y patrones reutilizables.
- Cada snippet debería llevar una línea breve de comentario, más de etiquetado que de explicación extensa.
- La prioridad es documentar tecnología y pattern, no narrar lo obvio.
- La gramática visual tiene que ser portable sin obligar a una abstracción prematura.

En otras palabras: primero patrón reusable, luego snippet claro, y sólo después componente o módulo formal si el uso repetido realmente lo justifica.

## Roadmap de folders

### Regla madre

Primero se define la taxonomía de dominios. Después se parten archivos siguiendo esa taxonomía. No al revés.

### Estructura objetivo para la room

```text
src/
  components/
    room/
      core/
      generators/
        fm-synth/
        gravity-ball/
      processors/
        audio/
          fx/
        video/
      mixing/
        mixer/
        channel-strip/
      stage/
      panels/
      overlays/
      snippets/

  scripts/
    room/
      core/
      generators/
        fm-synth/
        gravity-ball/
      processors/
        audio/
        video/
      mixing/
      layout/
      participants/
      session/
      snippets/
```

### Significado de cada dominio

- `core`: shell, bootstrap, contratos base, utilidades mínimas realmente compartidas.
- `generators`: módulos que generan materia performativa, como `FM SYNTH` y `GRAVITY BALL`.
- `processors/audio`: efectos y procesos aplicados al audio.
- `processors/video`: procesos aplicados a imagen y cámara.
- `mixing`: mixer, channel strips, sends, master y lógica de enrutamiento visible.
- `stage`: escena principal, layouts y superficies de presentación.
- `panels`: chat, controles de sesión, invites, break rooms y paneles secundarios.
- `overlays`: capas visuales superpuestas como hand overlay, gravity overlay, reactions y recording guide.
- `snippets`: patrones pequeños, reutilizables y bien etiquetados, sin forzar una abstracción mayor antes de tiempo.

### Regla de portabilidad

Si un módulo se quisiera mover a otro proyecto, debería poder copiarse por carpeta de dominio con el menor número posible de dependencias ocultas.

Ejemplos deseables:

- `generators/fm-synth` debería viajar como bloque.
- `processors/video` debería crecer sin contaminar `mixing`.
- `mixing/channel-strip` debería poder replicarse en otra app audiovisual.

### Regla de dependencia

- `core` puede conocer a todos.
- Los dominios no deberían depender libremente entre sí.
- `mixing` puede consumir generators y processors, pero no absorber su implementación.
- `snippets` sirven de apoyo transversal, pero no deben convertirse en un cajón desastre.

### Qué evitar

- Carpetas por tipo técnico cuando rompen la lógica del producto.
- Un `shared/` gigante donde termina todo lo que no se sabe dónde poner.
- Componentización prematura que crea más ruido que orden.
- Snippets sin etiqueta o sin criterio de uso.

### Secuencia recomendada de implementación

1. Fijar la taxonomía de dominios para `room`.
2. Crear la estructura de carpetas vacía o mínima.
3. Mover primero `ConferenceLayout.astro` hacia dominios visibles.
4. Reorganizar `livekit-room.ts` siguiendo la misma ontología.
5. Consolidar snippets compartidos donde aparezcan patrones reales.
6. Reutilizar esta misma taxonomía en proyectos futuros para poder mover módulos entre repositorios.

## Prioridad 3

### Objetivo

Reducir el costo mental y el riesgo de regresión al trabajar sobre las superficies más complejas del producto.

### Archivos candidatos inmediatos

- `src/components/ConferenceLayout.astro`
- `src/scripts/livekit-room.ts`
- `src/pages/dashboard.astro`
- `src/pages/cursos/[...slug].astro`
- `src/layouts/RevealSlidesLayout.astro`

### Criterio de partición

- Separar estructura visual, estilos y bindings donde tenga sentido.
- Extraer subsistemas con responsabilidades claras: audio, video, layout, inputs, persistencia, paneles, overlays.
- Mantener contratos pequeños entre módulos en vez de dependencias implícitas sobre el DOM completo.
- Evitar que cada nueva feature tenga que tocar el archivo principal.

### Primer impacto esperado

- Cambios más seguros.
- Menos fatiga al iterar.
- Menos conflictos entre mejoras cosméticas y lógica funcional.
- Mejor base para seguir creciendo `room` sin volverla frágil.

## Prioridad 4

### Objetivo

Convertir la interfaz performativa en un sistema reconocible, consistente y expandible.

### Componentes de esa gramática

- Módulos con altura, padding y ritmo compartidos.
- Headings con affordances consistentes.
- Botones de reset y acciones secundarias con una sola lógica visual.
- Sliders, knobs, panners y buses con roles visuales claros.
- Colores semánticos por función, no sólo por decoración.
- Estados `hover`, `focus`, `active`, `disabled`, `offline`, `live` y `armed` tratados de forma uniforme.

### Principio rector

Cada control nuevo de la `room` debería sentirse como una extensión natural del mismo instrumento, no como un parche local.

### Primer impacto esperado

- Más legibilidad.
- Menor carga cognitiva.
- Más sensación de producto unificado.
- Mejor base para crecer en `VIDEO`, `MIXER`, `FX` y módulos futuros.

## Secuencia recomendada

1. Definir un pequeño sistema de patrones para la `room`: strips, headings, reset, knobs, sliders, módulos y colores semánticos.
2. Aplicarlo primero al sidebar actual para consolidar el lenguaje.
3. Recién ahí partir `ConferenceLayout.astro` en bloques guiados por esa gramática.
4. Luego separar `livekit-room.ts` por subsistemas funcionales.
5. Después extender el mismo criterio a `dashboard`, `slides` y `cursos`.

## Qué no haría todavía

- No intentaría una refactorización total del producto de una sola vez.
- No perseguiría todos los errores TypeScript antes de ordenar estructura y patrones.
- No abriría nuevas familias visuales en paralelo antes de estabilizar la `room`.

## Resultado buscado

El objetivo no es volver a Musiki más convencional. El objetivo es que su singularidad sea más legible, más consistente y más fácil de sostener mientras crece.
