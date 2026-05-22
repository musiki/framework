# Ribbon Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top `<Header>` and the two floating `.course-sidebar-handle` buttons in `[...slug].astro` with a vertical `<Ribbon>` component (44px left column on desktop; fixed 60px bottom bar on mobile ≤500px).

**Architecture:** New `Ribbon.astro` + `ribbon.css` components; `[...slug].astro` swaps `<Header>` for `<Ribbon>`, removes the two floating handle buttons, and updates the `.course-container` grid to prepend the ribbon column. All existing `[data-sidebar-toggle]` JS logic is reused unchanged. `--musiki-header-height` is zeroed out by Ribbon.

**Tech Stack:** Astro, vanilla CSS (CSS variables), vanilla JS for theme toggle and mobile "más" sheet.

---

### File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/styles/ribbon.css` | All ribbon layout, items, mobile bottom bar |
| Create | `src/components/Ribbon.astro` | Ribbon markup, theme toggle script, zeroes `--musiki-header-height` |
| Modify | `src/pages/[...slug].astro` | Swap `<Header>` → `<Ribbon>`, remove handle buttons, update grid CSS |

---

### Task 1: Create `src/styles/ribbon.css`

**Files:**
- Create: `src/styles/ribbon.css`

- [ ] **Step 1: Write the file**

```css
/* ── Ribbon variables ──────────────────────────────────────────────────── */
:root {
  --ribbon-width: 44px;
  --ribbon-bg: color-mix(in srgb, var(--c-bg) 97%, var(--c-fg) 3%);
  --ribbon-border: var(--c-border);
  --ribbon-item-size: 32px;
  --ribbon-bottom-height: 60px; /* mobile */
}

/* ── Desktop ribbon ────────────────────────────────────────────────────── */
.ribbon {
  width: var(--ribbon-width);
  height: 100%;
  background: var(--ribbon-bg);
  border-right: 1px solid var(--ribbon-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 2px;
  overflow: hidden;
  overflow-y: auto;
  scrollbar-width: none;
  flex-shrink: 0;
  z-index: 40;
}
.ribbon::-webkit-scrollbar { display: none; }

/* ── Groups ────────────────────────────────────────────────────────────── */
.ribbon-spacer {
  flex: 1;
  min-height: 4px;
}
.ribbon-divider {
  width: 28px;
  height: 1px;
  background: var(--ribbon-border);
  margin: 4px 0;
  flex-shrink: 0;
}
.ribbon-label {
  font-size: 7px;
  color: color-mix(in srgb, var(--c-fg) 30%, transparent);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  user-select: none;
  margin-bottom: 2px;
}

/* ── Items ─────────────────────────────────────────────────────────────── */
.ribbon-item {
  width: var(--ribbon-item-size);
  height: var(--ribbon-item-size);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: color-mix(in srgb, var(--c-fg) 60%, transparent);
  background: transparent;
  border: none;
  cursor: pointer;
  text-decoration: none;
  transition: background 120ms, color 120ms;
  flex-shrink: 0;
  padding: 0;
  font-size: inherit;
}
.ribbon-item:hover,
.ribbon-item.is-active {
  background: color-mix(in srgb, var(--c-fg) 8%, transparent);
  color: var(--c-fg);
}
.ribbon-item svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

/* circle variant — for sidebar handles */
.ribbon-item--circle {
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--c-fg) 15%, transparent);
}
.ribbon-item--circle:hover,
.ribbon-item--circle.is-active {
  border-color: color-mix(in srgb, var(--c-fg) 30%, transparent);
  background: color-mix(in srgb, var(--c-fg) 8%, transparent);
}

/* brand logo */
.ribbon-item--logo {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  margin-bottom: 4px;
  overflow: hidden;
  border: none;
}
.ribbon-item--logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* profile avatar */
.ribbon-item--avatar {
  border-radius: 50%;
  background: color-mix(in srgb, var(--c-fg) 12%, transparent);
  font-size: 11px;
  font-weight: 600;
  color: var(--c-fg);
}

/* course badge */
.ribbon-item--badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.03em;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--c-fg) 20%, transparent);
  color: color-mix(in srgb, var(--c-fg) 55%, transparent);
  background: color-mix(in srgb, var(--c-fg) 5%, transparent);
}
.ribbon-item--badge:hover {
  color: var(--c-fg);
  border-color: color-mix(in srgb, var(--c-fg) 35%, transparent);
}

/* disabled / future items */
.ribbon-item--disabled {
  opacity: 0.28;
  pointer-events: none;
  cursor: default;
}

/* about link */
.ribbon-about {
  font-size: 8px;
  color: color-mix(in srgb, var(--c-fg) 20%, transparent);
  text-decoration: none;
  padding: 2px 4px;
}
.ribbon-about:hover {
  color: color-mix(in srgb, var(--c-fg) 45%, transparent);
}

/* beacon dot (placeholder) */
.ribbon-beacon {
  display: none; /* shown via JS when update available */
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #e55;
  position: absolute;
  top: 4px;
  right: 4px;
}
.ribbon-item--logo {
  position: relative;
}

/* ── Mobile ≤500px: bottom bar ─────────────────────────────────────────── */
@media (max-width: 500px) {
  .ribbon {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    top: auto;
    width: 100%;
    height: var(--ribbon-bottom-height);
    flex-direction: row;
    justify-content: space-around;
    align-items: center;
    padding: 0 8px;
    border-right: none;
    border-top: 1px solid var(--ribbon-border);
    z-index: 100;
    gap: 0;
    overflow: hidden;
    overflow-x: auto;
  }
  /* show only mobile-visible items */
  .ribbon-item { display: none; }
  .ribbon-item--mobile-visible { display: flex; }
  .ribbon-divider,
  .ribbon-spacer,
  .ribbon-label,
  .ribbon-about { display: none; }
  /* all mobile items need comfortable touch targets */
  .ribbon-item--mobile-visible {
    min-width: 44px;
    min-height: 44px;
    border-radius: 8px;
  }

  /* "más" upward sheet */
  .ribbon-mas-sheet {
    position: fixed;
    bottom: var(--ribbon-bottom-height);
    right: 0;
    min-width: 180px;
    background: color-mix(in srgb, var(--c-bg) 96%, var(--c-fg) 4%);
    border: 1px solid var(--ribbon-border);
    border-bottom: none;
    border-radius: 10px 10px 0 0;
    padding: 8px 0;
    z-index: 101;
    box-shadow: -2px -4px 16px rgba(0,0,0,0.18);
    transform: translateY(100%);
    transition: transform 200ms ease;
  }
  .ribbon-mas-sheet.is-open {
    transform: translateY(0);
  }
  .ribbon-mas-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    font-size: 13px;
    color: var(--c-fg);
    text-decoration: none;
    background: none;
    border: none;
    width: 100%;
    cursor: pointer;
    min-height: 44px;
  }
  .ribbon-mas-item:hover {
    background: color-mix(in srgb, var(--c-fg) 6%, transparent);
  }
  .ribbon-mas-item svg {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    opacity: 0.7;
  }
  .ribbon-mas-divider {
    height: 1px;
    background: var(--ribbon-border);
    margin: 4px 0;
  }
  .ribbon-mas-item--disabled {
    opacity: 0.3;
    pointer-events: none;
  }
}

/* ── Desktop: hide mobile-only elements ─────────────────────────────────── */
@media (min-width: 501px) {
  .ribbon-mas-sheet { display: none; }
  .ribbon-mas-toggle { display: none; } /* "···" button only on mobile */
}
```

- [ ] **Step 2: Verify file created**

```bash
ls src/styles/ribbon.css
```
Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add src/styles/ribbon.css
git commit -m "feat: ribbon nav CSS"
```

---

### Task 2: Create `src/components/Ribbon.astro`

**Files:**
- Create: `src/components/Ribbon.astro`

- [ ] **Step 1: Write the component**

```astro
---
import '../styles/ribbon.css';

interface Props {
  courseId?: string;
  courseHref?: string;
  performativeRoomHref?: string;
  activeCourseCode?: string;
  session?: { user?: { name?: string; email?: string; image?: string } } | null;
}

const {
  courseId = '',
  courseHref = '/cursos',
  performativeRoomHref = '',
  activeCourseCode = '',
  session = null,
} = Astro.props;

const userInitial = (session?.user?.name || session?.user?.email || '?')
  .trim()
  .charAt(0)
  .toUpperCase();
const hasVivo = Boolean(performativeRoomHref);
const badgeLabel = activeCourseCode.slice(0, 4) || '···';
---

<!-- Desktop ribbon / Mobile bottom bar -->
<nav class="ribbon" aria-label="Navegación principal">

  <!-- Brand logo -->
  <a href="/" class="ribbon-item ribbon-item--logo" aria-label="musiki26 — inicio" title="Inicio">
    <img src="/logo-musiki.png" alt="musiki26" />
    <span class="ribbon-beacon" aria-hidden="true"></span>
  </a>

  <!-- Course nav toggle (was .course-sidebar-handle--left) -->
  <button
    type="button"
    class="ribbon-item ribbon-item--circle ribbon-item--mobile-visible"
    data-sidebar-toggle="left"
    aria-label="Navegación del curso"
    title="Navegación del curso (⌘/Ctrl + \)"
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>

  <div class="ribbon-divider"></div>

  <!-- Profile -->
  {session?.user && (
    <a
      href="/dashboard"
      class="ribbon-item ribbon-item--avatar"
      aria-label="Mi perfil"
      title="Mi perfil / Dashboard"
    >
      {userInitial}
    </a>
  )}

  <!-- Search -->
  <button
    type="button"
    class="ribbon-item ribbon-item--mobile-visible"
    id="ribbon-search-btn"
    aria-label="Buscar (Shift + ?)"
    title="Buscar (Shift + ?)"
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
      <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>

  <!-- Vivo (sala performativa) — only when available -->
  {hasVivo && (
    <a
      href={performativeRoomHref}
      class="ribbon-item ribbon-item--mobile-visible"
      aria-label="Sala vivo"
      title="Sala vivo"
    >
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="7" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/>
        <path d="M8 3l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="12" cy="14" r="3" stroke="currentColor" stroke-width="2"/>
      </svg>
    </a>
  )}

  <!-- Foro -->
  <a
    href="/foro"
    class="ribbon-item"
    aria-label="Foro"
    title="Foro"
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </a>

  <!-- Actividad / Dashboard -->
  <a
    href="/dashboard"
    class="ribbon-item"
    aria-label="Actividad"
    title="Actividad"
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
      <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
      <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
      <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
    </svg>
  </a>

  <!-- Theme toggle -->
  <button
    type="button"
    class="ribbon-item"
    id="ribbon-theme-toggle"
    aria-label="Cambiar tema"
    title="Cambiar tema claro/oscuro"
  >
    <!-- sun (shown in dark mode) -->
    <svg class="ribbon-theme-sun" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 2.25a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75ZM7.5 12a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM18.894 6.166a.75.75 0 0 0-1.06-1.06l-1.591 1.59a.75.75 0 1 0 1.06 1.061l1.591-1.59ZM21.75 12a.75.75 0 0 1-.75.75h-2.25a.75.75 0 0 1 0-1.5H21a.75.75 0 0 1 .75.75ZM17.834 18.894a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 1 0-1.061 1.06l1.59 1.591ZM12 18a.75.75 0 0 1 .75.75V21a.75.75 0 0 1-1.5 0v-2.25A.75.75 0 0 1 12 18ZM7.758 17.303a.75.75 0 0 0-1.061-1.06l-1.591 1.59a.75.75 0 0 0 1.06 1.061l1.591-1.59ZM6 12a.75.75 0 0 1-.75.75H3a.75.75 0 0 1 0-1.5h2.25A.75.75 0 0 1 6 12ZM6.697 7.757a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 0 0-1.061 1.06l1.59 1.591Z"/>
    </svg>
    <!-- moon (shown in light mode) -->
    <svg class="ribbon-theme-moon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill-rule="evenodd" d="M9.528 1.718a.75.75 0 0 1 .162.819A8.97 8.97 0 0 0 9 6a9 9 0 0 0 9 9 8.97 8.97 0 0 0 3.463-.69.75.75 0 0 1 .981.98 10.503 10.503 0 0 1-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 0 1 .818.162Z" clip-rule="evenodd"/>
    </svg>
  </button>

  <!-- Info / right sidebar toggle (was .course-sidebar-handle--right) -->
  <button
    type="button"
    class="ribbon-item ribbon-item--circle"
    data-sidebar-toggle="right"
    aria-label="Info y metadatos"
    title="Info (⌘/Ctrl + Shift + \)"
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
      <path d="M12 8v.01M12 11v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>

  <div class="ribbon-spacer"></div>
  <div class="ribbon-divider"></div>
  <span class="ribbon-label">pods</span>

  <!-- Graph -->
  <button
    type="button"
    class="ribbon-item"
    id="ribbon-graph-btn"
    aria-label="Graph"
    title="Graph (click = modal)"
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="18" cy="5" r="3" stroke="currentColor" stroke-width="2"/>
      <circle cx="6" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
      <circle cx="18" cy="19" r="3" stroke="currentColor" stroke-width="2"/>
      <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" stroke="currentColor" stroke-width="2"/>
    </svg>
  </button>

  <!-- Notas -->
  <button
    type="button"
    class="ribbon-item"
    id="ribbon-notas-btn"
    aria-label="Notas"
    title="Notas"
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>

  <!-- Hyperpiano (disabled, future) -->
  <button
    type="button"
    class="ribbon-item ribbon-item--disabled"
    aria-label="Hyperpiano (próximamente)"
    title="Hyperpiano (próximamente)"
    aria-disabled="true"
    tabindex="-1"
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="6" width="20" height="13" rx="2" stroke="currentColor" stroke-width="2"/>
      <path d="M7 6v6M10 6v4M14 6v6M17 6v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>

  <div class="ribbon-spacer"></div>
  <div class="ribbon-divider"></div>

  <!-- Course switcher badge -->
  <a
    href="/cursos"
    class="ribbon-item ribbon-item--badge"
    aria-label={`Mis cursos — curso activo: ${badgeLabel}`}
    title="Mis cursos"
  >
    {badgeLabel}
  </a>

  <!-- About -->
  <a href="/about" class="ribbon-about" aria-label="Acerca de musiki26">·</a>

</nav>

<!-- Mobile "más" sheet -->
<div class="ribbon-mas-sheet" id="ribbon-mas-sheet" aria-hidden="true">
  {session?.user && (
    <a href="/dashboard" class="ribbon-mas-item">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/>
        <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Perfil
    </a>
  )}
  <a href="/foro" class="ribbon-mas-item">
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Foro
  </a>
  <a href="/dashboard" class="ribbon-mas-item">
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
      <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
      <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
      <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
    </svg>
    Actividad
  </a>
  <button type="button" class="ribbon-mas-item" id="ribbon-mas-theme">
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill-rule="evenodd" d="M9.528 1.718a.75.75 0 0 1 .162.819A8.97 8.97 0 0 0 9 6a9 9 0 0 0 9 9 8.97 8.97 0 0 0 3.463-.69.75.75 0 0 1 .981.98 10.503 10.503 0 0 1-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 0 1 .818.162Z" clip-rule="evenodd"/>
    </svg>
    Tema
  </button>
  <button type="button" class="ribbon-mas-item" data-sidebar-toggle="right" id="ribbon-mas-info">
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
      <path d="M12 8v.01M12 11v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    Info
  </button>
  <div class="ribbon-mas-divider"></div>
  <button type="button" class="ribbon-mas-item" id="ribbon-mas-graph">
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="18" cy="5" r="3" stroke="currentColor" stroke-width="2"/>
      <circle cx="6" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
      <circle cx="18" cy="19" r="3" stroke="currentColor" stroke-width="2"/>
      <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" stroke="currentColor" stroke-width="2"/>
    </svg>
    Graph
  </button>
  <button type="button" class="ribbon-mas-item" id="ribbon-mas-notas">
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    Notas
  </button>
  <button type="button" class="ribbon-mas-item ribbon-mas-item--disabled" aria-disabled="true" tabindex="-1">
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="6" width="20" height="13" rx="2" stroke="currentColor" stroke-width="2"/>
      <path d="M7 6v6M10 6v4M14 6v6M17 6v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    Hyperpiano
  </button>
</div>

<style is:global>
  /* Zero out header height — ribbon is vertical, no top offset needed */
  :root {
    --musiki-header-height: 0px !important;
  }
  /* Adjust theme icon visibility */
  html:not(.dark) .ribbon-theme-sun { display: none; }
  html.dark .ribbon-theme-moon { display: none; }
  /* Mobile body padding so content isn't hidden under bottom bar */
  @media (max-width: 500px) {
    body { padding-bottom: var(--ribbon-bottom-height, 60px); }
  }
</style>

<script>
  const setupRibbon = () => {
    // Theme toggle — same logic as Header.astro
    const handleThemeToggle = () => {
      const el = document.documentElement;
      el.classList.toggle('dark');
      const isDark = el.classList.contains('dark');
      el.dataset.theme = isDark ? 'dark' : 'light';
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    };

    ['ribbon-theme-toggle', 'ribbon-mas-theme'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn && !btn.dataset.bound) {
        btn.dataset.bound = 'true';
        btn.addEventListener('click', handleThemeToggle);
      }
    });

    // Search: trigger existing search modal shortcut dispatcher
    const searchBtn = document.getElementById('ribbon-search-btn');
    if (searchBtn && !searchBtn.dataset.bound) {
      searchBtn.dataset.bound = 'true';
      searchBtn.addEventListener('click', () => {
        // Fire the same keydown that shift+? would — Search component listens for this
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }));
      });
    }

    // Graph: open modal by clicking existing trigger if present, else dispatch event
    const graphBtn = document.getElementById('ribbon-graph-btn');
    const masGraphBtn = document.getElementById('ribbon-mas-graph');
    const openGraph = () => {
      const existing = document.querySelector('[data-graph-modal-trigger], #graph-modal-trigger');
      if (existing instanceof HTMLElement) {
        existing.click();
      } else {
        window.dispatchEvent(new CustomEvent('musiki:open-graph'));
      }
    };
    if (graphBtn && !graphBtn.dataset.bound) { graphBtn.dataset.bound = 'true'; graphBtn.addEventListener('click', openGraph); }
    if (masGraphBtn && !masGraphBtn.dataset.bound) { masGraphBtn.dataset.bound = 'true'; masGraphBtn.addEventListener('click', openGraph); }

    // Notas: dispatch event that dockview-workspace listens for
    const notasBtn = document.getElementById('ribbon-notas-btn');
    const masNotasBtn = document.getElementById('ribbon-mas-notas');
    const openNotas = () => window.dispatchEvent(new CustomEvent('musiki:open-notas'));
    if (notasBtn && !notasBtn.dataset.bound) { notasBtn.dataset.bound = 'true'; notasBtn.addEventListener('click', openNotas); }
    if (masNotasBtn && !masNotasBtn.dataset.bound) { masNotasBtn.dataset.bound = 'true'; masNotasBtn.addEventListener('click', openNotas); }

    // Mobile "más" toggle
    const masSheet = document.getElementById('ribbon-mas-sheet');
    const masBtns = document.querySelectorAll('[data-ribbon-mas-toggle]');
    const closeMas = () => {
      masSheet?.classList.remove('is-open');
      masSheet?.setAttribute('aria-hidden', 'true');
    };
    masBtns.forEach((btn) => {
      if (btn instanceof HTMLElement && !btn.dataset.bound) {
        btn.dataset.bound = 'true';
        btn.addEventListener('click', () => {
          const open = masSheet?.classList.contains('is-open');
          open ? closeMas() : (masSheet?.classList.add('is-open'), masSheet?.removeAttribute('aria-hidden'));
        });
      }
    });
    // Close sheet when a mas-item is tapped
    masSheet?.querySelectorAll('.ribbon-mas-item').forEach((item) => {
      item.addEventListener('click', () => setTimeout(closeMas, 80));
    });
    // Close on outside tap
    document.addEventListener('click', (e) => {
      if (masSheet?.classList.contains('is-open') && !masSheet.contains(e.target as Node)) {
        const masToggle = document.querySelector('[data-ribbon-mas-toggle]');
        if (!masToggle?.contains(e.target as Node)) closeMas();
      }
    });
  };

  setupRibbon();
  document.addEventListener('astro:page-load', setupRibbon);
</script>
```

- [ ] **Step 2: Add `data-ribbon-mas-toggle` to the "···más" button in the mobile bottom bar**

The ribbon markup already has the mobile-visible items; we need the `···más` button. Add it after the last `ribbon-item--mobile-visible` item in the `<nav>` block, before `</nav>`:

```astro
  <!-- Mobile "···más" toggle — only visible on mobile -->
  <button
    type="button"
    class="ribbon-item ribbon-item--mobile-visible"
    data-ribbon-mas-toggle
    aria-label="Más opciones"
    title="Más opciones"
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="5" r="1.5" fill="currentColor"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="12" cy="19" r="1.5" fill="currentColor"/>
    </svg>
  </button>
```

- [ ] **Step 3: Verify the component builds without errors**

```bash
npm run build 2>&1 | tail -20
```
Expected: no Astro compilation errors about `Ribbon.astro`.

- [ ] **Step 4: Commit**

```bash
git add src/components/Ribbon.astro src/styles/ribbon.css
git commit -m "feat: Ribbon component with theme toggle + mobile bottom bar"
```

---

### Task 3: Wire Ribbon into `[...slug].astro`

**Files:**
- Modify: `src/pages/[...slug].astro`

This task has three independent sub-changes: (a) swap the Header import/usage, (b) remove the floating handle buttons, (c) update the grid CSS.

- [ ] **Step 1: Replace Header import with Ribbon**

Find line 7:
```ts
import Header from '../components/Header.astro';
```
Replace with:
```ts
import Ribbon from '../components/Ribbon.astro';
```

- [ ] **Step 2: Replace `<Header ...>` usage with `<Ribbon ...>`**

Find (~line 3367):
```astro
    <Header
      showPageInfoToggle={true}
      courseId={canonicalCourseId || courseSlug}
      activeCourseId={canonicalCourseId || courseSlug}
      activeCourseCode={activeCourseCode}
      presentationHref={presentationHref}
      performativeRoomHref={performativeRoomHref}
    />
```
Replace with:
```astro
    <Ribbon
      courseId={canonicalCourseId || courseSlug}
      courseHref={courseHref}
      performativeRoomHref={performativeRoomHref}
      activeCourseCode={activeCourseCode}
      session={session}
    />
```

- [ ] **Step 3: Remove the two floating handle buttons**

Find and remove this block (~line 3388–3410):
```astro
      <button
        type="button"
        class="course-sidebar-handle course-sidebar-handle--left"
        data-sidebar-handle="left"
        aria-label="Mostrar navegación del curso"
        title="Mostrar navegación del curso (⌘/Ctrl + \\)"
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 6.00067L21 6.00139M8 12.0007L21 12.0015M8 18.0007L21 18.0015M3.5 6H3.51M3.5 12H3.51M3.5 18H3.51M4 6C4 6.27614 3.77614 6.5 3.5 6.5C3.22386 6.5 3 6.27614 3 6C3 5.72386 3.22386 5.5 3.5 5.5C3.77614 5.5 4 5.72386 4 6ZM4 12C4 12.2761 3.77614 12.5 3.5 12.5C3.22386 12.5 3 12.2761 3 12C3 11.7239 3.22386 11.5 3.5 11.5C3.77614 5.5 4 11.7239 4 12ZM4 18C4 18.2761 3.77614 18.5 3.5 18.5C3.22386 18.5 3 18.2761 3 18C3 17.7239 3.22386 17.5 3.5 17.5C3.77614 17.5 4 17.7239 4 18Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button
        type="button"
        class="course-sidebar-handle course-sidebar-handle--right"
        data-sidebar-handle="right"
        aria-label="Mostrar foros"
        title="Mostrar foros (⌘/Ctrl + Shift + \\)"
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16.1795 3.26875C15.7889 2.87823 15.1558 2.87823 14.7652 3.26875L8.12078 9.91322C6.94952 11.0845 6.94916 12.9833 8.11996 14.155L14.6903 20.7304C15.0808 21.121 15.714 21.121 16.1045 20.7304C16.495 20.3399 16.495 19.7067 16.1045 19.3162L9.53246 12.7442C9.14194 12.3536 9.14194 11.7205 9.53246 11.33L16.1795 4.68297C16.57 4.29244 16.57 3.65928 16.1795 3.26875Z" fill="currentColor"/>
        </svg>
      </button>
```

- [ ] **Step 4: Update `.course-container` grid to include ribbon column**

Find (~line 807):
```css
        grid-template-columns:
          minmax(0, var(--left-sidebar-width))
          minmax(0, 1fr)
          minmax(0, var(--right-sidebar-width));
```
Replace with:
```css
        --ribbon-width: 44px;
        grid-template-columns:
          var(--ribbon-width)
          minmax(0, var(--left-sidebar-width))
          minmax(0, 1fr)
          minmax(0, var(--right-sidebar-width));
```

- [ ] **Step 5: Update collapsed-state grid variants**

Find:
```css
      .course-container[data-left-open='false'] {
        grid-template-columns:
          0
          minmax(0, 1fr)
          minmax(0, var(--right-sidebar-width));
      }

      .course-container[data-right-open='false'] {
        grid-template-columns:
          minmax(0, var(--left-sidebar-width))
          minmax(0, 1fr)
          0;
      }
```
Replace with:
```css
      .course-container[data-left-open='false'] {
        grid-template-columns:
          var(--ribbon-width)
          0
          minmax(0, 1fr)
          minmax(0, var(--right-sidebar-width));
      }

      .course-container[data-right-open='false'] {
        grid-template-columns:
          var(--ribbon-width)
          minmax(0, var(--left-sidebar-width))
          minmax(0, 1fr)
          0;
      }
```

- [ ] **Step 6: Fix the both-closed variant**

Find:
```css
      .course-container[data-left-open='false'][data-right-open='false'] {
        grid-template-columns:
          0
          minmax(0, 1fr)
          0;
      }
```
Replace with:
```css
      .course-container[data-left-open='false'][data-right-open='false'] {
        grid-template-columns:
          var(--ribbon-width)
          0
          minmax(0, 1fr)
          0;
      }
```

- [ ] **Step 6b: Fix right-maximized sidebar left offset**

The right sidebar uses `position:fixed` when maximized, with a `left:` calc that accounts for the left sidebar width. Add `var(--ribbon-width)` to it.

Find:
```css
      .course-container[data-right-maximized='true'] .sidebar--right {
        position: fixed;
        left: calc(
          clamp(0.7rem, 1.5vw, 1.4rem) +
          var(--left-sidebar-width) +
          clamp(0.9rem, 1.35vw, 1.3rem)
        );
```
Replace with:
```css
      .course-container[data-right-maximized='true'] .sidebar--right {
        position: fixed;
        left: calc(
          var(--ribbon-width) +
          clamp(0.7rem, 1.5vw, 1.4rem) +
          var(--left-sidebar-width) +
          clamp(0.9rem, 1.35vw, 1.3rem)
        );
```

- [ ] **Step 7: Fix container height — remove header offset**

Find (~line 815):
```css
        height: calc(100dvh - var(--musiki-header-height, 4.5rem));
```
Replace with:
```css
        height: 100dvh;
```

- [ ] **Step 8: Build and check for errors**

```bash
npm run build 2>&1 | tail -30
```
Expected: clean build, no grid/layout errors.

- [ ] **Step 9: Start dev and visually check desktop layout**

```bash
npm run dev
```
Open a course URL (e.g. `http://localhost:4321/s1/clase-3`). Verify:
- Ribbon appears on the left (44px)
- Course nav sidebar opens/closes via ☰ button
- Right info panel opens/closes via ℹ️ button
- No top header visible
- Content fills the remaining space

- [ ] **Step 10: Check mobile layout at ≤500px**

In browser devtools, resize to 390px width. Verify:
- Bottom bar appears with 5 icons, no labels
- ☰ tap slides course nav in from left
- `···` tap opens the "más" sheet upward
- Touch targets feel comfortable

- [ ] **Step 11: Commit**

```bash
git add src/pages/\[...slug\].astro
git commit -m "feat: replace Header + floating handles with Ribbon in slug"
```

---

### Task 4: Cleanup — remove `.course-sidebar-handle` CSS

**Files:**
- Modify: `src/pages/[...slug].astro`

Now that the handle buttons are gone, their CSS blocks are dead code.

- [ ] **Step 1: Remove the `.course-sidebar-handle` CSS blocks**

Delete the CSS block starting at ~line 866 that defines:
- `.course-sidebar-handle`
- `.course-sidebar-handle--left`
- `.course-sidebar-handle--right`
- `.course-sidebar-handle:hover`
- `.course-sidebar-handle svg`
- `.course-sidebar-handle--left svg`
- `.course-sidebar-handle--left:hover svg`
- `.course-sidebar-handle--right:hover svg`
- `.course-container[data-has-right-sidebar='false'] .course-sidebar-handle--right`
- `.course-container[data-left-open='false'] .course-sidebar-handle--left`
- `.course-container[data-right-open='false'][data-has-right-sidebar='true'] .course-sidebar-handle--right`

Also remove the three matching mobile `@media` blocks that repeat these same selectors (~lines 2985, 3111, 3129).

- [ ] **Step 2: Build again to confirm nothing broke**

```bash
npm run build 2>&1 | grep -E "error|Error|warn" | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/\[...slug\].astro
git commit -m "chore: remove dead .course-sidebar-handle CSS after Ribbon migration"
```

---

### Task 5: Wire `musiki:open-notas` event in dockview-workspace

**Files:**
- Modify: `src/scripts/course/dockview-workspace.ts`

The Ribbon dispatches `musiki:open-notas` — dockview-workspace needs to listen and open/toggle the notas panel.

- [ ] **Step 1: Find where the initial notas panel is opened**

Search for the existing notas open logic:
```bash
grep -n "open.*notas\|notas.*open\|note.*panel\|addPanel\|note-panel" src/scripts/course/dockview-workspace.ts | head -20
```

- [ ] **Step 2: Add the event listener**

Near the end of the dockview init block (where other keyboard shortcuts are wired), add:

```ts
window.addEventListener('musiki:open-notas', () => {
  // Re-use the existing "open initial notes panel" path
  const pid = `note-initial`;
  const existing = dockview.getGroupPanel(pid);
  if (existing) {
    existing.api.setActive();
  } else {
    dockview.addPanel({ id: pid, component: 'note-panel' });
  }
});
```

- [ ] **Step 3: Test notas button**

With `npm run dev`, click the 📝 Notas ribbon item. Expected: notes panel opens in dockview workspace.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/course/dockview-workspace.ts
git commit -m "feat: ribbon notas button wires to dockview open-notas event"
```

---

### Task 6: Wire `musiki:open-graph` event in GraphModal

**Files:**
- Modify: `src/components/GraphModal.astro` (or wherever the graph modal trigger lives)

- [ ] **Step 1: Find the existing graph modal open mechanism**

```bash
grep -n "graph-modal\|openGraph\|data-graph\|GraphModal\|graph.*open\|open.*graph" src/components/GraphModal.astro | head -10
grep -n "graph-modal\|openGraph\|data-graph\|musiki:open-graph" src/pages/\[...slug\].astro | head -10
```

- [ ] **Step 2: Add event listener for `musiki:open-graph`**

The graph modal element has `id="graph-modal"`. In `GraphModal.astro`'s `<script>`, add:
```ts
window.addEventListener('musiki:open-graph', () => {
  const modal = document.getElementById('graph-modal');
  if (modal instanceof HTMLElement) {
    modal.classList.add('is-open');
    // trigger existing open logic by clicking the body or dispatching 'g' key
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
  }
});
```
If the graph modal opens via a keyboard shortcut `g`, verify the existing keydown handler in `GraphModal.astro` and use the same mechanism. If it uses a class toggle, use that instead.

- [ ] **Step 3: Test graph button**

With `npm run dev`, click the 🕸 Graph ribbon item. Expected: graph modal opens.

- [ ] **Step 4: Commit**

```bash
git add src/components/GraphModal.astro
git commit -m "feat: ribbon graph button wires to musiki:open-graph event"
```
