# Dockview Notes Workspace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the course page's single `content-area` with a dockview workspace. Default layout is 1 panel (identical to today). Each panel shows a note in preview or edit mode; panels have a transparent custom header (no visible tab bar) with a minimal pencil icon. All editing auto-saves via `NotesPersistence` — no save button.

**Architecture:** `NotesPersistence` decouples debounce/write/recovery from the editor. `CourseNotesWorkspace` owns dockview init, panel creation, and the DIY shell (transparent header + body), following the exact pattern from `RoomWorkspaceManager`. The Astro page wraps `.content-area` as the dockview root and intercepts `note-open` events from the sidebar to call `workspace.openNote()`. The inline editor loses its save button; `NotesPersistence` replaces it.

**Tech Stack:** `dockview-core` ^5.2.0 (already installed), TypeScript, existing `api.ts` + `yaml-strip.ts` + `inline-editor.ts`, Node built-in test runner for `NotesPersistence` pure logic.

**Prerequisite:** Plan 1 (dynamic notes sidebar) must be complete. The sidebar dispatches `note-open` CustomEvents that this plan intercepts.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `src/scripts/course/notes-persistence.ts` | Create | Auto-save debounce, localStorage draft buffer, crash recovery |
| `src/scripts/course/notes-persistence.test.mjs` | Create | Unit tests for debounce logic and localStorage operations |
| `src/scripts/course/dockview-workspace.ts` | Create | Dockview init, DIY shell, panel management, `openNote()` |
| `src/pages/[...slug].astro` | Modify | Wrap content-area as dockview root; intercept `note-open`; init workspace |
| `src/scripts/course/notes/inline-editor.ts` | Modify | Remove save button; accept `NotesPersistence` instance; remove Cmd+S handler |

---

### Task 1: NotesPersistence — auto-save with localStorage buffer

**Files:**
- Create: `src/scripts/course/notes-persistence.ts`
- Create: `src/scripts/course/notes-persistence.test.mjs`

- [ ] **Step 1.1: Write the class**

```typescript
// src/scripts/course/notes-persistence.ts
import { saveNote } from './notes-editor/api';

type Status = 'idle' | 'pending' | 'saving' | 'error';

export type PersistenceState = {
  status: Status;
};

export type PersistenceOptions = {
  onStatusChange?: (state: PersistenceState) => void;
  debounceMs?: number;
};

const DRAFT_PREFIX = 'notes-draft::';

export class NotesPersistence {
  private readonly courseId: string;
  private readonly slug: string;
  private readonly debounceMs: number;
  private readonly onStatusChange: (s: PersistenceState) => void;

  private timerId: ReturnType<typeof setTimeout> | null = null;
  private pendingContent: string | null = null;
  private status: Status = 'idle';
  private flushResolvers: Array<() => void> = [];

  constructor(courseId: string, slug: string, opts: PersistenceOptions = {}) {
    this.courseId = courseId;
    this.slug = slug;
    this.debounceMs = opts.debounceMs ?? 1500;
    this.onStatusChange = opts.onStatusChange ?? (() => {});
  }

  private get storageKey(): string {
    return `${DRAFT_PREFIX}${this.courseId}::${this.slug}`;
  }

  private setStatus(s: Status) {
    this.status = s;
    this.onStatusChange({ status: s });
  }

  onChange(content: string): void {
    this.pendingContent = content;
    // Write to localStorage immediately (crash-safe buffer)
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        content,
        ts: Date.now(),
      }));
    } catch {
      // localStorage full or unavailable — not fatal
    }
    // Reset debounce
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.setStatus('pending');
    this.timerId = setTimeout(() => this.write(), this.debounceMs);
  }

  private async write(): Promise<void> {
    if (this.pendingContent === null) return;
    const content = this.pendingContent;
    this.timerId = null;
    this.setStatus('saving');
    try {
      await saveNote(this.courseId, this.slug, content);
      this.pendingContent = null;
      // Clear localStorage draft on successful save
      try { localStorage.removeItem(this.storageKey); } catch {}
      this.setStatus('idle');
    } catch {
      this.setStatus('error');
    } finally {
      // Resolve any flush() waiters
      this.flushResolvers.forEach(r => r());
      this.flushResolvers = [];
    }
  }

  async flush(): Promise<void> {
    if (this.timerId === null && this.pendingContent === null) return;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    await new Promise<void>(resolve => {
      this.flushResolvers.push(resolve);
      this.write();
    });
  }

  recover(): { content: string; ts: number } | null {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as { content: string; ts: number };
    } catch {
      return null;
    }
  }

  discardDraft(): void {
    try { localStorage.removeItem(this.storageKey); } catch {}
  }

  destroy(): void {
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.timerId = null;
    this.pendingContent = null;
    this.flushResolvers = [];
    this.setStatus('idle');
  }
}
```

- [ ] **Step 1.2: Write tests**

```javascript
// src/scripts/course/notes-persistence.test.mjs
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage mock for Node
const store = {};
global.localStorage = {
  getItem: k => store[k] ?? null,
  setItem: (k, v) => { store[k] = v; },
  removeItem: k => { delete store[k]; },
};

// Mock saveNote
let savedContent = null;
let saveError = null;
const mockSaveNote = async (_courseId, _slug, content) => {
  if (saveError) throw saveError;
  savedContent = content;
};

// We test the class logic directly by importing utils
// (NotesPersistence uses saveNote via import — we patch via module mock below)
// For simplicity, test debounce timing and localStorage behaviour directly.

describe('NotesPersistence localStorage draft', () => {
  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
    savedContent = null;
    saveError = null;
  });

  test('recover returns null when no draft exists', () => {
    const { NotesPersistence } = await mockModule();
    const p = new NotesPersistence('s123', 'test-note', { debounceMs: 10000 });
    assert.equal(p.recover(), null);
    p.destroy();
  });

  test('onChange writes to localStorage immediately', async () => {
    const { NotesPersistence } = await mockModule();
    const p = new NotesPersistence('s123', 'test-note', { debounceMs: 10000 });
    p.onChange('hello world');
    const draft = p.recover();
    assert.ok(draft);
    assert.equal(draft.content, 'hello world');
    assert.ok(draft.ts > 0);
    p.destroy();
  });

  test('discardDraft clears localStorage', async () => {
    const { NotesPersistence } = await mockModule();
    const p = new NotesPersistence('s123', 'test-note', { debounceMs: 10000 });
    p.onChange('some content');
    p.discardDraft();
    assert.equal(p.recover(), null);
    p.destroy();
  });

  async function mockModule() {
    // Inline the class for testing without module resolution issues
    // (In a real project you'd use --import with a mock loader)
    const { NotesPersistence } = await import('./notes-persistence-testable.mjs');
    return { NotesPersistence };
  }
});
```

- [ ] **Step 1.3: Create testable `.mjs` companion for the test runner**

```javascript
// src/scripts/course/notes-persistence-testable.mjs
// NotesPersistence with injectable saveNote for testing

const DRAFT_PREFIX = 'notes-draft::';

export class NotesPersistence {
  constructor(courseId, slug, opts = {}) {
    this.courseId = courseId;
    this.slug = slug;
    this.debounceMs = opts.debounceMs ?? 1500;
    this._saveFn = opts._saveFn ?? (async () => {});
    this.onStatusChange = opts.onStatusChange ?? (() => {});
    this.timerId = null;
    this.pendingContent = null;
    this.status = 'idle';
    this.flushResolvers = [];
  }

  get storageKey() { return `${DRAFT_PREFIX}${this.courseId}::${this.slug}`; }

  setStatus(s) { this.status = s; this.onStatusChange({ status: s }); }

  onChange(content) {
    this.pendingContent = content;
    try { localStorage.setItem(this.storageKey, JSON.stringify({ content, ts: Date.now() })); } catch {}
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.setStatus('pending');
    this.timerId = setTimeout(() => this.write(), this.debounceMs);
  }

  async write() {
    if (this.pendingContent === null) return;
    const content = this.pendingContent;
    this.timerId = null;
    this.setStatus('saving');
    try {
      await this._saveFn(this.courseId, this.slug, content);
      this.pendingContent = null;
      try { localStorage.removeItem(this.storageKey); } catch {}
      this.setStatus('idle');
    } catch {
      this.setStatus('error');
    } finally {
      this.flushResolvers.forEach(r => r());
      this.flushResolvers = [];
    }
  }

  async flush() {
    if (this.timerId === null && this.pendingContent === null) return;
    if (this.timerId !== null) { clearTimeout(this.timerId); this.timerId = null; }
    await new Promise(resolve => { this.flushResolvers.push(resolve); this.write(); });
  }

  recover() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  discardDraft() { try { localStorage.removeItem(this.storageKey); } catch {} }

  destroy() {
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.timerId = null;
    this.pendingContent = null;
    this.flushResolvers = [];
    this.setStatus('idle');
  }
}
```

- [ ] **Step 1.4: Update package.json test glob**

```json
"test": "node --test \"src/lib/live/*.test.mjs\" \"src/scripts/course/sidebar/*.test.mjs\" \"src/scripts/course/*.test.mjs\""
```

- [ ] **Step 1.5: Run tests**

```bash
npm test
```

Expected: all existing + new tests pass.

- [ ] **Step 1.6: Commit**

```bash
git add src/scripts/course/notes-persistence.ts src/scripts/course/notes-persistence.test.mjs src/scripts/course/notes-persistence-testable.mjs package.json
git commit -m "feat: NotesPersistence — debounced auto-save with localStorage crash buffer"
```

---

### Task 2: CourseNotesWorkspace — dockview init with DIY shell

**Files:**
- Create: `src/scripts/course/dockview-workspace.ts`

The room workspace (`RoomWorkspaceManager.ts`) uses the exact pattern we need. Study these parts before writing:
- `new DockviewComponent(container, { createComponent })` (line 276)
- CSS that hides native tabs (lines 1803–1820): `.dockview-container .dv-tab-container, .dv-tab, .dv-tabs-and-actions-container { height: 0 !important; ... }`
- DIY shell structure: `pod-diy-shell > pod-diy-header + pod-diy-body` (lines 312–326)
- Drag handle using `musiki/panel-id` dataTransfer key (lines 906–910)

- [ ] **Step 2.1: Create the workspace module**

```typescript
// src/scripts/course/dockview-workspace.ts
import { DockviewComponent } from 'dockview-core';
import { NotesPersistence } from './notes-persistence';
import { getNote } from './notes-editor/api';
import { parseFrontmatter } from './notes-editor/yaml-strip';
import {
  mountInlineNotesEditor,
  type InlineEditorOptions,
} from './notes/inline-editor';

export type NoteMode = 'preview' | 'edit';

export interface CourseNotesWorkspace {
  openNote(slug: string, mode: NoteMode, split?: boolean): void;
  destroy(): void;
}

// Panel params stored in dockview panel params map
type PanelParams = { slug: string; courseId: string; mode: NoteMode };

// Per-panel live state (not in dockview)
type PanelState = {
  slug: string;
  courseId: string;
  mode: NoteMode;
  persistence: NotesPersistence | null;
  bodyEl: HTMLElement;
  statusDot: HTMLElement;
  pencilBtn: HTMLButtonElement;
};

const panelStates = new Map<string, PanelState>();

// ── Inject CSS ────────────────────────────────────────────────────────────

let cssInjected = false;
function injectWorkspaceCss(containerId: string) {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Hide ALL native dockview tabs — scoped to our container */
    #${containerId} .dv-header,
    #${containerId} .dv-tab-container,
    #${containerId} .dv-tab,
    #${containerId} .dv-tab-divider,
    #${containerId} .dv-tab-separator,
    #${containerId} .dv-tabs-and-actions-container {
      height: 0 !important;
      min-height: 0 !important;
      max-height: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      border: none !important;
      visibility: hidden !important;
      overflow: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Keep separator for split functionality */
    #${containerId} .dv-separator {
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      background: var(--c-border, rgba(120,120,140,0.15)) !important;
    }

    /* DIY Shell */
    .cnw-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      overflow: hidden;
      background: var(--c-bg);
      position: relative;
    }

    /* Transparent header — the drag zone */
    .cnw-header {
      position: relative;
      width: 100%;
      height: 22px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      background: transparent;
      cursor: grab;
      user-select: none;
      padding: 0 6px;
      box-sizing: border-box;
      gap: 6px;
    }
    .cnw-header:active { cursor: grabbing; }
    .cnw-header.is-dragging { opacity: .4; }

    /* Note title — invisible at rest, shows on hover */
    .cnw-title {
      font-size: 10px;
      color: var(--c-fg-subtle, var(--c-fg-dim));
      opacity: 0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: opacity 160ms;
      pointer-events: none;
    }
    .cnw-shell:hover .cnw-title { opacity: 0.45; }

    /* Status dot */
    .cnw-status {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 300ms, background 200ms;
    }
    .cnw-status.pending { background: var(--c-fg-dim); opacity: 1; }
    .cnw-status.saving  { background: var(--c-link, #3b82f6); opacity: 1; animation: cnw-pulse 800ms infinite; }
    .cnw-status.error   { background: #c87e7e; opacity: 1; }
    @keyframes cnw-pulse { 0%,100%{opacity:.6} 50%{opacity:1} }

    /* Pencil / eye icon button */
    .cnw-mode-btn {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--c-fg-dim);
      opacity: 0;
      line-height: 1;
      font-size: 12px;
      transition: opacity 160ms, color 160ms;
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .cnw-shell:hover .cnw-mode-btn { opacity: 0.6; }
    .cnw-mode-btn:hover { opacity: 1 !important; color: var(--c-fg); }

    /* Panel body */
    .cnw-body {
      flex: 1;
      overflow: auto;
      min-height: 0;
      position: relative;
    }

    /* Recovery banner */
    .cnw-recovery {
      position: absolute;
      top: 0; left: 0; right: 0;
      background: var(--c-bg-surface, var(--c-bg-mute));
      border-bottom: 1px solid var(--c-border);
      padding: 6px 12px;
      font-size: 11px;
      color: var(--c-fg);
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 10;
    }
    .cnw-recovery button {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 3px;
      border: 1px solid var(--c-border);
      background: none;
      color: var(--c-fg);
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

// ── DIY Shell builder ─────────────────────────────────────────────────────

function buildShell(
  panelId: string,
  slug: string,
  title: string,
  dockview: DockviewComponent,
): { shell: HTMLElement; bodyEl: HTMLElement; statusDot: HTMLElement; pencilBtn: HTMLButtonElement } {
  const shell = document.createElement('div');
  shell.className = 'cnw-shell';
  shell.dataset.panelId = panelId;

  // Header
  const header = document.createElement('div');
  header.className = 'cnw-header';

  const titleEl = document.createElement('span');
  titleEl.className = 'cnw-title';
  titleEl.textContent = title;
  header.appendChild(titleEl);

  const statusDot = document.createElement('span');
  statusDot.className = 'cnw-status';
  header.appendChild(statusDot);

  const pencilBtn = document.createElement('button');
  pencilBtn.className = 'cnw-mode-btn';
  pencilBtn.title = 'Alternar modo edición / vista previa';
  pencilBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
  header.appendChild(pencilBtn);

  // Drag behaviour on header
  header.draggable = true;
  header.addEventListener('dragstart', e => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('musiki/panel-id', panelId);
    e.dataTransfer.setData('text/plain', panelId);
    e.dataTransfer.effectAllowed = 'move';
    header.classList.add('is-dragging');
  });
  header.addEventListener('dragend', () => header.classList.remove('is-dragging'));

  // Drop target on shell (same pattern as room workspace)
  shell.addEventListener('dragover', e => {
    if (!e.dataTransfer?.types.includes('musiki/panel-id')) return;
    e.preventDefault();
    shell.classList.add('cnw-drag-over');
  });
  shell.addEventListener('dragleave', e => {
    if (!shell.contains(e.relatedTarget as Node)) shell.classList.remove('cnw-drag-over');
  });
  shell.addEventListener('drop', e => {
    shell.classList.remove('cnw-drag-over');
    const srcId = e.dataTransfer?.getData('musiki/panel-id');
    if (!srcId || srcId === panelId) return;
    e.preventDefault();
    const srcPanel = dockview.getGroupPanel(srcId);
    const tgtPanel = dockview.getGroupPanel(panelId);
    if (srcPanel && tgtPanel) {
      dockview.moveGroupOrPanel({
        from: { panelId: srcId },
        to: { group: tgtPanel.group, position: 'right' },
      });
    }
  });

  shell.appendChild(header);

  const body = document.createElement('div');
  body.className = 'cnw-body';
  shell.appendChild(body);

  return { shell, bodyEl: body, statusDot, pencilBtn };
}

// ── Preview renderer ──────────────────────────────────────────────────────

async function renderPreview(bodyEl: HTMLElement, courseId: string, slug: string): Promise<string> {
  bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;font-size:.85rem;">Cargando…</p>';
  try {
    const note = await getNote(courseId, slug);
    const { body } = parseFrontmatter(note.content);
    // Render as pre for now — full markdown render would require server round-trip
    bodyEl.innerHTML = `<div style="padding:1.2rem 1.5rem;font-size:var(--font-size-base,1rem);line-height:1.72;color:var(--c-fg)"><pre style="white-space:pre-wrap;font-family:inherit">${escHtml(body)}</pre></div>`;
    // Try to get rendered HTML from a future endpoint or use the note's filePath
    return note.content;
  } catch (err) {
    bodyEl.innerHTML = `<p style="padding:1rem;color:#c87e7e;font-size:.85rem;">Error al cargar la nota</p>`;
    return '';
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Mode switching ────────────────────────────────────────────────────────

async function enterEditMode(state: PanelState) {
  state.mode = 'edit';
  state.bodyEl.innerHTML = '';
  state.pencilBtn.title = 'Vista previa';
  state.pencilBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

  // Destroy old persistence if any
  state.persistence?.destroy();

  state.persistence = new NotesPersistence(state.courseId, state.slug, {
    debounceMs: 1500,
    onStatusChange: ({ status }) => {
      state.statusDot.className = 'cnw-status ' + (status === 'idle' ? '' : status);
    },
  });

  // Check for draft recovery
  const draft = state.persistence.recover();
  if (draft) {
    const banner = document.createElement('div');
    banner.className = 'cnw-recovery';
    banner.innerHTML = `
      <span>Borrador recuperado (${new Date(draft.ts).toLocaleTimeString()})</span>
      <button id="cnw-recover-accept">Usar borrador</button>
      <button id="cnw-recover-discard">Descartar</button>
    `;
    state.bodyEl.appendChild(banner);

    banner.querySelector('#cnw-recover-discard')?.addEventListener('click', () => {
      state.persistence?.discardDraft();
      banner.remove();
      mountEditor(state, null);
    });
    banner.querySelector('#cnw-recover-accept')?.addEventListener('click', () => {
      banner.remove();
      mountEditor(state, draft.content);
    });
  } else {
    mountEditor(state, null);
  }
}

function mountEditor(state: PanelState, overrideContent: string | null) {
  const editorMount = document.createElement('div');
  editorMount.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;height:100%;';
  state.bodyEl.appendChild(editorMount);

  // Create a minimal content placeholder so mountInlineNotesEditor has something to replace
  const contentPlaceholder = document.createElement('div');
  contentPlaceholder.style.display = 'none';
  editorMount.appendChild(contentPlaceholder);

  const opts: InlineEditorOptions = {
    mountEl: editorMount,
    contentEl: contentPlaceholder,
    courseId: state.courseId,
    slug: state.slug,
    mode: 'edit',
    persistence: state.persistence!,
    overrideContent,
    hideHeader: true,  // no header row needed — we have our own
  };

  mountInlineNotesEditor(opts);
}

async function enterPreviewMode(state: PanelState) {
  // Flush pending saves before leaving edit mode
  if (state.persistence) {
    await state.persistence.flush();
    state.persistence.destroy();
    state.persistence = null;
  }
  state.mode = 'preview';
  state.bodyEl.innerHTML = '';
  state.pencilBtn.title = 'Editar';
  state.pencilBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
  state.statusDot.className = 'cnw-status';
  await renderPreview(state.bodyEl, state.courseId, state.slug);
}

// ── Main init ─────────────────────────────────────────────────────────────

export function initDockviewWorkspace(
  container: HTMLElement,
  courseId: string,
  initialSlug: string | null,
  initialContent: string | null,
): CourseNotesWorkspace {
  const containerId = container.id || 'cnw-root';
  container.id = containerId;
  container.classList.add('dockview-theme-light'); // or dark — matched by CSS vars

  injectWorkspaceCss(containerId);

  const dockview = new DockviewComponent(container, {
    createComponent: options => {
      const params = options.params as PanelParams;
      const panelId = options.id;

      const { shell, bodyEl, statusDot, pencilBtn } = buildShell(
        panelId,
        params.slug,
        params.slug.split('/').pop()?.replace('.md', '') ?? params.slug,
        dockview,
      );

      const state: PanelState = {
        slug: params.slug,
        courseId: params.courseId,
        mode: params.mode,
        persistence: null,
        bodyEl,
        statusDot,
        pencilBtn,
      };
      panelStates.set(panelId, state);

      // Mode toggle
      pencilBtn.addEventListener('click', () => {
        if (state.mode === 'preview') enterEditMode(state);
        else enterPreviewMode(state);
      });

      // Render initial mode
      if (params.mode === 'edit') {
        enterEditMode(state);
      } else {
        if (initialContent && params.slug === initialSlug) {
          // Use server-rendered content for the initial panel
          bodyEl.innerHTML = initialContent;
        } else {
          renderPreview(bodyEl, params.courseId, params.slug);
        }
      }

      // dockview expects the component to implement { element }
      return { element: shell };
    },
  });

  // Resize observer
  const ro = new ResizeObserver(entries => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      dockview.layout(width, height);
    }
  });
  ro.observe(container);

  // Open initial panel
  if (initialSlug) {
    dockview.addPanel({
      id: `note-${initialSlug}`,
      component: 'note-panel',
      params: { slug: initialSlug, courseId, mode: 'preview' } satisfies PanelParams,
    });
  }

  function openNote(slug: string, mode: NoteMode = 'preview', split = false): void {
    const panelId = `note-${slug}`;
    const existing = dockview.getGroupPanel(panelId);

    if (existing && !split) {
      // Navigate existing panel to new slug (same panel, new content)
      const state = panelStates.get(panelId);
      if (!state) return;
      state.slug = slug;
      if (state.mode === 'preview') renderPreview(state.bodyEl, courseId, slug);
      else {
        state.persistence?.destroy();
        enterEditMode(state);
      }
      return;
    }

    const referencePanel = split
      ? (dockview.panels[dockview.panels.length - 1] ?? undefined)
      : undefined;

    dockview.addPanel({
      id: panelId + (split ? `-split-${Date.now()}` : ''),
      component: 'note-panel',
      params: { slug, courseId, mode } satisfies PanelParams,
      position: referencePanel
        ? { referencePanel: referencePanel.id, direction: 'right' }
        : undefined,
    });
  }

  // Listen for sidebar note-open events
  window.addEventListener('note-open', (e: Event) => {
    const ev = e as CustomEvent<{ slug: string; courseId: string; mode: NoteMode }>;
    (e as CustomEvent).preventDefault?.();
    openNote(ev.detail.slug, ev.detail.mode ?? 'preview', false);
  });

  // Cleanup on panel removal
  dockview.onDidRemovePanel(event => {
    const state = panelStates.get(event.id);
    if (state?.persistence) {
      state.persistence.flush().then(() => state.persistence?.destroy());
    }
    panelStates.delete(event.id);
  });

  return {
    openNote,
    destroy: () => {
      ro.disconnect();
      panelStates.forEach(s => s.persistence?.destroy());
      panelStates.clear();
      dockview.dispose();
    },
  };
}
```

- [ ] **Step 2.2: Commit**

```bash
git add src/scripts/course/dockview-workspace.ts
git commit -m "feat: CourseNotesWorkspace — dockview with transparent DIY shell, preview/edit mode toggle"
```

---

### Task 3: Modify inline-editor.ts — accept NotesPersistence, remove save button

**Files:**
- Modify: `src/scripts/course/notes/inline-editor.ts`

- [ ] **Step 3.1: Add `persistence` and `hideHeader` and `overrideContent` to InlineEditorOptions**

In `src/scripts/course/notes/inline-editor.ts`, find the `InlineEditorOptions` type and extend it:

```typescript
export type InlineEditorOptions = {
  mountEl: HTMLElement;
  contentEl: HTMLElement;
  courseId: string;
  courseName?: string;
  slug: string | null;
  mode: 'edit' | 'create';
  // New fields (optional for backward compatibility):
  persistence?: import('../notes-persistence').NotesPersistence | null;
  hideHeader?: boolean;       // hide the top header bar (we have our own in the panel)
  overrideContent?: string | null; // pre-loaded content (e.g. recovered draft)
};
```

- [ ] **Step 3.2: Update buildLayout to conditionally omit the header bar when hideHeader=true**

In `buildLayout()`, find the `nie-header` div:

```typescript
function buildLayout(mountEl: HTMLElement, _courseId: string, _courseName: string, _slug: string | null, hideHeader: boolean): void {
  const inputStyle = '...'; // unchanged
  mountEl.innerHTML = `
    ${hideHeader ? '' : `
    <div id="nie-header" style="...">
      <span ...>Notas</span>
      <span id="nie-status" ...></span>
      <button id="nie-save" ...>Guardar</button>
      <button id="nie-close" ...>✕</button>
    </div>
    `}
    <div id="nie-editor-panel" ...>
      ...
    </div>
  `;
}
```

Update the `buildLayout` call in `mountInlineNotesEditor`:
```typescript
buildLayout(mountEl, courseId, courseName, slug, opts.hideHeader ?? false);
```

- [ ] **Step 3.3: Wire persistence.onChange instead of the save button when persistence is provided**

In `mountInlineNotesEditor`, after the editor is created (where `createEditor` is called), add:

```typescript
// If persistence is provided, auto-save on every change instead of using save button
if (opts.persistence) {
  const p = opts.persistence;
  // Override the onChange callback passed to createEditor
  createEditor(wrap, initialContent, () => {
    p.onChange(getEditorContent());
  });
  // Hide save button if present (hideHeader=false but no save btn needed)
  document.getElementById('nie-save')?.setAttribute('hidden', '');
  document.getElementById('nie-save')?.style?.setProperty('display', 'none');
} else {
  createEditor(wrap, initialContent, () => {});
}
```

**Note:** The `createEditor` call currently passes `() => {}` as onChange — replace it with the persistence callback above. The existing explicit save button (Cmd+S) remains for the standalone notes-editor page; only when `opts.persistence` is truthy does auto-save take over.

- [ ] **Step 3.4: Handle overrideContent — use it as initial content when provided**

In `loadNote()`, when `opts.overrideContent` is not null, use it instead of fetching:

```typescript
async function loadNote(slug: string, courseId: string, statusEl: HTMLElement): Promise<void> {
  // If caller provided content (e.g. recovered draft), skip fetch
  if (opts.overrideContent !== undefined && opts.overrideContent !== null) {
    const { data, body } = parseFrontmatter(opts.overrideContent);
    // ... populate title, yaml strip, editor with body
    setEditorContent(body);
    opts.overrideContent = null; // use only once
    return;
  }
  // ... existing fetch logic unchanged
}
```

- [ ] **Step 3.5: Build check**

```bash
npm run dev
```

Fix any TypeScript errors reported by Astro/Vite in the terminal.

- [ ] **Step 3.6: Commit**

```bash
git add src/scripts/course/notes/inline-editor.ts
git commit -m "feat: inline-editor accepts NotesPersistence and hideHeader option — auto-save path"
```

---

### Task 4: Wire workspace into [...]slug.astro

**Files:**
- Modify: `src/pages/[...slug].astro`

- [ ] **Step 4.1: Identify the content-area div**

Search for `.content-area` in `[...slug].astro`. It is the main div that holds the rendered note HTML and the inline editor mount point. It will look something like:

```astro
<div class="content-area" id="content-area">
  <!-- rendered note content -->
  <div id="inline-notes-editor-mount" hidden ...></div>
  <div class="rendered-content">...</div>
</div>
```

- [ ] **Step 4.2: Add id attribute to the content-area div**

Ensure the content-area div has `id="cnw-root"`:
```astro
<div class="content-area" id="cnw-root">
  ...
</div>
```

- [ ] **Step 4.3: Add workspace init script**

Add a new `<script>` tag (near the other course page scripts):

```astro
<script define:vars={{ courseId: canonicalCourseId || courseSlug, currentSlug: currentEntrySourcePath || null }}>
  // Inline vars passed from Astro server
  window.__cnwCourseId = courseId;
  window.__cnwInitialSlug = currentSlug;
</script>

<script>
  import { initDockviewWorkspace } from '../scripts/course/dockview-workspace.ts';

  const container = document.getElementById('cnw-root');
  const courseId = (window as any).__cnwCourseId as string;
  const initialSlug = (window as any).__cnwInitialSlug as string | null;

  if (container && courseId) {
    // Grab the server-rendered HTML to use as the initial panel's preview content
    const initialHtml = container.innerHTML;
    container.innerHTML = ''; // clear — dockview takes over

    (window as any).__cnwWorkspace = initDockviewWorkspace(
      container,
      courseId,
      initialSlug,
      null, // we'll load via API; server HTML is complex with scripts
    );
  }
</script>
```

- [ ] **Step 4.4: Verify default 1-panel load**

```bash
npm run dev
```

Navigate to a course lesson as a teacher. Expected:
- Content area shows 1 dockview panel
- Panel renders note preview (raw markdown body in a `<pre>` for now)
- No visible tab bar (dockview native tabs hidden)
- Header area is invisible (0px height effectively) with pencil icon appearing on hover
- Sidebar `note-open` event (from clicking a note) loads it into the panel

As a non-teacher: content area is unchanged (the script targets `#cnw-root` which only exists when teacher-gated code runs). **Verify non-teacher view is unaffected.**

- [ ] **Step 4.5: Commit**

```bash
git add src/pages/\[...slug\].astro
git commit -m "feat: wire dockview workspace into course content-area, intercept note-open events"
```

---

### Task 5: Pencil toggle — edit mode with auto-save, no save button

- [ ] **Step 5.1: Test the pencil toggle in browser**

1. Hover over the panel — pencil icon should appear (opacity 0 → 0.6)
2. Click pencil — panel should switch to edit mode (CodeMirror loads via `mountInlineNotesEditor`)
3. Type a character — status dot should show `pending` (dim dot)
4. Wait 1.5s — status dot should show `saving` (blue, pulsing), then disappear
5. Verify the note file was updated on disk (check the `.md` file)
6. Click pencil (now eye icon) — panel should return to preview mode
7. Verify `flush()` was called (no pending unsaved content)

- [ ] **Step 5.2: Test crash recovery**

1. Switch to edit mode, type some text
2. IMMEDIATELY close the browser tab (before 1.5s debounce fires)
3. Reopen the page, navigate to the same note, click pencil
4. Recovery banner should appear: "Borrador recuperado (HH:MM:SS)"
5. Click "Usar borrador" — editor loads the recovered content
6. Click "Descartar" on a second test — draft discarded, server content loaded

- [ ] **Step 5.3: Test split panel**

From the browser console (Plan 2 standalone, before Cmd+click is wired):
```javascript
window.__cnwWorkspace.openNote('cursos/s123/some-note.md', 'preview', true)
```

A second panel should appear to the right. The first panel remains visible.

- [ ] **Step 5.4: Commit if fixes were needed**

```bash
git add -A
git commit -m "fix: dockview workspace mode toggle, auto-save, crash recovery verified"
```

---

### Task 6: Wire Cmd/Ctrl+click on sidebar note links for split panel

**Files:**
- Modify: `src/scripts/course/sidebar/notes-sidebar.ts`

- [ ] **Step 6.1: Update the note link click handler to pass split flag**

In `renderNotesSidebar`, find the `a.addEventListener('click', ...)` handler and update it:

```typescript
a.addEventListener('click', e => {
  const split = e.metaKey || e.ctrlKey;
  const cancelled = !window.dispatchEvent(
    new CustomEvent('note-open', {
      detail: { slug: note.slug, courseId, mode: 'preview', split },
      cancelable: true,
      bubbles: false,
    }),
  );
  if (cancelled) e.preventDefault();
});
```

- [ ] **Step 6.2: Update note-open handler in dockview-workspace.ts to pass split**

The `note-open` event listener in `initDockviewWorkspace` already reads `split` if it's in the detail — verify:

```typescript
window.addEventListener('note-open', (e: Event) => {
  const ev = e as CustomEvent<{ slug: string; courseId: string; mode: NoteMode; split?: boolean }>;
  (e as CustomEvent).preventDefault?.();  // This is not how CustomEvent works — fix:
  e.preventDefault();  // cancelable: true allows this
  openNote(ev.detail.slug, ev.detail.mode ?? 'preview', ev.detail.split ?? false);
});
```

**Note:** `CustomEvent` supports `preventDefault()` when `cancelable: true`. The sidebar dispatches with `cancelable: true`, so `e.preventDefault()` in the workspace listener prevents the sidebar's fallback navigation.

- [ ] **Step 6.3: Test Cmd+click**

1. Cmd+click (Mac) or Ctrl+click (Windows/Linux) on a sidebar note link
2. A second panel should open to the right without replacing the current one
3. Regular click navigates the focused panel

- [ ] **Step 6.4: Commit**

```bash
git add src/scripts/course/sidebar/notes-sidebar.ts src/scripts/course/dockview-workspace.ts
git commit -m "feat: Cmd+click on sidebar note opens split panel"
```

---

### Task 7: Final integration check

- [ ] **Step 7.1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7.2: Manual smoke test checklist**

**Default behavior (teacher):**
- [ ] Course page loads with 1 dockview panel showing current note in preview
- [ ] No visible tab bar, no save button anywhere
- [ ] Pencil icon visible on hover, invisible at rest
- [ ] Click pencil → edit mode loads (CodeMirror, YAML strip, snippet toolbar)
- [ ] Type → status dot appears after 1.5s, fades on save
- [ ] Click eye icon → preview mode, note content updated
- [ ] Sidebar click → note loads in current panel
- [ ] Cmd+click → second panel opens to the right

**Auto-save:**
- [ ] Type, wait 1.5s → dot saves → file updated on disk
- [ ] Crash recovery: close tab mid-edit, reopen → recovery banner appears

**Non-teacher:**
- [ ] Page unchanged (no dockview container, static content)

**Sidebar (Plan 1 integration):**
- [ ] `notes-sidebar-refresh` dispatched after auto-save → sidebar updates title if changed
- [ ] Context menu "Editar" → panel switches to edit mode

- [ ] **Step 7.3: Final commit**

```bash
git add -A
git commit -m "feat: complete dockview notes workspace — transparent panels, auto-save, split, crash recovery"
```
