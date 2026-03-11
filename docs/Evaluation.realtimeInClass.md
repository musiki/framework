# Evaluation.realtimeInClass

Estado: draft operativo  
Última actualización: 2026-03-05

## 1. Objetivo

Definir interacciones evaluativas en vivo durante clase (presencial/virtual), con feedback inmediato en pantalla y logging trazable.

Funciones pedagógicas objetivo:
1. Activación y diagnóstico.
2. Consolidación conceptual.
3. Producción y reflexión.

## 1.1 Diagrama textual de estados (beacon/live)

```txt
IDLE
  └─(live.started sin endsAt)──────────────────────────────> LIVE
  └─(live.started con endsAt)──────────────────────────────> TIMED

LIVE
  └─(live.updated con endsAt)──────────────────────────────> TIMED
  └─(live.ended)───────────────────────────────────────────> ENDED
  └─(snapshot active=false)────────────────────────────────> IDLE

TIMED
  └─(tick, remaining > 10s)───────────────────────────────> TIMED
  └─(tick, remaining <= 10s)──────────────────────────────> CLOSING
  └─(live.updated sin endsAt)─────────────────────────────> LIVE
  └─(live.ended o timeout)────────────────────────────────> ENDED

CLOSING
  └─(tick, remaining > 10s por update)────────────────────> TIMED
  └─(live.ended o timeout)────────────────────────────────> ENDED

ENDED
  └─(delay 3-5s, hide)────────────────────────────────────> IDLE
  └─(live.started nuevo)──────────────────────────────────> LIVE o TIMED

Reconexion:
  al refrescar, el cliente recibe live.snapshot
  y reconstruye estado en TIMED/LIVE/IDLE segun payload.
```

## 2. Tipologías best practice

## 2.1 Diagnóstico rápido
- MCQ (single/multiple/confidence-weighted/elimination).
- Poll de opinión (sin respuesta correcta).
- Word cloud (entrada libre o lista).

## 2.2 Consolidación
- Ranking/ordering.
- Matching.
- Fill-in-the-blank.
- Image hotspot.

## 2.3 Generativas
- Short open response.
- Upvoted Q&A board.
- Think–Pair–Share digital.
- Prediction question.

## 2.4 Metacognitivas
- Confidence rating.
- Muddiest point.
- One-minute summary.

## 2.5 Colaborativas
- Live collaborative board.
- Prioritization voting.

## 3. Tipologías con mayor impacto (active learning)

1. Prediction questions.
2. Think–Pair–Share.
3. Confidence-weighted MCQ.
4. Short explanation prompts.

Razón: fuerzan explicitación y revisión del modelo mental.

## 4. Primer alcance técnico (MVP)

Tipo inicial a implementar: `poll`.

Campos mínimos:
- `type: poll`
- `anonymous: true|false`
- `time: true|false`
- `durationMinutes` (o `durationSeconds`)
- `options[]`

Comportamiento:
- activación por docente,
- respuestas en tiempo real,
- resultados agregados visibles durante clase,
- cierre manual o automático por tiempo.

## 5. Beacon global (UX)

Estados:
- `IDLE` (sin interacción)
- `LIVE` (activa sin timer)
- `TIMED` (activa con timer)
- `CLOSING` (<=10s)
- `ENDED` (cerrada; visible 3–5s)

Requisitos:
- texto persistente: "VE A LA INTERACCIÓN",
- pulse accesible,
- countdown `mm:ss` cuando corresponde,
- `aria-live="polite"`,
- respeto de `prefers-reduced-motion`,
- navegación a `/live/:sessionId`.

## 6. Modelo de datos de interacción longitudinal

Evento canónico:

```txt
interaction_event
  event_id
  student_id
  course_id
  session_id
  timestamp
  interaction_type
  question_id
  response
  correctness
  confidence
  response_time
  engagement_score
```

Tipos de interacción:
- `mcq`
- `poll`
- `wordcloud`
- `ranking`
- `matching`
- `fill_blank`
- `open_response`
- `prediction`
- `confidence_rating`
- `qa_question`
- `qa_vote`
- `summary`
- `muddiest_point`
- `collaborative_post`

## 7. Visualización longitudinal

Tres curvas base por estudiante:
- Participación: `interactions_per_class`.
- Precisión conceptual: `correct_answers / total_answers`.
- Calibración metacognitiva: `confidence vs correctness`.

Paneles sugeridos:
- timeline por clase,
- mastery por tópico,
- radar de engagement (participación/discusión/predicción/reflexión).

## 8. Protocolo de eventos live

Canal en vivo:
- SSE: `/sse/live?courseId=...`

Eventos server -> client:
- `live.snapshot`
- `live.started`
- `live.updated`
- `live.ended`

Fallback REST:
- `GET /api/live/active?courseId=...`

Documento técnico detallado:
- [live-events-protocol](./live-events-protocol.md)

## 9. Modos operativos sugeridos

- `self`: respuesta individual y feedback inmediato.
- `teacherreview`: el docente controla activación/cierre y revisión.
- `classtime`: modo temporal de clase con beacon y countdown.

## 10. Decisiones abiertas

- anonimato parcial (visible para docente, oculto para pares),
- scoring de engagement por tipo,
- normalización cross-curso para comparativas.
