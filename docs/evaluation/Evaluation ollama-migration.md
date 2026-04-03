# Tutorial: Migrar autocorrección Ollama a bloques `eval`

Guía práctica para pasar el flujo actual de `/demo/ollama` al formato de evaluaciones ` ```eval ` dentro de contenido de curso.

## 1) Objetivo

Mover evaluaciones abiertas (texto, patch, consigna+referencia) desde formularios ad-hoc a bloques `eval` versionables en Markdown/Obsidian.

Beneficios:

- misma gramática de evaluación para todo el LMS,
- persistencia homogénea en `Submission`,
- trazabilidad por `id` de actividad,
- reutilización por curso/lección sin duplicar UI.

## 2) Estado actual (hoy)

- `eval` soportado en runtime: `mcq`, `msq`, `mcc`.
- Endpoint de corrección IA ya operativo: `POST /api/ai/correct`.
- Payload de `/api/ai/correct`:
  - `texto` (required),
  - `rubrica` (optional),
  - `provider` (`ollama` o `deepseek`, optional),
  - `model` (optional).

## 3) Estandarizar el bloque para IA (propuesta)

Usar `type: short_ai` para respuesta corta/libre con evaluación asistida:

```eval
id: acustica-short-ai-01
type: short_ai
mode: self
title: Fundamentos de acústica
prompt: |
  Explica por qué la relación $f = \frac{v}{\lambda}$ organiza la lectura de armónicos.
  Incluye al menos un ejemplo numérico.
rubric: |
  Claridad de tesis;
  precisión conceptual;
  uso de ejemplo verificable;
  coherencia argumental
provider: ollama
model: llama3.2:latest
minChars: 180
passScore: 6
points: 3
allowEdit: true
```

Notas:

- `prompt` y textos del bloque ya aceptan matemáticas inline y display:
  - `$ ... $`
  - `$$ ... $$`
- `rubric` se envía como string al backend de corrección.
- Si quieres iteración del alumno (reescribir y reenviar), usar `allowEdit: true`.

## 4) Mapeo directo desde tus 3 demos

### Demo 1 (texto general)

- origen demo:
  - `texto`,
  - `rubrica`,
  - `provider`,
  - `model`.
- destino `eval`:
  - `type: short_ai`,
  - `prompt`,
  - `rubric`,
  - `provider`,
  - `model`.

### Demo 2 (patch Max/Pd)

- origen demo:
  - `consigna`,
  - `patch_referencia`,
  - `patch_alumno`,
  - `prompts`.
- destino `eval` recomendado:
  - `type: patch_ai` (nuevo tipo),
  - campos:
    - `prompt` (consigna),
    - `referencePatch`,
    - `studentPatch` (si se captura dentro del bloque o vía textarea),
    - `checks` (lista de prompts).

### Demo 3 (consigna + referencia textual)

- origen demo:
  - `consigna`,
  - `respuesta_referencia`,
  - `respuesta_alumno`.
- destino `eval` recomendado:
  - `type: reference_ai` (nuevo tipo),
  - campos:
    - `prompt`,
    - `referenceText`,
    - `rubric`,
    - `provider/model`.

## 5) Pipeline técnico sugerido

1. `remark-eval-blocks` parsea YAML del bloque.
2. Renderer de `eval` monta UI del tipo (`short_ai`, etc.).
3. En submit:
   - llama `/api/ai/correct`,
   - normaliza `evaluation`,
   - calcula `isCorrect` según `passScore` (ej. `nota >= 6`),
   - persiste con `/api/eval/submit`.
4. `Submission.payload` guarda:
   - respuesta del alumno,
   - evaluación normalizada,
   - metadatos (`provider`, `model`, `timing`, `tokens`).

## 6) Contrato recomendado de persistencia

Para `short_ai`, guardar en `answer`:

```json
{
  "type": "short_ai",
  "studentText": "respuesta libre...",
  "evaluation": {
    "resumen": "...",
    "tesis": { "clara": true, "explicacion": "..." },
    "fortalezas": ["...", "..."],
    "debilidades": ["...", "..."],
    "sugerencia": "...",
    "calificacion": { "nota": 7.8, "justificacion": "..." }
  },
  "provider": "ollama",
  "model": "llama3.2:latest"
}
```

## 7) Plan de ejecución corto

1. Implementar `type: short_ai` en parser + renderer.
2. Reusar `/api/ai/correct` como backend único.
3. Definir regla de aprobación (`passScore`) y feedback en UI.
4. Agregar `patch_ai` y `reference_ai` como segunda iteración.
5. Migrar demos de `/demo/ollama` a ejemplos reales en contenido `cursos/**.md`.

## 8) Checklist de migración por actividad

- [ ] `id` único y estable.
- [ ] `prompt` claro (con criterio verificable).
- [ ] `rubric` breve y accionable.
- [ ] `minChars` definido para evitar respuestas triviales.
- [ ] `passScore` alineado con política docente.
- [ ] prueba manual del bloque en `/cursos/...`.
- [ ] verificación de persistencia en `Submission`.
