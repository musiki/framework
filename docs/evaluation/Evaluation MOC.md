# Evaluation MOC

Última actualización: 2026-07-01
Función: nota-mapa (MOC) y tabla de contenidos del sistema de evaluación de musiki. No desarrolla; enruta. El detalle vive en las sub-notas enlazadas.

## 0. Mapa de la carpeta

- [paradigmas-evaluacion](paradigmas-evaluacion.md) — fundamentación pedagógica: paradigmas educativos → decisiones evaluables. Nueva capa madre.
- [Evaluation-self](Evaluation-self.md) — autoevaluación, coevaluación, corrección IA, estigmergia; gramática extendida.
- [Evaluation-realtime](Evaluation-realtime.md) — tipologías en vivo, beacon, protocolo de eventos.
- [Evaluation-agentic](Evaluation-agentic.md) — migración del circuito Ollama a bloques `eval`.
- [MANUAL-EVAL](MANUAL-EVAL.md) — estado auditado del runtime: qué tipos están vivos hoy y dónde.
- [phase2-mcq-checklist](phase2-mcq-checklist.md) — bitácora histórica del sprint MCQ (legacy).

## 1. Propósito

El LMS evalúa para aprender, no solo para calificar. Objetivos: activar conocimiento previo, consolidar en clase, generar producción y reflexión, registrar progreso longitudinal, y combinar `self` + `peer` + `teacher-review`.

## 2. Encuadre 2026: evaluar en la era agéntica

Si un agente resuelve trivialmente la tarea, la tarea dejó de medir al estudiante. Esto reordena todo el sistema alrededor de un eje nuevo, desarrollado en [paradigmas-evaluacion](paradigmas-evaluacion.md):

- Resistencia a la delegación (delegation-resistance). Baja: `mcq`, `msq`, respuesta factual (andamiaje formativo). Media: `short_ai`, `essay_ai`, `patch_ai` (valor en proceso y defensa). Alta: ejecución en vivo, defensa oral, patcheo en tiempo real, escucha analítica cronometrada, coevaluación presencial (anclan la nota real).

La ventaja de musiki: tocar en vivo, ante otros, no se delega. La evaluación musical hereda la irreductibilidad que el vault teoriza en [[liveness]], [[playability]] y [[performatividad]].

## 3. Tres ejes para clasificar cada `eval`

Toda actividad se ubica en tres coordenadas (no solo en su `type`):

1. Función pedagógica: activar · consolidar · producir · reflexionar · registrar.
2. Resistencia a la delegación: baja · media · alta.
3. Relación con el error: autochequeo rápido · repetición espaciada · escritura reflexiva · trabajo entre pares · ejecución testimoniada.

Regla de composición de nota: privilegiar resistencia alta (proyecto + atlas); lo de resistencia baja es formativo, no sumativo.

## 4. Arquitectura (metanivel)

Capas: autoría (bloques `eval` en markdown) · runtime (render en curso/slides) · persistencia (`Submission` + eventos live) · analítica (métricas longitudinales y visualización → pod de progreso).

Entidades mínimas: `AssessmentItem`, `Submission`, `Attempt`, `Completion` (MCC), `Review` (peer/docente), `LiveInteractionEvent`.

## 5. Tipologías (estado real)

Fuente de verdad: [MANUAL-EVAL](MANUAL-EVAL.md). Resumen:

- Vivas en runtime: `mcq`, `msq` (alias de `mcq` múltiple), `mcc`, `poll`, `wordcloud`, `patch_ai`, `combinatoria`.
- Documentadas, no vivas: `short_ai`, `reference_ai`, `essay_ai`.
- Planificadas: `prediction`, `confidence_rating`, `muddiest_point`, `summary`, `peer_rubric`.

Gramática base y properties por tipo: ver [MANUAL-EVAL](MANUAL-EVAL.md). Tipologías en vivo y beacon: ver [Evaluation-realtime](Evaluation-realtime.md).

## 6. Modos y gobernanza IA

Modos: `self` · `graded` · `peer` · `teacherreview` · `classtime`.

IA como amigo crítico, no mentor blando ni policía. Toda calificación abierta es revisable por docente (dos capas: diagnóstico IA + nota oficial). El feedback describe la brecha respecto del criterio, nunca califica a la persona (pragmática en [paradigmas-evaluacion](paradigmas-evaluacion.md), §5). Criterios y objetivos visibles antes de responder.

## 7. Métricas y visualización

Mínimas: participación (`interactions_per_class`), precisión (`correct/total`), calibración metacognitiva (`confidence vs correctness`), latencia, evolución por tópico.

Visualización longitudinal: el pod de progreso. Principio de diseño: no se llena un depósito de puntos, crece densidad de conexión (modelo SOLO de Biggs; ver [paradigmas-evaluacion](paradigmas-evaluacion.md), §3.8). Estados por nodo: no-leído · leído · completado · evaluado.

## 8. Backlog priorizado

- P0: parser estable, `mcq/msq/mcc`, poll live + beacon, snapshot/reconexión. (hecho)
- P1: `short_ai` vivo, prediction, confidence-weighted MCQ, pod de progreso por usuario.
- P2: scheduler adaptativo (repetición espaciada), think-pair-share, peer rubric completo, modo atlas con estigmergia.

## 9. Notas vinculadas

- [paradigmas-evaluacion](paradigmas-evaluacion.md)
- [Evaluation-self](Evaluation-self.md)
- [Evaluation-realtime](Evaluation-realtime.md)
- [Evaluation-agentic](Evaluation-agentic.md)
- [MANUAL-EVAL](MANUAL-EVAL.md)
- [phase2-mcq-checklist](phase2-mcq-checklist.md)
- [edu MOC](edu%20MOC.md)
