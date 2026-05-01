# Orf Pod Roadmap

## Objetivo

Planear la implementacion de `orf` por fases pequenas y verificables, sobre la infraestructura Ollama existente.

## Fase 0: consolidar contrato

Resultado esperado:

- documentos de arquitectura en `framework/docs/agentic`;
- decision explicita de endpoint unificado `/api/ai/run`;
- tareas separadas por adaptador;
- regla de permisos: proponer, aprobar, registrar.

Entregables:

- `local-ai-pod.md`;
- `ai-service-contracts.md`;
- `local-ai-roadmap.md`.

## Fase 1: chat local sin RAG

Objetivo:

Verificar conversacion contextual en el LMS usando Ollama, sin indexar vault todavia, pero dejando preparadas las salidas hacia `LILY-CODE`, notas, chat compartido e HYPERPIANO.

Backend:

- crear `POST /api/ai/run`;
- soportar `task: 'chat'`;
- reutilizar variables `CORRECTION_API_URL` y `CORRECTION_API_TOKEN` o definir `AI_API_URL`/`AI_API_TOKEN` si se separa el servicio;
- agregar prompt profile `conference`;
- soportar modelo opcional.
- devolver `actions` opcionales: `write_to_lily_code`, `write_to_notes`, `publish_to_room_chat`, `send_midi_to_hyperpiano`.

Frontend:

- agregar panel experimental `orf` en conference room;
- agregar asistente compacto en notas si la superficie ya tiene contexto claro;
- enviar `courseId`, `sessionId`, `role`, `message` y `context.mode`.
- reutilizar variables, layout y clases base del chat del room;
- presentar iniciadores confirmables: "Quieres transcribirlo en LILY-CODE?", "Quieres pasarlo a nota?", "Quieres enviarlo al chat?", "Quieres probarlo como notas MIDI en HYPERPIANO?";
- si se publica al chat, mostrar el actor como `Orf-<modelName>`;
- preparar preview/buffer, no escribir directo.

Verificacion:

- chat responde en espanol con estructura;
- no cita fuentes si no hubo retrieval;
- respeta curso y clase pasados en scope;
- errores de Ollama se muestran como estado recuperable.
- las acciones propuestas no se ejecutan sin confirmacion;
- el pod visualmente se siente como extension del chat, no como UI separada.

## Fase 2: microevaluaciones guiadas

Objetivo:

Convertir el asistente en acompanante pedagogico, no solo conversacional.

Backend:

- soportar `task: 'micro_eval'`;
- devolver `MicroEval` estructurado;
- permitir exportar a bloque `eval` preliminar;
- distinguir feedback formativo de calificacion.

Frontend:

- accion `generate_guiding_questions`;
- accion `create_micro_eval`;
- UI para copiar o insertar propuesta en una nota como patch revisable.

Verificacion:

- genera 3 a 5 preguntas guia;
- incluye criterio observable por pregunta;
- adapta dificultad a clase activa;
- no persiste calificacion final.

## Fase 3: RAG sobre vault publico/de curso

Objetivo:

Permitir que el agente consulte notas sin acceso directo al filesystem en runtime.

Indexer:

- parsear markdown y frontmatter;
- separar chunks;
- extraer `courseId`, `unitId`, `tags`, `visibility`, `title`, `updatedAt`;
- generar embeddings locales con `nomic-embed-text` u otro modelo Ollama disponible;
- guardar indice en storage controlado.

Backend:

- soportar `task: 'rag_query'`;
- filtrar por rol y visibilidad antes de retrieval;
- ensamblar prompt con fragmentos citables;
- devolver `citations`.

Frontend:

- accion `find_related_notes`;
- vista de fuentes usadas;
- aviso cuando la respuesta contiene inferencias.

Verificacion:

- no recupera notas `private` para estudiantes;
- cita `sourcePath`;
- responde "no alcanza el contexto" cuando retrieval no encuentra evidencia;
- filtra por `courseId` cuando el contexto es curso.

## Fase 4: LilyPond assistant

Objetivo:

Agregar superpoder tecnico dentro del lily-code pod y reutilizable desde notas.

Backend:

- soportar `lilypond_explain`, `lilypond_generate`, `lilypond_repair`;
- agregar prompt profile `lilypond`;
- devolver patches y diagnosticos;
- integrar compilacion cuando el servicio LilyPond este disponible desde backend.
- empezar a organizar corpus publico LilyPond para ejemplos, resumenes y fine tuning por tipo de respuesta.

Frontend:

- boton para explicar seleccion;
- boton para reparar error de compilacion;
- preview de diff;
- aceptar/rechazar patch;
- reintentar compilacion despues de aplicar.

Verificacion:

- nunca aplica cambios sin aprobacion;
- conserva estructura si `preserveStructure` esta activo;
- explica errores por linea cuando hay diagnostico;
- el resultado compila en casos basicos.
- los ejemplos guardados tienen resumen de tarea, prompt, entrada, salida esperada, tags y nivel.

## Fase 5: evaluaciones agentic reutilizables

Objetivo:

Conectar el pod con la gramatica `eval` y la persistencia `Submission`.

Tipos:

- `short_ai`: respuesta breve guiada;
- `code_ai` con `language: lilypond`;
- `patch_ai`: evolucion para patches musicales o Max/Pd;
- `reference_ai`: comparacion con respuesta de referencia.

Backend:

- mapear `eval_correct` a flujo actual;
- persistir payload normalizado;
- registrar modelo, provider, timing, tokens y contexto;
- preparar revision docente cuando corresponda.

Frontend:

- renderer para `short_ai`;
- renderer inicial para `code_ai/lilypond`;
- feedback visible y editable cuando `allowEdit: true`;
- estado claro entre autoevaluacion, feedback y revision docente.

Verificacion:

- submissions guardan respuesta y evaluacion;
- `passScore` se calcula desde `calificacion.nota`;
- `allowEdit` permite iterar sin perder trazabilidad;
- dashboard puede distinguir tipos IA.

## Fase 6: sintesis sonora y otros lenguajes

Objetivo:

Agregar nuevos adaptadores sin deformar el pod base.

Candidatos:

- SuperCollider;
- Faust;
- WebAudio;
- Max/Pd;
- sintesis FM del room;
- analisis de audio.

Regla:

Cada nuevo superpoder debe definir:

- contrato de request/response;
- prompt profile propio;
- validacion o tool check;
- politica de permisos;
- forma de patch o preview;
- pruebas de regresion minimas.

## Riesgos

| Riesgo | Mitigacion |
| --- | --- |
| El pod se vuelve demasiado generico | Separar `task` y adaptadores |
| El modelo inventa fuentes | Citas obligatorias en RAG |
| Expone notas privadas | Filtro por `visibility` antes de retrieval |
| Modifica codigo opacamente | Patches y aprobacion manual |
| Duplica `/api/ai/correct` | `/api/ai/run` delega al flujo existente |
| Se mezcla con evaluacion oficial | Distinguir feedback, autoevaluacion y revision docente |
| Latencia alta en VPS | Streaming, modelos pequenos, cache, limites de contexto |

## Primera implementacion recomendada

Empezar por Fase 1 con el modelo de salidas preparado, y luego sumar Fase 2:

1. `POST /api/ai/run` con `chat`;
2. panel experimental en conference room;
3. contexto minimo `courseId`, `sessionId`, `role`;
4. salida normalizada con acciones confirmables hacia `LILY-CODE`, notas, chat e HYPERPIANO;
5. sin RAG todavia;
6. sin escritura automatica.

Esto permite probar la experiencia pedagogica antes de invertir en indexacion del vault.
