# Evaluation MOC

Última actualización: 2026-03-05

## 1. Propósito del sistema de evaluación

Este LMS evalúa para aprender, no solo para calificar.

Objetivos centrales:
- activar conocimiento previo,
- consolidar conceptos durante clase,
- generar producción/reflexión,
- registrar progreso longitudinal por estudiante,
- combinar autoevaluación, coevaluación y revisión docente.

## 2. Principios de diseño pedagógico

1. IA como mentor, no como policía.
2. Criterios transparentes (rúbricas y objetivos visibles).
3. Feedback inmediato + reflexión + reintento.
4. Alineación explícita entre objetivo de aprendizaje y tipo evaluativo.
5. Trazabilidad temporal (progreso por sesión, unidad y curso).
6. Integración de modos `self`, `peer` y `teacher-review`.

## 3. Arquitectura de evaluación (metanivel)

## 3.1 Capas
- Capa de autoría: bloques `eval` en markdown.
- Capa runtime: render interactivo (curso/slides).
- Capa de persistencia: `Submission` + eventos de interacción en vivo.
- Capa analítica: métricas longitudinales y visualización.

## 3.2 Entidades mínimas
- `AssessmentItem` (definición de actividad).
- `Submission` (respuesta puntual).
- `Attempt` (reintentos).
- `Completion` (marcado MCC).
- `Review` (peer/docente).
- `LiveInteractionEvent` (eventos en tiempo real por sesión).

## 4. Tipologías soportadas y roadmap

## 4.1 Implementadas
- `mcq` (single/multiple).
- `msq` (multiple explícito).
- `mcc` (mark content completed).

## 4.2 En implementación activa
- `poll` (interacción en vivo, `anonymous`, `time`).

## 4.3 Planificadas
- `short_ai`
- `essay_ai`
- `dds`
- `prediction`
- `confidence_rating`
- `muddiest_point`
- `summary`
- `peer_rubric`

## 5. Gramática base de bloque `eval`

```eval
id: clase6-poll-01
type: poll
mode: self
group: "Tarea 1"
prompt: "¿Qué tan claro quedó el concepto de complejidad efectiva?"
options:
  - Muy claro
  - Parcialmente claro
  - Poco claro
anonymous: true
time: true
durationMinutes: 2
```

Campos relevantes:
- `id`: único y estable.
- `type`: tipo de evaluación.
- `mode`: `self | graded | peer | teacherreview`.
- `group` (o `tarea`): agrupa evaluaciones dentro de una misma clase. Permite calcular sub-promedios y organizar visualmente el Gradebook.
- `anonymous`: permite anonimato en interacción live.
- `time`: habilita respuesta temporizada.
- `durationMinutes`/`durationSeconds`: ventana de respuesta.

## 6. UX patterns evaluativos

## 6.1 MCC
- cierre de sección con objetivos,
- botón de completado,
- barra de progreso de lectura.

## 6.2 MCQ/MSQ
- corrección inmediata,
- explicación,
- edición opcional (`allowEdit`).

## 6.3 Poll in-class (live)
- activación en clase,
- beacon global con countdown,
- resultados agregados en tiempo real.

Ver detalle completo en: [Evaluation.realtimeInClass](./Evaluation.realtimeInClass.md)

## 7. Métricas mínimas

- participación por clase (`interactions_per_class`),
- precisión conceptual (`correct/total`),
- calibración metacognitiva (`confidence vs correctness`),
- latencia de respuesta (`response_time`),
- evolución por tópico.

## 8. Backlog priorizado

## P0


- parser estable de `eval`,
- `mcq/msq/mcc`,
- poll live + beacon,
- snapshot/reconexión.

## P1
- short open response + clustering,
- prediction questions,
- confidence-weighted MCQ,
- visualizaciones por usuario.

## P2
- scheduler adaptativo (spaced repetition),
- think-pair-share digital,
- peer rubric completo.

## 9. Gobernanza y ética IA

- toda calificación abierta debe ser revisable por docente,
- registrar decisiones y cambios,
- explicar feedback en términos accionables,
- evitar opacidad en la nota final.

## 10. Notas vinculadas

- [Evaluation.realtimeInClass](./Evaluation.realtimeInClass.md)
- [live-events-protocol](./live-events-protocol.md)
- [Evaluation ollama-migration](Evaluation%20ollama-migration.md)
- [phase2-mcq-checklist](./phase2-mcq-checklist.md)
