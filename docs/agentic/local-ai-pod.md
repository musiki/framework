# Orf Pod

## Proposito

Crear Orf, un pod transversal de asistencia local para Musiki, basado inicialmente en Ollama, que pueda vivir dentro del conference room y tambien aparecer como asistente contextual en la vista normal de notas.

No se define como un chatbot generico. Se define como una capability del LMS con contexto controlado, permisos explicitos y adaptadores por tarea.

## Contexto del producto

El asistente debe depender primero del curso y la clase activa. Ese contexto incluye:

- `courseId`: materia o curso activo.
- `sessionId`: clase viva o sesion persistente cuando exista.
- `podId`: superficie desde donde se invoca, por ejemplo `conference`, `notes`, `lily-code` o `eval`.
- `role`: `student`, `teacher` o `admin`.
- seleccion activa: texto, nota, bloque LilyPond, eval o recurso visible.

El segundo nivel de contexto son las notas publicas o de curso. El modelo no debe leer el filesystem directamente. Debe consultar un indice explicito que respete visibilidad, curso, tags y estado editorial.

El tercer nivel son superpoderes tecnicos por dominio. El primero es LilyPond. Despues pueden agregarse sintesis sonora, Max/Pd, SuperCollider, Faust u otros lenguajes musicales.

## Capacidades iniciales

### 1. Chat contextual sin RAG

Uso principal:

- responder preguntas sobre la clase activa;
- recapitular contenidos vistos;
- explicar conceptos del curso;
- conectar una nota publica con la sesion actual;
- proponer actividades guiadas;
- generar microevaluaciones formativas.

Regla MVP: el chat del room arranca sin RAG. Solo recibe contexto estructurado de curso, clase activa, rol, pod origen, seleccion visible y mensajes recientes permitidos. El usuario o la superficie elige un `contextMode`; `vault` queda reservado para una fase posterior.

```ts
type AiContextMode = 'none' | 'course' | 'session' | 'vault' | 'selection';
```

Aunque el MVP no escriba automaticamente, la interfaz debe preparar salidas accionables:

- "Quieres transcribirlo en LILY-CODE?";
- "Quieres pasarlo a nota?";
- "Quieres enviarlo al chat como Orf-<modelName>?";
- "Quieres probarlo como notas MIDI en HYPERPIANO?".

Estas salidas siempre empiezan como propuestas. El usuario confirma antes de insertar, publicar, enviar o tocar.

### 2. RAG sobre vault Astro/Obsidian

Uso principal:

- buscar notas relacionadas;
- responder con citas de archivo;
- detectar conexiones entre conceptos;
- sugerir nuevas notas o patches markdown revisables;
- alimentar microevaluaciones con material recuperado.

Regla: cuando el modo sea RAG, la respuesta debe distinguir fuente recuperada, inferencia y limite de evidencia.

### 3. Asistencia LilyPond

Uso principal:

- explicar un bloque LilyPond seleccionado;
- generar un fragmento minimo;
- reparar errores de compilacion;
- transformar material conservando intencion musical;
- anotar un ejemplo para estudiantes.

Regla: el asistente propone patches. El usuario aplica. El compilador valida.

## Superficies UI

### Conference room

El pod `orf` vive como panel lateral o pod acoplable.

Estados:

```ts
type LocalAiPodState =
  | 'idle'
  | 'retrieving'
  | 'generating'
  | 'tool_pending'
  | 'awaiting_user_approval'
  | 'error';
```

Acciones iniciales:

```ts
type AiAction =
  | 'summarize_current_context'
  | 'explain_selected_text'
  | 'find_related_notes'
  | 'generate_guiding_questions'
  | 'create_micro_eval'
  | 'generate_lilypond'
  | 'repair_lilypond'
  | 'draft_markdown_note'
  | 'offer_write_to_lily_code'
  | 'offer_write_to_notes'
  | 'offer_send_to_room_chat'
  | 'offer_send_midi_to_hyperpiano';
```

El pod debe poder participar en el chat compartido como un actor distinguible, con nombre derivado del modelo:

```ts
type AiChatParticipant = {
  displayName: `Orf-${string}`;
  model: string;
  provider: 'ollama';
  source: 'orf';
};
```

Esta participacion debe ser explicita. El asistente no publica automaticamente sus respuestas al chat de la clase; ofrece la accion y el usuario la confirma.

### Vista normal de notas

El asistente aparece como panel compacto asociado a la nota actual. Debe heredar:

- ruta o slug de la nota;
- curso si la nota pertenece a `cursos/**`;
- seleccion de texto si existe;
- visibilidad de la nota;
- usuario y rol.

No debe transformar automaticamente notas canonicas. Puede producir:

- explicacion;
- resumen;
- preguntas guia;
- patch markdown;
- propuesta de bloque `eval`.

El MVP debe preparar el puente hacia el pod de notas aunque todavia no ejecute escritura directa:

```ts
type NotesWriteProposal = {
  target: 'notes-pod';
  mode: 'append' | 'new-note' | 'replace-selection';
  title?: string;
  markdown: string;
  promptLabel: 'Quieres pasarlo a nota?';
};
```

### Lily-code pod

El asistente se integra como acciones dentro del pod LilyPond:

- Ask AI about this code;
- Repair compile error;
- Generate variation;
- Explain notation;
- Create guided exercise.

La salida preferida es un patch o una fuente completa marcada como propuesta.

El MVP debe preparar el puente hacia `LILY-CODE` incluso antes de activar la asistencia LilyPond completa:

```ts
type LilyCodeWriteProposal = {
  target: 'lily-code';
  mode: 'insert' | 'replace-selection' | 'new-buffer';
  source: string;
  promptLabel: 'Quieres transcribirlo en LILY-CODE?';
  compileAfterApply?: boolean;
};
```

La carpeta publica LilyPond debe usarse como corpus futuro para ejemplos, resumenes de estilo y fine tuning. La ruta canonica es `public/lilypond`; en el workspace actual se detecta `s123/public/lilypond`.

### Hyperpiano

El asistente puede proponer eventos musicales para HYPERPIANO, pero no debe reproducirlos sin confirmacion.

```ts
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
```

Este contrato permite que respuestas teoricas, LilyPond o microejercicios puedan convertirse despues en material sonoro.

## Modelo de salidas

Para dejar preparado el fine tuning y las rutas futuras, toda respuesta del agente deberia poder producir una o varias salidas normalizadas.

```ts
type LocalAiOutput =
  | { kind: 'message'; content: string }
  | { kind: 'structured'; content: Record<string, unknown> }
  | { kind: 'write_proposal'; target: 'lily-code'; proposal: LilyCodeWriteProposal }
  | { kind: 'write_proposal'; target: 'notes-pod'; proposal: NotesWriteProposal }
  | { kind: 'chat_publish_proposal'; participant: AiChatParticipant; content: string }
  | { kind: 'midi_proposal'; proposal: HyperpianoMidiProposal }
  | { kind: 'micro_eval'; content: MicroEval };
```

La UI puede mostrar iniciadores segun `kind`. El modelo puede sugerirlos, pero el cliente decide que acciones estan disponibles segun rol, pod activo y estado de la clase.

## UI y CSS

Orf no debe inventar una familia visual nueva. Debe reutilizar variables, clases base y patrones del chat del room tanto como sea posible:

- contenedor visual alineado con `ChatPanel`;
- lista de mensajes compatible con estilos de `.conference-chat-list`;
- item de mensaje compatible con `.conference-chat-item`;
- composicion/input alineados con `.conference-chat-compose`;
- acciones secundarias como botones compactos similares a la toolbar del chat;
- estados de carga/error usando el mismo lenguaje visual que chat y sidebar.

Si hacen falta clases nuevas, deberian prefijarse de forma derivada y pequena, por ejemplo `conference-orf-*`, manteniendo tokens existentes de spacing, border, color y tipografia. La prioridad es que Orf parezca una extension del chat, no otro sistema.

## Principios de permisos

- AI proposes.
- User applies.
- System logs.

El agente no escribe directamente en `public/**`, `cursos/**` ni notas canonicas. Para cambios de contenido debe devolver una propuesta revisable.

Para LilyPond:

1. el modelo propone patch;
2. el sistema muestra diff;
3. el usuario acepta o rechaza;
4. el compilador ejecuta;
5. el resultado y diagnosticos quedan asociados a la sesion o submission.

Para vault:

1. retrieval filtra por rol y visibilidad;
2. respuesta cita fuentes;
3. sugerencias editoriales se entregan como patch markdown;
4. cambios publicables requieren revision docente.

## Perfiles de sistema

### Conference

```txt
Eres un asistente pedagogico local dentro del LMS Musiki.
Responde segun el curso, la sesion activa y los materiales recuperados.
No inventes fuentes.
Distingue entre explicacion, inferencia y sugerencia.
No modifiques contenido ni codigo sin aprobacion explicita.
Cuando uses notas del vault, indica los archivos fuente.
```

### Vault

```txt
Responde solo con base en los fragmentos recuperados cuando el modo sea RAG.
Si el contexto no alcanza, dilo.
Puedes proponer conexiones entre notas, pero debes marcarlas como inferencias.
Respeta visibility, courseId y rol del usuario.
```

### LilyPond

```txt
Asistes en codigo LilyPond.
Prioriza codigo compilable, minimo y legible.
Cuando propongas cambios, entregalos como patch o bloque completo.
Explica errores por linea si hay diagnosticos del compilador.
No cambies la intencion musical salvo que el usuario lo pida.
```

### Microevaluacion

```txt
Generas microevaluaciones formativas, no calificaciones finales.
Produce preguntas guia breves, criterios observables y feedback accionable.
Adapta la dificultad al curso, clase activa y rol del usuario.
Cuando derives preguntas desde notas recuperadas, cita las fuentes.
```

## Relacion con evaluaciones existentes

El sistema actual ya tiene:

- endpoint Astro `POST /api/ai/correct`;
- servicio Fastify `services/ollama-api`;
- tipos propuestos `short_ai`, `patch_ai` y `reference_ai`;
- persistencia de evaluaciones en `Submission`.

Orf debe reusar esa direccion en vez de crear un flujo paralelo. La evolucion natural es pasar de `/api/ai/correct` a un servicio general por tareas, manteniendo `correct` como wrapper de compatibilidad.

## Decision de diseno

Crear `orf`, un pod transversal basado inicialmente en Ollama, con adaptadores separados:

- `chat`: conversacion pedagogica contextual;
- `vault-rag`: recuperacion controlada de notas;
- `lilypond-tools`: generacion, explicacion y reparacion asistida;
- `micro-eval`: preguntas guia y bloques evaluativos formativos.

Orf vive en el conference room y en notas, pero la logica debe quedar como servicios internos reutilizables por otros pods.
