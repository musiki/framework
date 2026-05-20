# ORF Skill Runtime Refurbish

## Estado

Implementado como base limpia para el pod `orf` del room.

ORF deja de comportarse como un chatbot que imprime JSON o muestra botones de confirmacion. El modelo devuelve una respuesta humana y un paquete de acciones tipadas; el runtime valida esas acciones y el controller del pod las ejecuta directamente contra los pods vivos de Musiki.

## Principio central

ORF usa una arquitectura de capacidades declarativas:

```txt
usuario / evento de room
  -> contexto por capas
  -> modelo ORF
  -> OrfResponse JSON interno
  -> normalizacion + validacion
  -> ejecucion directa en pods
  -> traza humana en ORF/chat
```

No se usa routing por palabras clave como mecanismo principal. Las palabras ayudan al modelo a decidir, pero la unidad real es una accion con contrato.

## Capas de contexto

El endpoint `POST /api/ai/run` arma el prompt con prioridad:

1. curso activo y sesion activa;
2. notas recuperadas del indice de Musiki (`public/search-index.json` y embeddings si existen);
3. contexto interno de ORF como agente transversal de Musiki;
4. websearch opcional para informacion fresca.

La busqueda web se activa si `context.webSearch === true` o si el prompt pide actualidad, web, noticias, busqueda o informacion reciente. Providers soportados:

- `ORF_WEB_SEARCH_URL`: endpoint propio con `?q=...`, espera `results` o `items`;
- `BRAVE_SEARCH_API_KEY`;
- `TAVILY_API_KEY`.

Si no hay provider configurado, ORF sigue funcionando con curso/vault/agente.

## Contrato de salida

El protocolo interno vive en `src/lib/orf/schema.ts`. El registry minimo de capacidades y skills vive en `src/lib/orf/capabilities.ts`; el prompt de `/api/ai/run` lo usa para exponer capacidades como manifests declarativos en lugar de una lista accidental de keywords.

```ts
type OrfResponse = {
  summary: string;
  actions: OrfAction[];
  citations?: OrfCitation[];
  warnings?: string[];
};
```

Acciones iniciales:

```ts
type OrfAction =
  | { type: 'chat.message'; markdown: string; roomId?: string }
  | { type: 'notes.write'; target?: 'course' | 'room' | 'personal'; mode?: 'append' | 'new-note' | 'replace-selection'; title?: string; markdown: string }
  | { type: 'board.note'; roomId?: string; text: string; x: number; y: number; color?: string; size?: 'sm' | 'lg' }
  | { type: 'board.draw'; roomId?: string; strokes: OrfBoardStroke[] }
  | { type: 'midi.sequence'; target: 'hyperpiano' | 'pod'; events: OrfMidiEvent[]; tempo?: number; explanation?: string }
  | { type: 'lilypond.score'; title?: string; source: string; renderPreview?: boolean };
```

`normalizeOrfResponse()` acepta tambien las acciones legacy (`write_to_lily_code`, `write_to_notes`, `publish_to_room_chat`, `send_midi_to_hyperpiano`) para que respuestas viejas no rompan el room.

## Ejecucion en pods

El controller `src/scripts/room/orf/controller.ts` ejecuta las acciones sin botones de confirmacion:

- `lilypond.score`: abre `lily-code`, escribe el source y abre `lily-render` si `renderPreview` esta activo;
- `notes.write`: abre `notes` y agrega markdown;
- `chat.message`: publica como `Orf-<model>`;
- `midi.sequence`: abre `hyperpiano`, dispara notas locales y las publica por LiveKit si el rol puede tocar instrumentos;
- `board.note`: abre `whiteboard` y escribe texto;
- `board.draw`: abre `whiteboard` y dibuja trazos normalizados.

El chat compartido ya no renderiza botones de acciones ni ejecuta acciones desde JSON. Si llega JSON viejo, muestra solamente `summary` o `message`.

## Validaciones actuales

El schema normaliza:

- MIDI: maximo 128 eventos, notas `0..127`, tiempos no negativos, velocity `0..1`;
- pizarra: coordenadas `0..1`, maximo 32 trazos y 200 puntos por trazo;
- LilyPond/notas/chat: exige texto no vacio;
- acciones desconocidas: se descartan.

## Proximo incremento recomendado

1. Persistir trazas ORF por sessionId para auditar acciones.
2. Agregar manifests por skill (`composition.generate-motif`, `notation.make-lilypond-score`, `room.draw-board`).
3. Separar permisos por rol y riesgo sin volver a botones de confirmacion; por ejemplo, ejecucion directa en teacher y preview pasivo en student.
4. Agregar validacion real de LilyPond con `/api/lily/render` antes de tocar `lily-render`.
5. Exponer `context.webSearch` como toggle del pod cuando se quiera forzar o impedir websearch.
