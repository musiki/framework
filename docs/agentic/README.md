# Agentic Docs

Planificacion y contratos para Orf y las capacidades IA locales de Musiki.

## Lectura sugerida

1. `ollama-vps-workflow.md`
   Infraestructura actual: Astro, endpoint puente y servicio Fastify con Ollama.

2. `Evaluation-agentic.md`
   Migracion de autocorreccion Ollama a bloques `eval`.

3. `local-ai-pod.md`
   Vision de Orf como pod transversal: conference room, notas, RAG, LilyPond y microevaluaciones.

4. `ai-service-contracts.md`
   Contratos propuestos para `/api/ai/run`, request/response, RAG, LilyPond y microevaluaciones.

5. `local-ai-roadmap.md`
   Fases de implementacion desde chat sin RAG hasta adaptadores tecnicos y evaluaciones.

6. `orf-next-steps.md`
   Secuencia inmediata: anti-alucinacion, RAG textual minimo y corpus LilyPond.

7. `orf-runtime-refurbish.md`
   Runtime actual: contratos tipados, contexto por capas, websearch opcional y ejecucion directa en pods.

## Decision actual

El sistema agentic debe evolucionar desde `/api/ai/correct` hacia `/api/ai/run`, manteniendo compatibilidad con el flujo de evaluacion existente.

El primer MVP recomendado es:

- chat contextual sin RAG;
- panel experimental `orf` en conference room;
- contexto minimo `courseId`, `sessionId`, `role`;
- acciones tipadas hacia `LILY-CODE`, notas, chat compartido, pizarra e HYPERPIANO;
- reutilizacion de variables y clases base del chat del room;
- ejecucion directa validada desde el pod ORF, sin JSON visible ni botones de confirmacion.

Luego se suma:

- microevaluaciones guiadas;
- RAG sobre vault publico/de curso;
- asistencia LilyPond completa;
- organizacion de corpus publico LilyPond para ejemplos y fine tuning.
