# Feedback Musiki

Fecha: 2026-03-28

## Sitio

El sitio tiene algo muy valioso: no se siente genérico. Tiene una identidad propia, bastante "instrumento/plataforma performativa", y eso hoy vale mucho más que verse prolijo pero intercambiable. Lo que yo mejoraría no va por cambiarle el alma, sino por hacer que esa personalidad se entienda más rápido y que el código la sostenga mejor.

- Haría más explícita la arquitectura del producto: hoy conviven cursos, foro, dashboard, sala en vivo, slides y herramientas, pero no siempre queda claro cuál es el centro y cuáles son extensiones.
- Unificaría más el lenguaje visual y de interacción entre áreas: lo que estamos haciendo en el sidebar de `room` va en una muy buena dirección, porque genera "gramática" de producto.
- Trabajaría más los estados de sistema: `offline`, `live`, `preview`, `recording`, `invited`, `teacher/student`. El sitio tiene muchos modos potentes, pero a veces no se leen de un vistazo.
- Cuidaría mucho la carga cognitiva: el proyecto tiene mucha capacidad, así que conviene dosificarla con mejores jerarquías, defaults fuertes y más progressive disclosure.
- Revisaría accesibilidad y foco de teclado como regla transversal. Un sitio con tanta interacción en vivo se beneficia muchísimo de eso.

## Código

- La mejora más grande es de composición. Hoy hay archivos que ya están pidiendo partición fuerte: `src/components/ConferenceLayout.astro`, `src/scripts/livekit-room.ts`, `src/pages/dashboard.astro`, `src/pages/cursos/[...slug].astro`, `src/layouts/RevealSlidesLayout.astro`. Ya no es un tema estético: afecta velocidad de cambio y riesgo de regresión.
- Separaría más "motor" de "binding UI". En especial `src/scripts/livekit-room.ts` hoy mezcla estado, audio, video, DOM, layout, persistencia y networking en el mismo plano mental.
- Consolidaría tokens y patrones de UI. Hay una oportunidad muy clara de convertir varios estilos repetidos del sidebar en un mini sistema de diseño interno.
- Atacaría la deuda de TypeScript por capas, no de frente. El backlog existe y es real; conviene empezar por tipados-base y archivos chicos antes de tocar los monstruos.
- Sumaria más pruebas alrededor de flujos críticos. La superficie de test automatizado todavía parece chica para la complejidad del producto.
- Documentaría mejor los "subsystems": live room, content pipeline, dashboard académico, foro. Cuando un proyecto crece tanto, un poco de mapa conceptual ahorra muchísimo.

## La room

- Es probablemente la página con más personalidad del sitio. Se siente instrumento, no simple videollamada. Eso yo lo cuidaría muchísimo.
- Lo siguiente que mejoraría ahí es legibilidad operativa: que cualquier usuario entienda rápido qué está arriba como "generación", qué queda abajo como "mezcla/proceso", y qué está afectando realmente el resultado final.
- Haría más visible el modo actual de escena/layout. Ahora que `F` y otros modos son importantes, conviene que el estado de composición sea obvio.
- Trataría `offline` como modo de uso legítimo, no sólo fallback. Lo del preview full-window va exactamente en esa dirección: ensayo/studio mode antes de entrar.
- En `VIDEO`, `MIXER` y `FX`, cuanto más crezcan, más importante será mostrar flujo de señal, no sólo controles. Si no, la página puede volverse poderosa pero opaca.
- En el mixer, si hay canales reservados o futuros, los presentaría con un estado más claramente "parked" para que no compitan visualmente con los activos.
- Revisaría si `src/pages/room.astro` necesita cargar siempre cosas globales como `Search` y `GraphModal`; conceptualmente quizá sí, pero en una sala en vivo yo tendería a mantener el runtime lo más enfocado posible.

## Cierre

El proyecto ya tiene una dirección singular y eso es una ventaja real. Mi impresión general es que no necesita volverse más convencional, sino más legible, más consistente y más modular para que esa singularidad escale sin volverse frágil.
