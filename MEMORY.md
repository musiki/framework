# MEMORY.md — Project Activity Log

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
