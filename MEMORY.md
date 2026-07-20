# MEMORY.md — Project Activity Log

<2026-07-20 global-site-themes-invulne> <br>
Sistema experimental de temas editoriales globales, implementado desde HEAD `abee52a`:
- `Default` conserva su paleta y familia tipográfica; `Invulne` añade una identidad independiente de claro/oscuro centrada en lectura, con Literata para texto y Atkinson Hyperlegible Next para interfaz.
- Desde el refinamiento de layout, `Default` e `Invulne` comparten exactamente medida de lectura, tamaños, line-height, espaciados, cajas, jerarquía de sidebar, highlight y geometría de listas; sólo difieren sus tokens de color y `font-family`.
- La preferencia vive en PostgreSQL (`SiteSetting.globalTheme`) mediante `postgres-patches/migrations/20260720193000_site_theme_setting.sql`; toda visita la lee desde `GET /api/site/theme`, aplica primero el último valor conocido para evitar flash y luego sincroniza el valor autoritativo.
- El único switch aparece en la barra superior del dashboard docente, sólo para roles globales `teacher`/`admin`; se retiró de Header y Ribbon. `PUT /api/site/theme` revalida sesión, usuario y rol en servidor antes de cambiar el tema para todas las personas; estudiantes y llamadas anónimas no pueden modificarlo.
- Home y `/cursos` usan un único fondo continuo para `html`, `body`, Header, nav y contenido, sin borde ni corte de color: blanco en claro y, en oscuro, el más claro de los dos fondos previos (`var(--c-bg)`) aplicado también al encabezado.
- Fuentes servidas localmente con `@fontsource-variable`; tokens y reglas en `src/styles/site-themes.css`, sin mezclar el tema editorial con el toggle claro/oscuro existente.
- Paleta Invulne: tinta dark neutral-cálida `#d9d9d4` (sin dominante azul) y activo-localizador con riel cian + esquina magenta de brillo contenido. La estructura compartida usa escala Astro Starlight algo mayor (0.95rem para notas, 0.875rem para TOC, grupos 0.9rem) y ancho base 288–330px.
- Los subárboles heterogéneos de `70 CONCEPTOS`, `80 RECURSOS` y `90 NOTAS` se integraron al mismo contrato: carpetas/sesiones 0.9rem, ítems 0.95rem, line-height 1.4, sangría Starlight de 0.5rem por nivel y una única guía vertical. El primer subdirectorio ya no agrega una sangría redundante; los niveles profundos no reducen tipografía.
- El highlight del sidebar ahora sigue el evento `musiki:active-note` del workspace Dockview: desactiva la nota anterior, activa la nueva con `aria-current`, abre sus carpetas ancestras y la mantiene visible en el scroll; el sidebar docente dinámico conserva el mismo estado tras refrescarse.
- Listas de lectura: marcadores geométricos CSS centrados contra la primera línea mediante `lh`; triángulo amarillo de nivel 1 aumentado y acercado, círculo azul de nivel 2 reducido/con más aire y cuadrado naranja de nivel 3 reposicionado/separado. Se limita a superficies editoriales para no alterar menús ni controles.
- Validado: 76/76 tests y `npx astro build` exitoso. `astro check` sigue fallando por 1865 errores TypeScript preexistentes, pero el filtro sobre los archivos nuevos/modificados del tema no encontró diagnósticos.

<2026-06-28 page-info-active-note-sync> <br>
Info sidebar ahora sigue a la nota activa dentro del SPA Dockview (antes quedaba congelado en _index porque las notas abren en paneles sin re-render del shell):
- Lib compartido `src/lib/page-properties.ts` (`buildPageProperties`) extraído del IIFE inline de `[...slug].astro` (que ahora lo importa).
- `src/pages/api/get-note-content.ts` devuelve `pageInfo: { properties, history, sourcePath }` (usa `buildPageProperties` + `getCoursePageHistory`).
- `dockview-workspace.ts`: `loadPreviewContent` propaga `pageInfo`; `renderPreview` despacha `musiki:active-note` {slug, courseId, pageInfo}; `onDidActivePanelChange` lo despacha al cambiar de panel (con pageInfo null → fallback fetch).
- `[...slug].astro` (cliente): listener `musiki:active-note` reconstruye Propiedades + Historial del `#page-info-sidebar` (`buildPropertiesHtml`/`buildHistoryHtml`/`applyPageInfo`/`refreshPageInfo`), usando el pageInfo del evento o un fetch a get-note-content. Guard `window.__musikiPageInfoBound` para no duplicar el listener.
- Validado: frontmatter, script, lib, endpoint y dockview transpilan sin errores; test del lib OK.

<2026-06-28 dashboard-eval-log-centralizado> <br>
El log de evals del dashboard (`buildTeacherEvalProjection`) usaba `scopedTeacherSubmissions` (filtrado por curso activo + año del selector), por eso una entrega de una nota pública no aparecía. Fix en `src/pages/dashboard.astro`: alimentar el log desde `teacherDataSubmissions` (todas las entregas no-meta, sin scope de curso/año) → fuente de verdad centralizada con TODO tipo de eval (mcq/combinatoria/short_ai/…). En `src/lib/dashboard/teacher-eval-projection.ts` se agregaron columnas **Curso** (de `assignment.courseId`/`payload.courseId`) y **Tipo** (de `assignment.evalType`/`payload.type`, con fallback inferido del patrón del evalId `<slug>-<tipo>-NN`), más search. Validado: proyección sin errores de sintaxis. Nota: el inventario de evals DEFINIDOS (aunque nadie responda) sigue siendo `eval:sync:db` → tabla `Assignment` (requiere content:assemble de s123).

<2026-06-28 page-info-reorder> <br>
Reorden del panel Info (`#page-info-sidebar` en `[...slug].astro`): se quitó el kicker "Page info" y el título redundante "Historial y versiones" (header `--bare`, solo ×). Orden: PROPIEDADES primero (sin cambios), luego HISTORIAL como `<details>` plegado por defecto que reusa el estilo de Propiedades (`.page-info-props`) y unifica la meta antigua (fuente/subido/fecha/actualizado/autor/commit) + la lista de commits. Cada commit en UNA línea (autor · fecha) con los enlaces Commit/Comparar reemplazados por íconos GitHub (octicons git-commit / git-compare) `.page-info-gh-link`. CSS viejo de `.page-info-meta`/kicker/title queda como dead-code inocuo. Sin cambios de script; estructura JSX balanceada.

<2026-06-28 progress-endpoint-markers> <br>
Log de evals + markers del sidebar confiables (worktree sobre HEAD f06a6d0, sin commit):
- Aclaración de arquitectura: el dashboard `?tab=log` (`buildTeacherEvalProjection`) lista la tabla `Submission` (1 fila por entrega, type-agnóstica: mcq/combinatoria/short_ai aparecen igual). Captura todos los evals RESPONDIDOS. El inventario de todos los evals DEFINIDOS es el catálogo → tabla `Assignment` (poblada por `npm run eval:sync:db`), y requiere `content:assemble` de las notas s123.
- Nuevo endpoint `GET /api/progress/me[?courseId]`: cruza `Submission` ⋈ `buildEvalCatalog` (evalId→nota) y devuelve por nota `{completed, evaluated, submissions, noteSlug, ...}` + totals. Server-authoritative, accesible directo por URL para "certeza".
- Sidebar markers: refactor `setLessonMarker()` + `applyServerProgress()` que consume `/api/progress/me` y marca TODAS las notas respondidas (no solo las visitadas), por coincidencia de slug (último segmento del href), merge con read-state local. Llamado en init y tras cada `saveSubmission`. `read` sigue en localStorage (no hay campo server).
- Validado: endpoint y script sin errores de sintaxis. Pendiente: smoke test del match de slug y que el catálogo vea las notas s123 (assemble).

<2026-06-28 sidebar-active-link-fix> <br>
TOC inline, estilo activo Starlight y markers de progreso no aparecían porque dependían de `.lesson-link.active`, que el server NO setea para notas de concepto (public/*). Fix en `src/pages/[...slug].astro`: helper `getCurrentLessonLink()` que ubica el link de la nota actual por coincidencia de `href` con `location.pathname` (fallback de `.active`) y le agrega `.active`. Usado por `injectInlineToc()` y `currentPageKey()`. Con esto se encienden a la vez: riel-acento activo, TOC inline bajo la nota, y la clave del store de progreso (markers leído/completado/evaluado).
- El warning de consola "interactive element inside <summary>" / "Disallowed descendant" (7) es PREEXISTENTE: botones `.chapter-editor-link` dentro de `<summary class="chapter-title">` en el árbol del sidebar; no proviene de estos cambios (se puede arreglar moviendo el botón fuera del summary si molesta).
- Los markers requieren haber leído/respondido (el store se llena por visita/submission). Caso multi-panel Dockview aún sin tracking de nota activa.
- Validado: script sin errores de sintaxis.

<2026-06-28 dockview-evals-css-fix> <br>
Diagnóstico raíz: las notas se renderizan dentro de paneles Dockview (`renderPreview` en `src/scripts/course/dockview-workspace.ts`), no en el `#cnw-root` server-rendered. Consecuencias y fixes (worktree sobre HEAD f06a6d0, sin commit):
- CSS del sidebar/lectura "no aparecía" porque estaba en el `<style>` SCOPED y los `lesson-link`/contenido se inyectan como HTML crudo (sin atributo de scope). Movido a `<style is:global>`: overrides globales para `.sidebar--left .lesson-link.active` (riel Starlight), `.lesson-state`, `.class-toc--inline`, sentinel y tipografía de lectura (ahora también `.cnw-md` de los paneles).
- Evals "rara vez renderean": `renderPreview` inyecta `renderedHtml` (con los `.eval-block-wrapper`) pero nunca los hidrataba; el bootstrap de `[...slug].astro` solo corría sobre el documento. Refactorizado a `hydrateEvalScope(scope)` idempotente (marca `data-eval-hydrated`), expuesto como `window.__musikiHydrateEvals`, y llamado desde `renderPreview` tras inyectar el contenido del panel.
- Rótulo de sección: `# evaluación` → `# ACTIVAR!` en las 49 notas de s123 y en `MANUAL.md` (convención).
- PENDIENTE (no resuelto): Page Info no reacciona al cambiar de nota porque las notas abren como paneles Dockview sin re-render del shell (la URL queda en el _index). Falta despachar el frontmatter de la nota activa (evento `musiki:active-note`) y reconstruir la sección "Propiedades" client-side; el historial de commits requeriría endpoint server. Nota: dentro de paneles, el contexto de submission usa la URL del índice (tracking por-curso, no por-nota) — a revisar.
- Validado: scripts de `[...slug].astro` y `dockview-workspace.ts` sin errores de sintaxis.

<2026-06-28 right-sidebar-pods> <br>
Sidebar derecho de `src/pages/[...slug].astro` unificado como stack de pods tipo Obsidian (Foro + Info):
- Causa del bug: `#page-info-sidebar` es un overlay (`position:absolute; inset:0; z-index:18`) dentro de `aside.sidebar--right` (cuya base es el foro). Foro y Page Info competían por la columna sin coordinarse: el botón del foro no "switcheaba" porque el overlay de info quedaba abierto encima; y el Page Info parecía congelado.
- Fix: estado único = `data-page-info-open` ('true'=pod info, 'false'=pod foro); `rightOpen` controla visibilidad de la columna. Helpers nuevos `podOf`/`setRightPod`/`toggleRightPod`/`syncRightPodTabs` reemplazan a `togglePageInfo`/`closePageInfo`. El botón de borde derecho ahora hace `toggleRightPod('forum')`; ⌘/Ctrl+I y `musiki:open-page-info` hacen `toggleRightPod('info')`; la × del Page Info vuelve al foro.
- UI: barra de tabs `.right-pod-tabs` (Foro / Info) sobre el overlay (z-index 20), con estado activo; el panel info arranca bajo la barra (`inset: 2.55rem 0 0 0`). Tabs ocultas si no hay foro.
- Page Info reacciona a cada nota porque el `<section>` se server-renderiza por página (ClientRouter full-swap) y ya no queda tapado por un overlay desincronizado.
- Validado: script grande sin errores de sintaxis. Pendiente: smoke test; y decouplar `rightOpen` de `hasRightSidebar` si se quiere abrir Info en páginas sin foro.

<2026-06-28 eval-blocks-restyle> <br>
Restyle de los bloques `eval` en `src/pages/[...slug].astro` (CSS en el `<style>`, sin tocar renderers):
- Código de colores por tipo vía `.eval-block-wrapper[data-eval-type]` (mcq/msq azul, combinatoria cian, short_ai/reference_ai violeta, mcc verde, poll ámbar, wordcloud verde-agua, patch_ai naranja) con var `--eval-accent`/`--eval-accent-soft`, alineado a la paleta del grafo.
- `.eval-block`: card con riel-acento izquierdo, borde tintado y fondo suave; token geométrico `::before` por tipo (círculo/diamante/triángulo/cuadrado/pentágono/hexágono) replicando el lenguaje de formas del grafo.
- `.eval-submit`: botón pill con relleno acento, sombra de color, hover lift y punto circular (gamificación). `.mcq-option`: controles geométricos custom (radio=círculo, checkbox=cuadrado) con relleno acento al marcar; hover con tinte. Combinatoria y feedback alineados a `--eval-accent`.
- Tracking: tras `saveSubmission` exitoso se llama `updateCourseProgress()` para reflejar al instante el resultado en el mapa de progreso/sidebar (evaluado/completado) y en el log del usuario (Submission ya persiste answer/isCorrect/score/meta por `/api/eval/submit`).
- Validado: script grande sin errores de sintaxis. Pendiente smoke test visual.

<2026-06-28 sidebar-toc-progress-starlight> <br>
Sidebar izquierdo de `src/pages/[...slug].astro` (worktree sobre HEAD f06a6d0, sin commit):
- TOC inline estilo Moodle: `injectInlineToc()` reubica el bloque `#class-toc` ("Contenido") debajo del `li.lesson-item` de la nota activa tras `buildClassToc()`; CSS `.class-toc--inline` (guía izquierda + indent). Resuelve que el TOC se perdía al fondo en courses grandes.
- Mapa de progreso por entry: store localStorage `musiki:progress:<user>:<courseId>` con `{read, completed, evaluated}`. `read` = IntersectionObserver sobre un `.reading-end-sentinel` al final de `.content-area`; `completed` = algún `mcc` completo en la página; `evaluated` = alguna submission no-mcc en la página. `applyCourseProgressToSidebar()` pinta marcadores `.lesson-state` (✓ completado verde / ◑ evaluado acento / ◷ leído dim) en cada `.lesson-link[data-lesson-page-slug]`. Se acumula a medida que el estudiante navega (client-side, por navegador; NO es un join server-wide). Llamadas añadidas tras `buildClassToc()`.
- Estilo Starlight (parcial): item activo con riel-acento izquierdo + tinte; tipografía de lectura (.content-area > .class-content: Inter, line-height 1.75, ritmo de h2/h3). No se tocaron iconos de tipo, puntitos de progreso mcc ni drag/resize.
- Validado: script grande sin errores de sintaxis (typescript.transpileModule). Pendiente: smoke test visual; para un mapa de completado/evaluado autoritativo de todo el course conviene un endpoint server que cruce submissions+eval-catalog (hoy es por-visita/localStorage).

<2026-06-28 graph-refinos> <br>
GraphModal.astro — 6 mejoras (worktree sobre HEAD f06a6d0, sin commit):
1. Labels +40% (tag 10.2→14.3, doc 12→16.8).
2. Filtro pasó de botón público/todo a `<select#graph-view-select>` con `viewMode` = público | todo | curso. Builder agrega `node.course` (cursos/<id> o frontmatter `project`); `selectDataset`/`filterByCourse`/`availableCourses` (orden s123,i1,cym,i2). Disponible sin login (el dataset anon ya es publicOnly; 'todo' solo para logueados).
3. Tag links animados como puntos finos (dashLen 1 / gap 4, ciclo 1200ms) preservando `connect` punteado y jerarquía sólida (se corrigió que `animateDashes` pisaba el dash de connect).
4. Preview de nota en hover: panel derecho fijo con `backdrop-filter` y máscara/gradiente que desvanece a la izquierda; muestra título + `excerpt` (nuevo campo en builder, body→texto plano limpiando html/obsidian/md, ~300 chars; fallback `def`).
5. Grafo resizable (listener `resize` con rAF) y HUD responsive: @media ≤768px apila HUD; ≤500px leyenda solo-iconos, preview oculto, HUD compacto.
6. Folding reescrito: se quitó el modelo Alt-click/focus. Ahora click en nodo = abre/cierra su rama (`collapsedNodes`, sobre jerarquía hypo/hyper), shift+click = abre la nota; `[` pliega y `]` despliega un nivel global (`foldLevel`/`foldMaxDepth`, hasta root de categorías), `Esc` resetea folding y luego cierra. `applyFolding` filtra el dataset (no solo mutea); pipeline: selectDataset→applyLayerFilters→applyFolding. HUD `#graph-focus-hud` reusado para nivel/ramas.
Validado: script y builder sin errores de sintaxis; artefacto público regenerado. Los rel-links y mis notas s123 aparecen tras `content:assemble`. Falta smoke test visual en dev.

<2026-06-28 page-info-propiedades> <br>
Sidebar derecho (`src/pages/[...slug].astro`): nueva sección "Propiedades" que muestra el YAML/frontmatter de la nota, ubicada en el panel Page info entre la meta (Fuente/autor/commit) y "History".
- Frontmatter (script): `pageProperties` deriva de `currentEntry.data` con orden preferente (`type, def, alias, status, project, person, year, tags, hyper, hypo, connect, …`), oculta campos de routing/presentación (`title, slug, theme, reveal, coverImage, updatedAt, …`), y clasifica cada valor: `links` (hypo/hyper/connect/parent → chips `[[..]]` enlazadas a `/<slug>`), `list` (arrays como tags → chips estáticos), `json` (objetos como `spaced`), `text` (escalares).
- Template + CSS: `.page-info-properties` / `.page-info-props` / `.page-info-prop-chip` siguiendo el estilo de `.page-info-meta`/`.page-info-history`.
- Validado: frontmatter TS sin errores de sintaxis (typescript.transpileModule). Falta smoke test visual en dev.

<2026-06-28 graph-topoi-hypo-hyper> <br>
Grafo: relaciones jerárquicas en datos + highlight/mute por topos (worktree sobre HEAD f06a6d0, sin commit).
- `src/scripts/build-graph-data.mjs`: ahora emite enlaces tipados desde frontmatter `hypo`/`hyper`/`connect` (helper `extractRelationTargets`), con `type: 'rel'` y `relType`. Antes solo se leían wikilinks `[[...]]` del cuerpo, así que la estructura hypo/hyper de las notas atómicas no llegaba al grafo. Verificado contra el frontmatter real de s123 (resuelve targets por slug/base).
- `src/components/GraphModal.astro`: nuevo modo solo/highlight por topos acoplado a la leyenda existente. Click normal en un item de la leyenda (que ya lista los topoi = `publicFolder` con su color/forma) highlightea ese topos y mutea el resto (nodos/labels/links atenuados); Shift/Alt-click conserva el ocultar por capa (`hiddenLayers`). Estado nuevo `activeFolders` + helpers `isNodeActive`/`isLinkActive`; clase `.legend-item.is-active`.
- Estilo por `relType` en el mismo componente: `hypo`/`hyper` = jerarquía (línea sólida más gruesa + flecha direccional source→target, color `relHier`), `connect` = lateral (punteada, color `relLateral`), distinto de wikilinks de cuerpo y de tags (dash). Colores nuevos `relHier`/`relLateral` en `getThemeColors` (claro/oscuro) y guía de relaciones no-clickeable en la leyenda. API force-graph usada (`linkDirectionalArrow*`, `linkLineDash`) confirmada en `public/scripts/force-graph.min.js`.
- Aislar rama por nodo + folding con shortcuts (mismo componente): Alt/Option-click en un nodo aísla su rama jerárquica (BFS sobre `hypo`/`hyper` no dirigido, excluye `connect`), muteando el resto; toggle con Alt-click de nuevo. Estado `focusNode`/`foldDepth`/`focusSet` (`computeFocusSet`, `setFoldDepth`, `clearFocus`); `isNodeActive` ahora compone topos-solo Y foco; helper `isSoloing`. Shortcuts con el modal abierto: `]`/`+` expande un nivel, `[`/`−` pliega, `Esc` limpia el foco (y recién después cierra). HUD `#graph-focus-hud` con nombre, profundidad y nº de nodos. `applyGraphFilter` recomputa el foco al cambiar el dataset.
- Pendiente: ensamblar contenido (content:assemble) para que las notas de s123 entren a `src/content` y se vean los rel-links; opcional: portar el mismo modo a `GraphPod.astro` (pod de sala) para paridad.

<2026-06-28 eval-combinatoria-srs> <br>
Nuevo tipo de eval `combinatoria` y capa de repetición espaciada SRS (worktree actual sobre HEAD f06a6d0, sin commit).
- `combinatoria` con dos subtipos: `wordbank` (reconstruir frase desde banco de palabras + distractores, orden estricto o laxo) y `sorting` (clasificar ítems en cubetas, estilo DDS). Parser en `src/lib/eval/parse-eval-block.mjs` (`normalizeCombinatoria`), renderer cliente `renderCombinatoria` + dispatch + CSS en `src/pages/[...slug].astro`. Corrección en cliente; persiste vía `/api/eval/submit` (`answer`/`isCorrect`/`score`), sin tocar el contrato de persistencia.
- Passthrough de `spaced` en `common` del parser y en `evalSnapshot` (`src/lib/eval-catalog.ts`), para que `mcq/msq/combinatoria/short_ai` puedan optar a repetición espaciada.
- SRS SM-2: `src/lib/eval/srs.ts` (`sm2`, `qualityFromOutcome`), migración `postgres-patches/migrations/20260628140227_srs_state.sql` (tabla `"SrsState"`), hook best-effort en `submit.ts` (envuelto en try/catch: nunca rompe la entrega), y endpoint `GET /api/srs/due`.
- `short_ai`/`reference_ai` ya estaban implementados (parser + `renderTextAI` + `/api/ai/correct`); no se tocaron.
- Pendiente operativo: aplicar la migración SQL en Postgres; smoke test en dev de los bloques `combinatoria` en una nota de `public/`. Spec de referencia: `s123/EVALUATION.md`.

<2026-05-25 notas-p0-trazas-locales> <br>
P0 de análisis local y anotación manual de NOTAS (worktree actual, sin commit).
- Agregada persistencia `"LiveClassNoteTrace"` en PostgreSQL para trazas por párrafo y versión (`note_id + para_index + text_hash`), con conceptos, relaciones, diagnósticos y modo.
- El panel Estructura calcula cadenas léxicas localmente, usa lematización ligera en castellano, muestra roles manuales/rails verticales y un DAG de relaciones `retoma`.
- Los códigos `local_nlp` preexistentes sin `text_hash` quedan preservados pero fuera del render; la emergencia automática ahora vive únicamente en trazas versionadas.
- Incorporados modos en español; `artistico` mantiene cadenas visibles pero suspende indicios de progresión lineal.
- Sin integración LLM: P1 queda explícitamente separado del pase local determinista.

<2026-05-24 shortcuts-for-notes> <br>
Global shortcuts for CodeMirror notes editors.
- Added `Mod-ArrowUp` (Cmd+Up on Mac, Ctrl+Up on Win/Linux) to go to start of document.
- Added `Mod-ArrowDown` to go to end of document.
- Added `Shift-Mod-ArrowUp` to select to start of document.
- Added `Shift-Mod-ArrowDown` to select to end of document.
- Implemented in `src/scripts/markdown-codemirror.ts`, `src/scripts/notes-editor/editor.ts`, and `src/scripts/course/notes/live-md-editor.ts`.
- Precedence set to high to ensure they work even if default keymaps are present.

<2026-05-08 re-sa-sessions-postgres-patches> <br>
ResourceSession architecture for RE pod, SV/SA interaction fixes, supabase→postgres-patches rename.
- RE: New `ResourceSession` table (distinct from LiveKit attendance `LiveClassSession`). `LiveClassResource` gains `sessionId` FK. Migration applied to production.
- RE: SA uploads now land in "media" folder (was "compartidos"). Session created lazily on first upload. Session bar in RE pod shows name, rename (✎), new (+) buttons.
- RE: "Enviar a SA" right-click on media items dispatches `musiki:sa:load-url` event.
- SA: `loadFileFromUrl(url, name)` public method added. Listens for `musiki:sa:load-url` to load audio from URL without re-uploading.
- SA: Auto-upload on file load (`handleSave()` called if `publish` set), broadcasts `sa-file-sync` via LiveKit.
- SV: Removed wave canvas pane. Unified seek/loop on main canvas: drag=free loop, click=seek, segment click=snap loop.
- SV: Layer toggle buttons now force immediate redraw when paused.
- INFRA: `supabase/` renamed to `postgres-patches/` throughout. Backup scripts updated. `docs/db/database-management.md` rewritten for current Postgres-on-VPS reality.
- API: New `GET/POST/PATCH/DELETE /api/live/session` for ResourceSession CRUD.

<2026-05-04 external-media-ui-fix> <br>
Removed obscuring instructional text from External Media pod.
- Media: Removed "Pega un link de YouTube para abrir una sesión externa sincronizada." from `StageOverlays.astro` and `livekit-room.ts`. This text was obscuring the YouTube search input box when the session was empty.

<2026-05-01 stabilization-and-graph-fixes> <br>
Resolved critical auth crashes, fixed Graph pod rendering, and completed Supabase cleanup.
- ROSTER: Overhauled roster items with a multi-row layout. Added animated speaker icon for active speakers and restored hand-raise (✋) indicator.
- ROSTER: Restored and enhanced the Kick (K) button for teachers. It now lives in a dedicated actions row per participant, clearly labeled as "KICK", and is correctly toggled by the main "K" mode button.
- LILYCODE/Notes: Reverted editor toolbar buttons to icon-only (removed text labels) for a cleaner UI. Labels are now only visible as tooltips on hover. Updated `markdown-editor-tools.ts` and associated CSS.
- ORF: Implemented a highly resilient "salvage" JSON parser in the chat controller. It can now repair common AI syntax errors like unescaped markdown blocks inside JSON, triple quotes, and structural mistakes (misplaced array brackets). This prevents raw JSON dumps in the chat and ensures action buttons are always rendered.
- ORF: Fixed critical parsing bug in `chat/controller.ts` that caused structured responses to show as raw JSON. Implemented more robust regex-based extraction of the JSON payload.
- ORF: Increased AI backend timeout to 10 minutes and adjusted token limits for better DeepSeek-R1 reasoning support.
- ORF: Re-wired structured actions to HYPERPIANO and LILYCODE. Implemented `dispatchLocalMidiNote` for immediate local audio feedback and added global event fallbacks (`musiki:lilypond:write`, `musiki:notes:write`) for more robust editor integration.
- ORF: Added a temporary "TH" (Test Hyperpiano) button to verify MIDI connectivity.
- ORF: Implemented real-time reasoning display for DeepSeek-R1. Extracted `<think>` blocks in backend and added a scrollable container in the ORF toolbar (0.3rem font, 0.4 opacity).
- ORF: Enabled `deepseek-r1:8b` support and updated model selector. Migrated `ollama-api` service to PM2 for better stability.
- ORF: Wired structured AI actions to workspace pods. Refactored `RoomOrfController` to support array content and optional message context in `executeAction`.
- ORF: Enabled action button rendering in main chat by sending full structured JSON instead of plain text. Implemented automatic markdown stripping for LilyPond code blocks.
- Notes: Overhauled `notas.astro` UI to fix visual regressions. Increased button visibility, added labels to template buttons, reformatted dates to `yy-mm-dd`, and repositioned toolbar date next to the title in a muted italic style.
- Agenda: Fixed UI synchronization issue where a page reload was required to delete newly created reservations. Implemented ID reconciliation in `reloadAfterAction` using server-returned real IDs.
- Agenda: Updated API actions (`reserve-self`, `reserve-group`, `assign-students`, `assign-event`) to return updated payloads for frontend reconciliation.
- Agenda: Fixed critical bug where student agendas disappeared after editing/deleting a block due to missing `__metaKind` in the API payload update.
- Agenda: Added "Editar" button and modal for students to manage their own reservations (comments/notes). Improved UUID matching robustness in frontend/backend.
- IS/VexFlow: Fixed "Instant Score" pod CSS regression and visual bugs. Forced all VexFlow elements to white and set container background to transparent. Resolved "half white half black" rendering issue by using both JS inkColor overrides and aggressive CSS SVG selectors.
- Auth: Fixed `resolveUserIdByEmail` signature mismatch causing 500 errors in Header and admin APIs. Enabled local dev login by disabling origin forcing on localhost.
- Graph: Fixed ForceGraph initialization and resizing for Dockview. Added node search with auto-zoom/center. Expanded default filter to show course nodes.
- Media: Restored External Media search results by refactoring pod layout to flex-column (anchoring toolbar to bottom) and resolving CSS conflicts that hid thumbnails.
- Cleanup: Removed all remaining Supabase client remnants from `Header.astro` and `[...slug].astro`. Migrated wordcloud image generation to Cloudflare R2 public URLs. Simplified library APIs by removing legacy Supabase parameters.
- Eval/cátedra-recorrido: Added 4 new eval types to `parse-eval-block.mjs` (`coloquio` self-determination, `proyecto` 4C, `conexion` connectivism, `peer_rubric` stigmergy) with normalizers + switch registration. Verified parsing (8/8 in eval-lab, 4/4 unit, no i1 regression). Runtime renderers in `cursos/[...slug].astro` still pending.
- Eval: Added `POST /api/eval/parse` (normalize-only, no persistence) for the teacher Eval Lab. Added `GET /api/progress/pod?courseId=` composing `buildGraphData` edges + Submission/catalog states for the progress pod.
- Docs: New Starlight teacher reference `docs/src/content/docs/docentes/evaluaciones.mdx` (type map, new-type syntax, live parse lab). New course testbed note `i1/cursos/i1/06-docentes/eval-lab.md` with one live block per type.
- Docs/evaluation: Reorganized around delegation-resistance axis. Rewrote `Evaluation MOC.md` as schematic hub; new `paradigmas-evaluacion.md` (edu paradigms → evaluation) and `catedra-recorrido.md` (portfolio rubric: 1 proyecto/5 conexiones/2 coloquios/1 estigmergia/1 aporte). Pod prototype at `docs/evaluation/pod-progreso-prototipo.html`.
- Eval/renderers: Added unified `renderCatedra` in `[...slug].astro` for the 4 new eval types (conexion/coloquio/proyecto/peer_rubric) — form + real submit via `saveSubmission` (feeds progress). Registered in the hydration dispatch + CSS accents. Verified: the client script block transpiles clean.
- Progress pod: New `components/course/CourseProgressPod.astro` — self-contained right-side overlay, three.js connectome + serpentine path, fetches `/api/progress/pod?courseId=`, refreshes on `musiki:active-note`. Toggled by a new Ribbon button `[data-progress-toggle]`. Included in `[...slug].astro` (non-public reader). Needs dev-server smoke test.
- Progress pod → right-sidebar TAB: Converted the standalone overlay into a third right-sidebar pod (Foro · Info · Progreso). Generalized the binary right-pod state (`data-page-info-open`) to 3-way via added `data-progress-open`; updated podOf/setRightPod/toggleRightPod/syncRightPodTabs. Inline panel `#progress-sidebar` mirrors the Info panel overlay. `CourseProgressPod.astro` is now markup-less: exposes `window.__musikiProgressLoad()` (called on tab activation), renders serpentine path + three.js connectome, refreshes on `musiki:active-note`. Ribbon `[data-progress-toggle]` now routes to `toggleRightPod('progress')`. Verified DB-free: `graph:build` yields 36 i1 doc nodes + 180 non-tag edges (endpoint course filter works); both edited script blocks transpile clean.
- Progress pod connectors: Extended /api/progress/pod to classify each Submission by catalog evalType → per-concept achievement flags (conns/coloquio/peer/aporte) + course-level rubric tally (proyecto/conexiones/coloquios/estigmergia/aporte vs REQUIRED) + project 4C level. Pod now draws rubric counters (bars), conexión ray, coloquio/peer/aporte badges, and reads courseId from container `data-live-course-id` (fixes empty pod on public notes whose URL isn't /cursos/). Bug fix: saveSubmission now dispatches `musiki:progress-changed`; pod reloads if open (previously only refreshed on tab re-activation / course change). Verified: 3 files transpile; escucha-situada resolves as s123 node with 6 rel edges.
