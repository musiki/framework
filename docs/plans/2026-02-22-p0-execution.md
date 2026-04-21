# P0 Execution Plan (Self-Assessment)

Fecha: 2026-02-22

## Objetivo P0
Entregar base funcional de autoevaluación en cursos:
- parser estable de bloques `eval`,
- `mcq` autocorregido,
- `mcc` (marcar como completado),
- persistencia mínima por usuario,
- estado visible en sidebar de la lección.

## Tareas

- [x] Definir alcance técnico P0 en documento ejecutable.
- [x] Normalizar parser `eval` para tipos `mcq` y `mcc`.
- [x] Renderizar `mcc` con botón de completado y feedback.
- [x] Mostrar progreso por bloque en sidebar (indicador verde al completar).
- [x] Completar API `GET /api/submissions/my-submissions`.
- [x] Completar API `DELETE /api/submissions/[id]`.
- [x] Integrar persistencia de `mcc` usando backend existente de submissions.
- [ ] Probar flujo end-to-end sobre lecciones de ejemplo.

## Criterios de aceptación

1. Bloques `eval` inválidos no rompen la página.
2. `mcq` mantiene comportamiento actual y restaura intentos previos.
3. `mcc` persiste estado y al refrescar mantiene “completado”.
4. Sidebar muestra estado por bloque de la página.
5. Usuario no autenticado recibe error controlado sin romper UI.

## Validación actual

- Parser validado sobre todos los bloques `eval` en `src/content/cursos` (6 bloques parseados).
- Endpoints nuevos compilables con `node --check`.
- Build general del proyecto bloqueado por issue externo al P0:
  - Falta `/auth.config.ts` en raíz (actualmente aparece en `docs/auth.config.ts` como archivo no trackeado).
