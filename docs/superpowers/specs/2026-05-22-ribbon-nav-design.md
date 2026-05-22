# Ribbon Nav — Design Spec
Date: 2026-05-22

## Goal

Replace the top horizontal `Header.astro` and the two floating `course-sidebar-handle` buttons in `[...slug].astro` with a single vertical ribbon bar (Obsidian-style). On mobile it becomes a bottom bar (TikTok-style) with the course nav sliding in from the left (Obsidian mobile-style).

This is a structural reorganization only — no new functionality, no forum redesign, no info panel redesign. Deployable in the short term.

## Architecture

### New files

- `src/components/Ribbon.astro` — ribbon markup, receives props from `[...slug].astro`
- `src/styles/ribbon.css` — all ribbon styles, imported by `Ribbon.astro`

### Deleted / replaced

| What | Where | Replaced by |
|---|---|---|
| `<Header />` import + usage | `[...slug].astro` | `<Ribbon />` |
| `Header.astro` | `src/components/` | Keep as-is for non-ribbon pages (login, about, etc.) |
| `.course-sidebar-handle--left` button | `[...slug].astro` ~L3388 | ☰ circle item in ribbon |
| `.course-sidebar-handle--right` button | `[...slug].astro` ~L3399 | ℹ️ circle item in ribbon |
| `.course-sidebar-handle` CSS block | Inline in `[...slug].astro` | Migrated to `ribbon.css` |

### Unchanged

- All `data-sidebar-toggle` / `data-left-open` / `data-right-open` JS logic — ribbon reuses the same data attributes
- `.course-container` grid — one 44px column is prepended; everything else stays
- `.sidebar--left`, `.sidebar--right` panels — untouched
- Dockview workspace — untouched

## Layout

```
Desktop:
[Ribbon 44px] [Course nav panel ~260px] [Content flex] [Right panel ~460px]

Mobile ≤500px:
[Content, full width]
[Bottom bar 60px fixed]   ← ribbon rotated
[Course nav: position:fixed, slides from left]
```

## Ribbon.astro — Props

```ts
interface Props {
  courseId: string;
  courseHref: string;
  performativeRoomHref: string;   // empty string = hide Vivo item
  session: Session | null;
}
```

## Ribbon items (top → bottom, desktop)

### Group: app-chrome

| Item | Element | Action |
|---|---|---|
| Brand logo | `<a href="/">` | Navigate home. Empty `.ribbon-beacon` span inside (hidden dot, placeholder for future framework update indicator) |
| ☰ Course nav | `<button>` circle | `data-sidebar-toggle="left"` — activates existing JS |
| 👤 Profile | `<a href="/dashboard">` | Shows session user initial as avatar; hidden if no session |
| 🔍 Search | `<button>` | Opens existing search modal on click (same as current `shift+?` shortcut). The button itself does not expand; `≤500px` icon only, `>500px` icon with no label change. Shortcut `shift+?` preserved. |
| 📺 Vivo | `<a href={performativeRoomHref}>` | Hidden (`display:none`) when `performativeRoomHref` is empty |
| 💬 Foro | `<a href="/foro">` sparse | Links to `/foro` page for now. Panel integration is out of scope (future forum redesign spec). |
| 📊 Actividad | `<a href="/dashboard">` | Navigate to dashboard |
| 🌙 Theme | `<button>` | Toggle dark/light; reuses existing theme toggle logic |
| ℹ️ Info | `<button>` circle | `data-sidebar-toggle="right"` — activates existing JS |

### Group: pods (separated by a `<hr>` divider)

| Item | Action |
|---|---|
| 🕸 Graph | Click → opens full modal (same as current). Drag start → `addPanel` in dockview |
| 📝 Notas | Toggle notas panel in dockview (same as current ribbon shortcut) |
| 🎹 Hyperpiano | Rendered with `opacity:.35` + `pointer-events:none`. No action. |

### Group: bottom (attached to bottom of ribbon)

| Item | Action |
|---|---|
| Course switcher badge | Shows current course short code (e.g. `S1`). Click navigates to `/cursos`. Dropdown with course list is out of scope for this spec. |
| About | `<a href="/about">` in very small text |

## Mobile behavior (≤500px)

### Bottom bar

- `position:fixed; bottom:0; left:0; right:0; height:60px`
- 5 visible items, **no labels**: 🎵 home · ☰ curso · 🔍 buscar · 📺 vivo · ··· más
- All touch targets minimum 44×44px (iOS HIG)
- `··· más` opens an upward sheet (no overlay, no dark backdrop) with remaining items

### Course nav drawer

- `position:fixed; left:0; top:0; height:calc(100% - 60px)`
- Default: `transform:translateX(-100%)`
- Active: `transform:translateX(0)` with `transition: transform 240ms ease`
- Triggered by ☰ item in bottom bar

### "Más" upward sheet

- `position:fixed; bottom:60px; right:0; min-width:180px`
- Contains: 👤 profile, 💬 foro, 📊 actividad, 🌙 theme, ℹ️ info, divider, 🕸 graph, 📝 notas, 🎹 hyperpiano (disabled)
- Closes on outside tap

## CSS approach

All ribbon styles live in `ribbon.css` using the existing CSS variable system (`--c-bg`, `--c-fg`, `--c-border`). The ribbon width is exposed as `--ribbon-width: 44px` so `[...slug].astro` can reference it in the grid template.

```css
/* desktop grid */
.course-container {
  grid-template-columns:
    var(--ribbon-width)
    minmax(0, var(--left-sidebar-width))
    minmax(0, 1fr)
    minmax(0, var(--right-sidebar-width));
}

/* mobile: ribbon moves to bottom */
@media (max-width: 500px) {
  .ribbon { position: fixed; bottom: 0; ... }
  .course-container { grid-template-columns: 1fr; padding-bottom: 60px; }
}
```

## Out of scope (future specs)

- **Forum panel redesign** — the 💬 ribbon item links to `/foro` for now. Future spec should cover: right panel mode "foro" (thread-style, no heavy borders), list structure (nota-foro · general · created forums · + create), mobile bottom sheet at 70% height. Style direction: transparent/threads-like, numbers for message/reply counts, no Discord-style channel clutter.
- Info panel content (page history, YAML metadata, version history)
- Graph drag-to-pod implementation (drag API wiring to dockview)
- Hyperpiano pod activation
- Search full implementation (currently uses existing `shift+?` shortcut)
- Framework update beacon
