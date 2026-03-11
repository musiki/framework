# MANUAL EVAL

Estado auditado: 2026-03-11

Este manual resume qué partes del sistema de evaluaciones están vivas hoy, dónde quedaron los bloques `eval`, qué tipos funcionan realmente en runtime y qué piezas de Ollama existen pero todavía no están migradas a bloques soportados.

## 1. Resumen ejecutivo

### Tipos vivos hoy en runtime

- `mcq`
- `msq` como alias de autoría de `mcq` múltiple
- `mcc`
- `poll`
- `wordcloud`
- `patch_ai`

### Tipos documentados pero no implementados como bloque usable

- `short_ai`
- `reference_ai`
- `essay_ai`
- otros roadmap mencionados en `Evaluation MOC.md`

### Conteo de bloques reales encontrados

- 10 bloques `eval` en contenido fuente `i1/cursos/**`
- 8 bloques `mcq` en `i1/cursos/i1/02-acústica/Cuestionario obligatorio Fundamentos de Acústica Musical 1.md`
- 1 bloque `poll` en `i1/cursos/i1/03-organología/test-class-evaluación.md`
- 1 bloque `wordcloud` en `i1/cursos/i1/03-organología/test-class-evaluación.md`

Además hay 1 bloque `short_ai` de ejemplo en `framework/src/content/cursos/i1/03-organología/eval-test.md`, pero hoy cae en el renderer de tipo no soportado.

## 2. Dónde están los bloques

### Fuente editorial actual

Los bloques reales que encontré hoy están en:

- `i1/cursos/i1/02-acústica/Cuestionario obligatorio Fundamentos de Acústica Musical 1.md`
- `i1/cursos/i1/03-organología/test-class-evaluación.md`

### Contenido ensamblado para Astro

El framework consume contenido desde:

- `framework/src/content/cursos/**`
- `framework/src/content/**`

La colección `cursos` está definida en:

- `framework/src/content.config.ts`

La copia/ensamblado de contenido se hace con:

- `framework/scripts/assemble-content.mjs`

La fuente habilitada hoy en el manifest es `i1`:

- `framework/config/sources.manifest.json`

En otras palabras:

1. Se autoran bloques en `i1/cursos/**`.
2. El ensamblado los lleva a `framework/src/content/cursos/**`.
3. Astro los parsea y los renderiza en runtime.

## 3. Componentes vivos del sistema de eval

### Autoría y parseo

- `framework/src/plugins/remark-eval-blocks.mjs`
  Convierte cada bloque `eval` en un wrapper HTML serializado.
- `framework/src/lib/eval/parse-eval-block.mjs`
  Parser central y fuente de verdad de propiedades soportadas.

### Runtime de curso

- `framework/src/pages/cursos/[...slug].astro`
  Renderiza `mcq`, `mcc`, `poll` y `wordcloud`.
  Cualquier otro tipo cae en mensaje `Tipo de evaluación no soportado todavía`.

### Runtime de slides

- `framework/src/layouts/RevealSlidesLayout.astro`
  Renderiza `mcq`, `poll` y `wordcloud`.
  `mcc` no tiene renderer específico en slides.

### Persistencia y catálogo

- `framework/src/pages/api/eval/submit.ts`
  Guarda entregas y adjunta metadata del catálogo.
- `framework/src/lib/eval-catalog.ts`
  Recorre colecciones y arma catálogo por `evalId`.
- `framework/src/lib/eval-option-map.ts`
  Extrae opciones de `mcq` para dashboard.
- `framework/src/lib/eval-sync.ts`
  Sincroniza catálogo hacia `Assignment`.
- `framework/src/pages/api/admin/eval/sync.ts`
  Fuerza sync manual del catálogo.

### Interacción live para clase

- `framework/src/pages/api/live/start.ts`
- `framework/src/pages/api/live/respond.ts`
- `framework/src/pages/api/live/end.ts`
- `framework/src/pages/api/live/active.ts`

Estas rutas sostienen `poll` y `wordcloud`.

### Circuito Ollama / corrección IA

- `framework/src/pages/demo/ollama.astro`
  Demo manual de corrección y guardado en `Submission`.
- `framework/src/pages/api/ai/correct.ts`
  Proxy autenticado hacia backend de corrección.
- `framework/src/pages/api/ai/models.ts`
  Lista modelos disponibles del backend.
- `framework/services/ollama-api/src/server.js`
  API Fastify que habla con Ollama local.
- `framework/scripts/demo/ollama-correct.mjs`
  CLI de prueba para el backend.
- `framework/services/ollama-api/ops/systemd/ollama-correction-api.service`
- `framework/services/ollama-api/ops/nginx/correction-api.conf`

Punto clave: este circuito IA existe, pero todavía no está integrado a un tipo `eval` soportado como `short_ai`.

## 4. Matriz real de soporte

| Tipo | Autoría | Curso | Slides | Persistencia | Live | IA |
|---|---|---|---|---|---|---|
| `mcq` | sí | sí | sí | sí | no | no |
| `msq` | sí, como alias | sí, normaliza a `mcq` | sí, como `mcq` | sí | no | no |
| `mcc` | sí | sí | no específico | sí | no | no |
| `poll` | sí | sí | sí | sí | sí | no |
| `wordcloud` | sí | sí | sí | sí | sí | no |
| `patch_ai` | sí | sí | no | sí | no | sí |
| `short_ai` | ejemplo/propuesta | no | no | no automático | no | backend disponible |
| `reference_ai` | propuesta | no | no | no | no | backend disponible |

## 5. Gramática base del bloque

### Campos comunes soportados por parser

| Property | Tipo | Default | Opciones / notas |
|---|---|---:|---|
| `id` | string | autogenerado | Conviene que sea único y estable. Si falta, el parser genera un fallback desde el path. |
| `type` | string | `mcq` | Soportados hoy: `mcq`, `msq`, `mcc`, `poll`, `wordcloud`. Los demás pasan como `unsupported`. |
| `mode` | string | `self` | Valores válidos: `self`, `graded`, `peer`, `teacherreview`, `classtime`. |
| `title` | string | `""` | Se usa como texto auxiliar o fallback en algunos tipos. |
| `points` | number > 0 | `1` | Cualquier número positivo. |
| `allowEdit` | boolean | `false` | Alias aceptados: `allowedit`, `allow_edit`, `editable`. |

### Alias válidos de `mode`

| Entrada | Normaliza a |
|---|---|
| `teacher-review` | `teacherreview` |
| `teacherrevision` | `teacherreview` |
| `teacher_revision` | `teacherreview` |
| `class-time` | `classtime` |
| `class_time` | `classtime` |
| `classlive` | `classtime` |
| `class-live` | `classtime` |
| `class_live` | `classtime` |

## 6. Tipos soportados hoy

## 6.1 MCQ

Título sugerido: Opción múltiple con corrección inmediata

Estado:

- soportado en curso
- soportado en slides
- persistido en `Submission`

Ejemplo:

```eval
id: acustica-mcq-01
type: mcq
mode: self
title: Frecuencia y tiempo
points: 1
prompt: "¿Qué opción describe mejor una frecuencia?"
options:
  - "[x] Cantidad de ciclos por segundo"
  - "[ ] Intensidad máxima de un sonido"
  - "[ ] Duración de una nota"
explanation: "La frecuencia mide repeticiones por segundo y se expresa en Hz."
hint: "Piensa en cuántas veces se repite la onda en 1 segundo."
allowEdit: true
```

Properties del tipo:

| Property | Tipo | Default | Opciones / notas |
|---|---|---:|---|
| `prompt` | string | `""` | Enunciado visible. |
| `options` | list | requerido | Mínimo 2 opciones. |
| `explanation` | string | `""` | Se muestra como explicación de feedback. |
| `hint` | string | `""` | Se parsea y queda disponible en el payload. |

Formato válido de `options`:

- string con marcador estilo `"[x] correcta"` o `"[ ] incorrecta"`
- objeto YAML con `text` o `label`
- objeto YAML con `isCorrect: true|false`

Notas de comportamiento:

- Si no marcas ninguna opción correcta, el parser fuerza la primera como correcta.
- Si más de una opción queda correcta, el runtime se comporta como múltiple.

## 6.2 MSQ

Título sugerido: Selección múltiple explícita

Estado:

- soportado como sintaxis de autoría
- el parser lo convierte a `mcq` con `allowMultiple: true`
- no existe renderer separado ni tipo persistido separado

Ejemplo:

```eval
id: acustica-msq-01
type: msq
mode: self
title: Variables físicas
prompt: "Selecciona todas las variables que intervienen en f = v / λ."
options:
  - "[x] Frecuencia"
  - "[x] Velocidad"
  - "[x] Longitud de onda"
  - "[ ] Timbre"
explanation: "La fórmula relaciona frecuencia, velocidad y longitud de onda."
```

Properties del tipo:

Usa exactamente las mismas properties de `mcq`.

Nota importante:

- `msq` es un alias de autoría, no un tipo distinto en runtime.
- Después del parseo, queda como `type: mcq` y `selectionMode: multiple`.

## 6.3 MCC

Título sugerido: Marcar contenido como completado

Estado:

- soportado en curso
- persistido como completado
- sin renderer específico en slides

Ejemplo:

```eval
id: organologia-cierre-01
type: mcc
mode: self
title: Cierre de sección
prompt: "Marca esta sección como completada."
summary: "Usa este cierre cuando terminaste lectura, escucha y notas."
objectives:
  - Identificar las familias instrumentales
  - Diferenciar materialidad y función
buttonLabel: "Marcar como completado"
successLabel: "Sección completada"
```

Properties del tipo:

| Property | Tipo | Default | Opciones / notas |
|---|---|---:|---|
| `prompt` | string | texto por defecto | Alias: `title` como fallback. |
| `summary` | string | `""` | Alias: `description`. |
| `objectives` | list | `[]` | Alias: `objetivos`, `goals`. |
| `buttonLabel` | string | `Marcar como completado` | Alias: `button`, `cta`. |
| `successLabel` | string | `Sección completada` | Alias: `success`. |

## 6.4 Poll

Título sugerido: Encuesta live de clase

Estado:

- soportado en curso
- soportado en slides
- usa endpoints live
- persiste respuesta y snapshot agregado

Ejemplo:

```eval
id: clase-poll-claridad-01
type: poll
mode: classtime
title: Chequeo de claridad
prompt: "¿Qué tan claro quedó el concepto?"
options:
  - Claro
  - Parcialmente claro
  - Necesito repaso
anonymous: true
allowMultiple: false
showResults: true
autoStart: false
time: true
durationMinutes: 2
```

Properties del tipo:

| Property | Tipo | Default | Opciones / notas |
|---|---|---:|---|
| `prompt` | string | `""` | Alias: `question`, `title`. |
| `options` | list | requerido | Mínimo 2 opciones. |
| `anonymous` | boolean | `true` | `true` o `false`. |
| `allowMultiple` | boolean | `false` | Alias: `multiple`. |
| `showResults` | boolean | `true` | Muestra resultados agregados. |
| `autoStart` | boolean | `false` | Si hay rol docente, inicia al cargar. |
| `time` | bool o número | `false` | Si es `true`, usa 120s. Si es número, se interpreta como minutos. |
| `timed` | bool o número | `false` | Alias de `time`. |
| `timer` | bool o número | `false` | Alias de `time`. |
| `durationMinutes` | integer | `0` | Override explícito de minutos. |
| `durationSeconds` | integer | `0` | Override explícito de segundos. |
| `minutes` | integer | `0` | Alias de duración en minutos. |
| `seconds` | integer | `0` | Alias de duración en segundos. |

Notas de comportamiento:

- Si el timer queda activo, el parser expone `timed: true` y `timerSeconds`.
- El docente puede iniciar/cerrar la interacción.
- El alumno puede actualizar la respuesta mientras la interacción siga abierta.

## 6.5 Wordcloud

Título sugerido: Nube de palabras live

Estado:

- soportado en curso
- soportado en slides
- usa endpoints live
- persiste respuesta libre y conteos agregados

Ejemplo:

```eval
id: clase-wordcloud-01
type: wordcloud
mode: classtime
title: Palabra de salida
prompt: "¿Qué palabra te llevas de esta clase?"
options:
  - Timbre
  - Resonancia
  - Materialidad
anonymous: false
showResults: true
autoStart: false
time: true
durationMinutes: 1
```

Properties del tipo:

| Property | Tipo | Default | Opciones / notas |
|---|---|---:|---|
| `prompt` | string | `""` | Alias: `question`, `title`. |
| `options` | list | `[]` | Lista opcional de sugerencias/chips. |
| `anonymous` | boolean | `true` | `true` o `false`. |
| `showResults` | boolean | `true` | Muestra nube agregada. |
| `autoStart` | boolean | `false` | Auto-inicio para docente. |
| `time` / `timed` / `timer` | bool o número | `false` | Misma semántica que `poll`. |
| `durationMinutes` / `durationSeconds` / `minutes` / `seconds` | integer | `0` | Misma resolución que `poll`. |

Notas de comportamiento:

- `allowMultiple` no aplica; el tipo siempre responde una palabra o frase corta.
- `options` son sugerencias, no respuestas obligatorias.

## 6.6 Patch AI

Título sugerido: Corrección IA de patch Max/MSP o Pure Data

Estado:

- soportado en curso
- persistido con score real y feedback IA
- usa `/api/ai/correct`
- sin renderer específico en slides

Ejemplo:

```eval
id: patch-secuenciador-01
type: patch_ai
mode: teacherreview
title: Patch secuenciador
prompt: "Construye un secuenciador simple con metro, counter y select."
checks:
  - "Verificar objetos principales del flujo"
  - "Ignorar posicion visual si la logica coincide"
  - "Penalizar conexiones faltantes o outlets mal conectados"
provider: ollama
model: llama3.2:latest
passScore: 6
allowEdit: true
evaluationPrompt: |
  Ignora toda informacion de posicion de objetos y compara los patches como grafos de objetos y conexiones.
referencePatch: |
  #N canvas 200 120 820 520 10;
  #X obj 60 60 metro 250;
  #X obj 60 110 counter 0 7;
  #X obj 60 160 select 0 4;
  #X obj 220 160 bang;
  #X obj 300 160 bang;
  #X connect 0 0 1 0;
  #X connect 1 0 2 0;
  #X connect 2 0 3 0;
  #X connect 2 1 4 0;
```

Properties del tipo:

| Property | Tipo | Default | Opciones / notas |
|---|---|---:|---|
| `prompt` | string | `""` | Consigna visible. |
| `checks` | list | `[]` | Alias aceptados: `criteriaPrompts`, `criteria_prompts`, `prompts`. |
| `provider` | string | `ollama` | Hoy pensado para `ollama` o `deepseek`. |
| `model` | string | `""` | Modelo IA. |
| `passScore` | number | `6` | Umbral para marcar `isCorrect`. |
| `minChars` | integer | `0` | Mínimo de caracteres del patch pegado por el alumno. |
| `placeholder` | string | texto por defecto | Alias: `studentPlaceholder`, `student_placeholder`. |
| `submitLabel` | string | `Evaluar patch` | Alias: `cta`, `buttonLabel`. |
| `evaluationPrompt` | string | prompt interno por defecto | Instrucciones extra para el modelo. |
| `referencePatch` | string | `""` | Patch guía. Conviene dejarlo al final del bloque porque suele ser el campo más largo. |

Notas de comportamiento:

- El backend normaliza el patch para priorizar objetos y conexiones sobre coordenadas visuales.
- Se guardan `studentPatch`, `referencePatch`, `evaluation`, `provider`, `model` y score.
- Si `allowEdit` es `true`, el alumno puede reenviar una versión corregida.
- `referencePatch` puede escribirse en YAML literal con `|` o con triple comilla `""" ... """`.
- Para patches largos de Max 9 conviene dejar `referencePatch` como último campo del bloque.

## 7. Tipos de Ollama documentados pero no vivos todavía

Estas tipologías aparecen en `framework/docs/Evaluation ollama-migration.md` y en `framework/src/content/cursos/i1/03-organología/eval-test.md`.

El backend IA existe, pero el bloque aún no tiene parser específico ni renderer dedicado.

## 7.1 short_ai

Título sugerido: Respuesta corta con evaluación IA

Estado:

- ejemplo documentado
- parser lo deja pasar como tipo desconocido
- curso muestra `Tipo de evaluación no soportado todavía: short_ai`

Ejemplo:

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

Properties propuestas:

| Property | Tipo | Notas |
|---|---|---|
| `prompt` | string | Consigna visible. |
| `rubric` | string | Se enviaría al backend de corrección. |
| `provider` | string | `ollama` o `deepseek`. |
| `model` | string | Modelo a usar. |
| `minChars` | integer | Mínimo sugerido de respuesta. |
| `passScore` | number | Umbral para `isCorrect`. |
| `allowEdit` | boolean | Reenvío del texto corregido. |

## 7.2 reference_ai

Título sugerido: Respuesta libre comparada con texto de referencia

Estado:

- propuesto en doc de migración
- sin parser específico
- sin renderer

Ejemplo propuesto:

```eval
id: referencia-textual-01
type: reference_ai
mode: self
title: Comparación con respuesta modelo
prompt: "Explica la diferencia entre ruido y tono."
referenceText: |
  Un tono presenta periodicidad reconocible; el ruido no organiza su espectro del mismo modo.
rubric: |
  Precisión conceptual;
  claridad;
  uso correcto del vocabulario
provider: ollama
model: llama3.2:latest
passScore: 6
allowEdit: true
```

Properties propuestas:

| Property | Tipo | Notas |
|---|---|---|
| `prompt` | string | Consigna. |
| `referenceText` | string | Respuesta base o material de comparación. |
| `rubric` | string | Criterios de evaluación. |
| `provider` | string | Backend IA. |
| `model` | string | Modelo IA. |
| `passScore` | number | Umbral de aprobación. |
| `allowEdit` | boolean | Permite reintento. |

## 8. Diferencias importantes entre docs y código

### `Evaluation MOC.md`

Tiene drift respecto al código actual:

- dice que `poll` está "en implementación activa", pero hoy ya corre en curso y slides
- no lista `wordcloud` como tipología implementada, aunque sí está en parser y runtime
- lista `msq` como tipo, pero en código se normaliza a `mcq`
- no incluye `classtime` entre los modos visibles, aunque el parser sí lo acepta

### `Evaluation ollama-migration.md`

También quedó parcialmente atrás:

- afirma que el runtime soporta `mcq`, `msq`, `mcc`
- hoy el runtime también soporta `poll`, `wordcloud` y `patch_ai`
- el circuito IA existe, pero la migración a `short_ai` y `reference_ai` no fue implementada

## 9. Recomendación práctica

Si hoy quieres authoring estable:

- usa `mcq`, `msq`, `mcc`, `poll` y `wordcloud`
- usa `patch_ai` si necesitas comparación estructural de patches

Si quieres migrar Ollama a bloques `eval`:

1. Implementar `short_ai` en `parse-eval-block.mjs`.
2. Agregar renderer en `framework/src/pages/cursos/[...slug].astro`.
3. Reusar `framework/src/pages/api/ai/correct.ts`.
4. Persistir `evaluation`, `provider`, `model`, `timing` y score en `/api/eval/submit`.
5. Después sumar `reference_ai`.
