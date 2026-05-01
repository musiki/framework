# AI Service Contracts

## Objetivo

Definir los contratos del backend agentic antes de implementar UI. La meta es generalizar la API IA existente sin romper el flujo operativo de correccion.

Estado actual relevante:

- Astro expone `POST /api/ai/correct`.
- El endpoint soporta `taskType` para `patch_ai`, `short_ai` y `reference_ai`.
- Ollama se consume a traves del servicio Fastify `services/ollama-api`.
- DeepSeek existe como provider alternativo desde el endpoint Astro.

## Endpoint recomendado

Agregar un endpoint unificado:

```txt
POST /api/ai/run
```

Mantener:

```txt
POST /api/ai/correct
```

como wrapper de compatibilidad para evaluacion.

## Request base

```ts
type AiRunRequest = {
  task:
    | 'chat'
    | 'rag_query'
    | 'micro_eval'
    | 'lilypond_generate'
    | 'lilypond_repair'
    | 'lilypond_explain'
    | 'notes_draft'
    | 'chat_publish'
    | 'midi_generate'
    | 'eval_correct';
  user: {
    id: string;
    role: 'student' | 'teacher' | 'admin';
  };
  scope: {
    courseId?: string;
    sessionId?: string;
    noteId?: string;
    sourcePath?: string;
    podId?: string;
  };
  input: {
    message?: string;
    selectedText?: string;
    code?: string;
    compilerError?: string;
    prompt?: string;
    rubric?: string;
    referenceText?: string;
  };
  context?: {
    mode: 'none' | 'course' | 'session' | 'vault' | 'selection';
    includePublicNotes?: boolean;
    includeCourseNotes?: boolean;
    maxChunks?: number;
  };
  options?: {
    provider: 'ollama' | 'deepseek';
    model?: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
  };
};
```

## Response base

```ts
type AiRunResponse = {
  ok: boolean;
  task: AiRunRequest['task'];
  provider: 'ollama' | 'deepseek';
  model?: string;
  output?: {
    message?: string;
    structured?: Record<string, unknown>;
    patch?: AiPatch;
    diagnostics?: AiDiagnostic[];
    citations?: AiCitation[];
    microEval?: MicroEval;
    actions?: AiOutputAction[];
  };
  usage?: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
  };
  timingMs?: {
    total?: number | null;
    retrieval?: number | null;
    generation?: number | null;
    tool?: number | null;
  };
  error?: string;
};
```

## Tipos compartidos

```ts
type AiCitation = {
  sourcePath: string;
  title?: string;
  chunkId?: string;
  lines?: {
    start?: number;
    end?: number;
  };
  visibility: 'public' | 'course' | 'teacher' | 'private';
};

type AiPatch = {
  format: 'unified-diff' | 'full-source';
  language: 'markdown' | 'lilypond' | 'text';
  content: string;
};

type AiDiagnostic = {
  severity: 'info' | 'warning' | 'error';
  message: string;
  line?: number;
  column?: number;
  source?: 'model' | 'compiler' | 'retrieval' | 'system';
};

type AiOutputAction =
  | { kind: 'write_to_lily_code'; proposal: LilyCodeWriteProposal }
  | { kind: 'write_to_notes'; proposal: NotesWriteProposal }
  | { kind: 'publish_to_room_chat'; proposal: RoomChatPublishProposal }
  | { kind: 'send_midi_to_hyperpiano'; proposal: HyperpianoMidiProposal };

type LilyCodeWriteProposal = {
  target: 'lily-code';
  mode: 'insert' | 'replace-selection' | 'new-buffer';
  source: string;
  promptLabel: 'Quieres transcribirlo en LILY-CODE?';
  compileAfterApply?: boolean;
};

type NotesWriteProposal = {
  target: 'notes-pod';
  mode: 'append' | 'new-note' | 'replace-selection';
  title?: string;
  markdown: string;
  promptLabel: 'Quieres pasarlo a nota?';
};

type RoomChatPublishProposal = {
  target: 'room-chat';
  participant: {
    displayName: `Orf-${string}`;
    provider: 'ollama';
    model: string;
  };
  content: string;
  promptLabel: 'Quieres enviarlo al chat?';
};

type HyperpianoMidiProposal = {
  target: 'hyperpiano';
  promptLabel: 'Quieres probarlo como notas MIDI en HYPERPIANO?';
  midiNotes: {
    pitch: number;
    velocity?: number;
    startMs: number;
    durationMs: number;
    channel?: number;
  }[];
  tempo?: number;
  explanation?: string;
};

type MicroEval = {
  title: string;
  questions: {
    id: string;
    prompt: string;
    expectedMove?: string;
    difficulty: 'intro' | 'practice' | 'challenge';
  }[];
  rubric?: string[];
  sourceCitations?: AiCitation[];
};
```

## Chat contextual

```ts
type AiChatRequest = AiRunRequest & {
  task: 'chat';
  input: {
    message: string;
    selectedText?: string;
  };
};
```

Requisitos:

- usar `scope.courseId` y `scope.sessionId` cuando existan;
- para el MVP, no recuperar vault aunque exista `courseId`; RAG queda detras de `task: 'rag_query'`;
- devolver respuesta guiada y estructurada;
- ofrecer preguntas guia cuando el usuario pida estudiar o repasar.
- poder devolver `actions` para escribir propuesta en `lily-code`, pasar a nota, publicar como `Orf-<modelName>` en chat o enviar notas MIDI a HYPERPIANO.

## Salidas accionables del MVP

El MVP de chat contextual no debe aplicar acciones por si solo. Debe devolver propuestas.

```ts
type LocalAiMvpOutput = {
  message: string;
  actions?: AiOutputAction[];
};
```

Ejemplos de iniciadores UI:

- `write_to_lily_code`: "Quieres transcribirlo en LILY-CODE?"
- `write_to_notes`: "Quieres pasarlo a nota?"
- `publish_to_room_chat`: "Quieres enviarlo al chat?"
- `send_midi_to_hyperpiano`: "Quieres probarlo como notas MIDI en HYPERPIANO?"

Estas acciones no implican permiso de escritura. El frontend abre preview, diff, buffer temporal o confirmacion segun corresponda.

## Vault RAG

```ts
type RagQueryRequest = AiRunRequest & {
  task: 'rag_query';
  input: {
    message: string;
    selectedText?: string;
  };
  context: {
    mode: 'vault' | 'course' | 'session';
    includePublicNotes?: boolean;
    includeCourseNotes?: boolean;
    maxChunks?: number;
  };
};
```

Indice recomendado:

```ts
type VaultChunk = {
  id: string;
  sourcePath: string;
  title?: string;
  courseId?: string;
  unitId?: string;
  tags: string[];
  visibility: 'public' | 'course' | 'teacher' | 'private';
  content: string;
  updatedAt: string;
};
```

Reglas:

- filtrar antes de recuperar;
- citar archivos fuente;
- marcar inferencias;
- devolver `error` o `diagnostics` cuando el contexto sea insuficiente.

## LilyPond

```ts
type LilypondAiRequest = AiRunRequest & {
  task: 'lilypond_generate' | 'lilypond_repair' | 'lilypond_explain';
  input: {
    code?: string;
    message?: string;
    compilerError?: string;
  };
  options?: AiRunRequest['options'] & {
    constraints?: {
      notationLevel?: 'beginner' | 'intermediate' | 'advanced';
      preserveStructure?: boolean;
      maxBars?: number;
    };
  };
};
```

Respuesta esperada:

```ts
type LilypondAiOutput = {
  explanation: string;
  patch?: AiPatch;
  diagnostics?: AiDiagnostic[];
};
```

Reglas:

- preferir patches revisables;
- validar con compilador cuando exista tool disponible;
- no aplicar cambios automaticamente;
- conservar intencion musical si `preserveStructure` es true.

## Public corpus LilyPond

La carpeta publica LilyPond debe organizarse para servir como corpus de ejemplos y fine tuning futuro. La ruta canonica es `public/lilypond`; en el workspace actual se detecta `s123/public/lilypond`.

Estructura sugerida:

```txt
public/lilypond/
  examples/
  repairs/
  explanations/
  transformations/
  evals/
  summaries/
```

Cada item util para fine tuning deberia poder resumirse asi:

```ts
type LilypondTrainingSummary = {
  id: string;
  sourcePath: string;
  task: 'generate' | 'repair' | 'explain' | 'transform' | 'micro_eval';
  prompt: string;
  input?: string;
  expectedOutput: string;
  diagnostics?: AiDiagnostic[];
  tags: string[];
  level?: 'beginner' | 'intermediate' | 'advanced';
};
```

## Microevaluacion

```ts
type MicroEvalRequest = AiRunRequest & {
  task: 'micro_eval';
  input: {
    message?: string;
    selectedText?: string;
    prompt?: string;
  };
  context: {
    mode: 'course' | 'session' | 'vault' | 'selection';
    maxChunks?: number;
  };
};
```

Salida:

```ts
type MicroEvalResponse = AiRunResponse & {
  output: {
    message: string;
    microEval: MicroEval;
    citations?: AiCitation[];
  };
};
```

Ejemplo de bloque exportable:

```eval
id: lilypond-repair-01
type: code_ai
language: lilypond
mode: self
prompt: |
  Corrige el fragmento para que compile y conserva la intencion ritmica.
provider: ollama
model: qwen2.5-coder:latest
checks:
  - compiles
  - preserves_meter
  - readable_notation
allowEdit: true
```

## Evolucion del servicio Fastify

El servicio `services/ollama-api` hoy esta centrado en `/api/correct`. Se recomienda evolucionarlo asi:

```txt
/api/correct      correccion academica actual
/api/run          generacion por taskType
/api/models       modelos disponibles
/api/health       estado
```

`/api/run` debe ser interno al backend Astro o protegido por token. Ollama no debe exponerse directamente.

## Compatibilidad

Primer paso seguro:

1. implementar `POST /api/ai/run` en Astro;
2. hacer que `eval_correct` delegue en la logica actual de `/api/ai/correct`;
3. mantener `/api/ai/correct` sin cambios de contrato para demos existentes;
4. agregar tareas nuevas una por una.
