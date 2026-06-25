import {
  type ResourceItem,
  renderFiletree,
  addItem,
  removeItem,
  moveItem,
  foldersFromItems,
} from './filetree';
import {
  type ResourceType,
  typeFromUrl,
  isVideoUrl,
  nameFromFile,
  quickNameFromUrl,
  resolveNameFromUrl,
} from './metadata';

type RecursosOptions = {
  container: HTMLElement;
  isTeacher: boolean;
  getCourseId: () => string | null;
  getCourseRootId?: () => string | null;
  getRoomName: () => string | null;
  getIdentity: () => string;
  publish: (msg: RecursosMessage) => void;
  getRecursosAutoOpen?: () => boolean;
};

type RecursosMessage =
  | {
      type: 'recursos:sync';
      items: ResourceItem[];
      allowStudents: boolean;
      emptyFolders?: string[];
      sessionId?: string | null;
      sessionName?: string;
    }
  | { type: 'recursos:allow-students'; allow: boolean };

export class RecursosController {
  private container: HTMLElement;
  private isTeacher: boolean;
  private getCourseId: () => string | null;
  private getCourseRootId?: () => string | null;
  private getRoomName: () => string | null;
  private getIdentity: () => string;
  private publish: (msg: RecursosMessage) => void;
  private getRecursosAutoOpen?: () => boolean;

  private items: ResourceItem[] = [];
  private allowStudents = true;
  private collapsedFolders = new Set<string>();
  private emptyFolders = new Set<string>();
  private draggedItemId: string | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private autosaveDirty = false;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private headerLabel = '';

  private ctxTargetItem: ResourceItem | null = null;
  private ctxTargetFolder: string | null = null;

  private sessionId: string | null = null;
  private sessionName = '';
  private sessionResources = new Map<string, ResourceItem[]>();

  private contentEl!: HTMLElement;
  private dropOverlayEl!: HTMLElement;
  private ctxMenuEl!: HTMLElement;
  private ctxNewFolderBtn!: HTMLButtonElement;
  private ctxPasteBtn!: HTMLButtonElement;
  private ctxDownloadBtn!: HTMLButtonElement;
  private ctxOpenNewBtn!: HTMLButtonElement;
  private ctxRenameBtn!: HTMLButtonElement;
  private ctxMoveBtn!: HTMLButtonElement;
  private ctxDeleteBtn!: HTMLButtonElement;
  private sessionCtxEl!: HTMLElement;
  private sessionCtxNewBtn!: HTMLButtonElement;
  private sessionCtxRenameBtn!: HTMLButtonElement;
  private sessionCtxListBtn!: HTMLButtonElement;
  private sessionCtxDeleteBtn!: HTMLButtonElement;
  private sessionsModalEl!: HTMLElement;
  private sessionsListEl!: HTMLElement;

  constructor(opts: RecursosOptions) {
    this.container = opts.container;
    this.isTeacher = opts.isTeacher;
    this.getCourseId = opts.getCourseId;
    this.getCourseRootId = opts.getCourseRootId;
    this.getRoomName = opts.getRoomName;
    this.getIdentity = opts.getIdentity;
    this.publish = opts.publish;
    this.getRecursosAutoOpen = opts.getRecursosAutoOpen;
    this.bindElements();
    this.bindEvents();
    void this.bootstrap();
  }

  private bindElements() {
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector<T>(sel)!;
    this.contentEl          = q('[data-re-content]');
    this.dropOverlayEl      = q('[data-re-drop-overlay]');
    this.ctxMenuEl          = q('[data-re-ctx-menu]');
    this.ctxNewFolderBtn    = q('[data-re-ctx-new-folder]');
    this.ctxPasteBtn        = q('[data-re-ctx-paste]');
    this.ctxDownloadBtn     = q('[data-re-ctx-download]');
    this.ctxOpenNewBtn      = q('[data-re-ctx-open-new]');
    this.ctxRenameBtn       = q('[data-re-ctx-rename]');
    this.ctxMoveBtn         = q('[data-re-ctx-move]');
    this.ctxDeleteBtn       = q('[data-re-ctx-delete]');
    this.sessionCtxEl       = q('[data-re-session-ctx]');
    this.sessionCtxNewBtn   = q('[data-re-sctx-new]');
    this.sessionCtxRenameBtn = q('[data-re-sctx-rename]');
    this.sessionCtxListBtn  = q('[data-re-sctx-list]');
    this.sessionCtxDeleteBtn = q('[data-re-sctx-delete]');
    this.sessionsModalEl    = q('[data-re-sessions-modal]');
    this.sessionsListEl     = q('[data-re-sessions-list]');
  }

  private async bootstrap() {
    const roomName = this.getRoomName() ?? '';
    const claseId  = this.getEffectiveCourseId();
    if (!roomName) return;

    this.headerLabel = localStorage.getItem(`re:header:${claseId ?? '_'}`) ?? '';
    try {
      const raw = localStorage.getItem(`re:collapsed:${claseId ?? '_'}`);
      if (raw) JSON.parse(raw).forEach((f: string) => this.collapsedFolders.add(f));
    } catch { /**/ }
    this.loadEmptyFoldersFromStorage();

    try {
      const params = new URLSearchParams({ roomName, claseId: claseId ?? '' });
      const resp = await fetch(`/api/live/recursos?${params}`);
      if (resp.ok) this.items = this.dedupeItems((await resp.json()).items ?? []);
    } catch { /**/ }

    try {
      const resp = await fetch(`/api/live/recursos/compartidos-history?roomName=${encodeURIComponent(roomName)}`);
      if (resp.ok) for (const item of ((await resp.json()).items ?? [])) this.items = addItem(this.items, item);
    } catch { /**/ }

    await this.loadSession();
    this.loadEmptyFoldersFromStorage();
    this.render();
  }

  private async loadSession(): Promise<void> {
    const roomName = this.getRoomName() ?? '';
    if (!roomName) return;
    const courseId = this.getCourseRootId?.() ?? null;
    const claseId = this.getEffectiveCourseId();
    try {
      const params = new URLSearchParams({
        roomName,
        ...(claseId && { claseId }),
        ...(courseId && { courseId }),
      });
      // Fetch latest session for the room
      const resp = await fetch(`/api/live/session?${params}`);
      if (resp.ok) {
        const { session } = await resp.json();
        if (session) {
          this.sessionId = session.id;
          this.sessionName = session.name;
          await this.loadSessionResources([session.id]);
        }
      }
    } catch { /**/ }
    this.updateSessionBar();
  }

  private async loadSessionResources(sessionIds: string[]): Promise<void> {
    const roomName = this.getRoomName() ?? '';
    const ids = [...new Set(sessionIds.filter(Boolean))];
    if (!roomName || ids.length === 0) return;
    try {
      const params = new URLSearchParams({ roomName, sessionIds: ids.join(',') });
      const resp = await fetch(`/api/live/recursos?${params}`);
      if (!resp.ok) return;
      const items = this.dedupeItems((await resp.json()).items ?? []);
      for (const sessionId of ids) {
        this.sessionResources.set(sessionId, items.filter((item) => item.sessionId === sessionId));
      }
      for (const item of items) this.items = addItem(this.items, item);
      this.items = this.dedupeItems(this.items);
    } catch { /**/ }
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    if (!this.isTeacher) {
      await this.loadSession();
      return this.sessionId ?? '';
    }
    const roomName = this.getRoomName() ?? '';
    const claseId  = this.getCourseId();
    const courseId = this.getCourseRootId?.() ?? null;
    const name = new Date().toISOString().slice(0, 10) + '-sesión';
    try {
      const resp = await fetch('/api/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, name, claseId, courseId }),
      });
      if (resp.ok) {
        const { session } = await resp.json();
        this.sessionId = session.id;
        this.sessionName = session.name;
        this.updateSessionBar();
        this.broadcastSync();
      }
    } catch { /**/ }
    return this.sessionId ?? '';
  }

  private updateSessionBar(): void {
    // session state is reflected in the header — re-render
    this.render();
  }

  private bindEvents() {
    window.addEventListener('musiki:recursos:receive', (e: Event) => {
      this.applyRemoteMessage((e as CustomEvent<RecursosMessage>).detail);
    });
    window.addEventListener('musiki:clase-presentation-changed', (e: Event) => {
      const claseId = (e as CustomEvent<{ lessonId: string | null }>).detail?.lessonId ?? null;
      if (!this.headerLabel) this.updateHeaderText(this.claseLabel(claseId));
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushSave();
    });
    window.addEventListener('beforeunload', () => this.flushSave());

    window.addEventListener('musiki:recursos:sa-uploaded', (e: Event) => {
      const { url, name } = (e as CustomEvent<{ url: string; name: string }>).detail;
      void this.addSaFile(url, name);
    });
    window.addEventListener('musiki:recursos:visual-uploaded', (e: Event) => {
      const { url, name } = (e as CustomEvent<{ url: string; name: string }>).detail;
      void this.addVisualFile(url, name);
    });
    window.addEventListener('musiki:recursos:chat-url', (e: Event) => {
      const { url } = (e as CustomEvent<{ url: string }>).detail;
      void this.addCompartido(url, quickNameFromUrl(url), 'chat');
      void resolveNameFromUrl(url).then(name => {
        this.items = this.items.map(i => i.url === url ? { ...i, name } : i);
        this.render(); this.scheduleAutosave();
      });
    });
    window.addEventListener('musiki:recursos:external-media', (e: Event) => {
      const { url, name, folder, source } = (e as CustomEvent<{ url: string; name: string; folder?: string; source?: ResourceItem['source'] }>).detail;
      void this.addCompartido(url, name || quickNameFromUrl(url), source || 'external-media', folder);
    });

    this.ctxNewFolderBtn.addEventListener('click', () => {
      this.closeCtxMenu();
      this.startNewFolder();
    });
    this.ctxPasteBtn.addEventListener('click', () => {
      this.closeCtxMenu();
      void this.pasteClipboard();
    });
    this.ctxDownloadBtn.addEventListener('click', () => this.downloadCtxTarget());
    this.ctxOpenNewBtn.addEventListener('click', () => this.openCtxTargetInNewInstance());
    this.ctxRenameBtn.addEventListener('click', () => this.startInlineRename());
    this.ctxDeleteBtn.addEventListener('click', () => this.deleteCtxTarget());
    this.ctxMoveBtn.addEventListener('click', () => this.showMoveSubmenu());

    this.sessionCtxNewBtn.addEventListener('click', () => { this.closeSessionCtx(); void this.newSession(); });
    this.sessionCtxRenameBtn.addEventListener('click', () => { this.closeSessionCtx(); void this.renameSession(); });
    this.sessionCtxListBtn.addEventListener('click', () => { this.closeSessionCtx(); void this.showSessionsList(); });
    this.sessionCtxDeleteBtn.addEventListener('click', () => { this.closeSessionCtx(); void this.deleteSession(); });

    document.addEventListener('click', (e) => {
      if (!this.ctxMenuEl.contains(e.target as Node)) this.closeCtxMenu();
      if (!this.sessionCtxEl.contains(e.target as Node) && !this.sessionsModalEl.contains(e.target as Node)) this.closeSessionCtx();
    });

    this.container.addEventListener('dragenter', (e) => {
      if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); this.dropOverlayEl.dataset.active = 'true'; }
    });
    this.container.addEventListener('dragleave', (e) => {
      if (!this.container.contains(e.relatedTarget as Node)) this.dropOverlayEl.dataset.active = 'false';
    });
    this.container.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    this.container.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropOverlayEl.dataset.active = 'false';
      const targetFolder = this.folderFromDropTarget(e.target);
      Array.from(e.dataTransfer?.files ?? []).forEach(f => void this.uploadFile(f, targetFolder));
    });
    this.contentEl.addEventListener('touchstart', (e) => {
      const el = (e.target as Element).closest('[data-item-id]');
      if (!el) return;
      this.longPressTimer = setTimeout(() => {
        const item = this.items.find(i => i.id === (el as HTMLElement).dataset.itemId!);
        if (item) this.openItemCtxMenu(item, { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY } as MouseEvent);
      }, 2000);
    }, { passive: true });
    this.contentEl.addEventListener('touchend', () => {
      if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
    }, { passive: true });
    this.contentEl.addEventListener('contextmenu', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('.re-item, .re-folder-row, .re-header')) return;
      e.preventDefault();
      e.stopPropagation();
      this.openRootCtxMenu(e);
    });
  }

  private canEdit() { return true; }
  private canSendSonic() { return true; }
  private canSendVisual() { return true; }

  // ── Header ──────────────────────────────────────────────────────────────────

  private claseLabel(claseId: string | null) {
    if (!claseId) return 'Re';
    const parts = claseId.split('/').slice(-2);
    const slug  = parts[parts.length - 1] ?? 'clase';
    return `${parts.join('/')}/recursos-${slug}.md`;
  }

  private updateHeaderText(text: string) {
    const el = this.contentEl.querySelector<HTMLElement>('.re-header');
    if (el && !el.isContentEditable) el.textContent = text;
  }

  private buildHeaderEl(): HTMLElement {
    const el = document.createElement('div');
    el.className = 're-header';
    if (this.sessionId && this.sessionName) {
      el.innerHTML = `<span class="re-header-session">📁 ${this.sessionName}</span>`;
    } else {
      const claseId = this.getCourseId();
      el.textContent = this.headerLabel || this.claseLabel(claseId);
    }
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.isTeacher) this.openSessionCtx(e as MouseEvent);
      else this.startHeaderInlineEdit(el);
    });
    return el;
  }

  private startHeaderInlineEdit(el: HTMLElement) {
    el.contentEditable = 'true';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const finish = () => {
      el.contentEditable = 'false';
      const val = el.textContent?.trim() ?? '';
      if (val) {
        this.headerLabel = val;
        localStorage.setItem(`re:header:${this.getCourseId() ?? '_'}`, val);
      } else {
        el.textContent = this.headerLabel || this.claseLabel(this.getCourseId());
      }
      el.removeEventListener('blur', finish);
      el.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(); }
      if (e.key === 'Escape') { el.textContent = this.headerLabel || this.claseLabel(this.getCourseId()); finish(); }
    };
    el.addEventListener('blur', finish, { once: true });
    el.addEventListener('keydown', onKey);
  }

  // ── Compartidos ──────────────────────────────────────────────────────────────

  private async addCompartido(url: string, name: string, source: ResourceItem['source'], folder = 'compartidos') {
    if (!url) return;
    const sid = await this.ensureSession();
    const nextItems = addItem(this.items, {
      id: crypto.randomUUID(), url, name,
      type: typeFromUrl(url), folder, source,
      createdBy: this.getIdentity(), sortOrder: this.items.length, createdAt: new Date().toISOString(),
      sessionId: sid || null,
    });
    this.commitItemsIfChanged(nextItems);
  }

  // ── SA media file ─────────────────────────────────────────────────────────────

  private async addSaFile(url: string, name: string): Promise<void> {
    if (!url) return;
    const sid = await this.ensureSession();
    const nextItems = addItem(this.items, {
      id: crypto.randomUUID(), url, name,
      type: typeFromUrl(url), folder: 'media', source: 'sa',
      createdBy: this.getIdentity(), sortOrder: this.items.length, createdAt: new Date().toISOString(),
      sessionId: sid || null,
    });
    this.commitItemsIfChanged(nextItems);
  }

  private async addVisualFile(url: string, name: string): Promise<void> {
    if (!url) return;
    const sid = await this.ensureSession();
    const nextItems = addItem(this.items, {
      id: crypto.randomUUID(), url, name,
      type: typeFromUrl(url), folder: 'DOC', source: 'vs',
      createdBy: this.getIdentity(), sortOrder: this.items.length, createdAt: new Date().toISOString(),
      sessionId: sid || null,
    });
    this.commitItemsIfChanged(nextItems);
  }

  private commitItemsIfChanged(nextItems: ResourceItem[]): boolean {
    if (nextItems === this.items) return false;
    this.items = nextItems;
    this.render(); this.scheduleAutosave(); this.broadcastSync();
    void this.saveNow();
    return true;
  }

  // ── Session management ────────────────────────────────────────────────────────

  private async newSession(): Promise<void> {
    if (!this.isTeacher) return;
    const roomName = this.getRoomName() ?? '';
    const claseId  = this.getEffectiveCourseId();
    const courseId = this.getCourseRootId?.() ?? null;
    const suggestedName = new Date().toISOString().slice(0, 10) + '-sesión';
    const name = window.prompt('Nombre de la nueva sesión:', suggestedName)?.trim();
    if (!name) return;
    try {
      const resp = await fetch('/api/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, name, claseId, courseId }),
      });
      if (resp.ok) {
        const { session } = await resp.json();
        this.sessionId = session.id;
        this.sessionName = session.name;
        this.loadEmptyFoldersFromStorage();
        await this.loadSessionResources([session.id]);
        this.updateSessionBar();
        this.broadcastSync();
      }
    } catch { /**/ }
  }

  private async deleteSession(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await fetch(`/api/live/session?id=${encodeURIComponent(this.sessionId)}`, { method: 'DELETE' });
    } catch { /**/ }
    this.sessionId = null;
    this.sessionName = '';
    this.loadEmptyFoldersFromStorage();
    this.updateSessionBar();
    this.broadcastSync();
  }

  private async renameSession(): Promise<void> {
    if (!this.sessionId) return;
    const name = window.prompt('Nombre de sesión', this.sessionName || new Date().toISOString().slice(0, 10) + '-sesión');
    if (!name?.trim()) return;
    try {
      const resp = await fetch('/api/live/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: this.sessionId, name }),
      });
      if (resp.ok) {
        this.sessionName = name.trim();
        this.updateSessionBar();
        this.broadcastSync();
      }
    } catch { /**/ }
  }

  // ── Session context menu ──────────────────────────────────────────────────────

  private openSessionCtx(e: MouseEvent): void {
    this.sessionCtxEl.removeAttribute('hidden');
    this.sessionCtxEl.style.left = `${e.clientX}px`;
    this.sessionCtxEl.style.top  = `${e.clientY}px`;
    this.sessionCtxRenameBtn.disabled = !this.sessionId;
    this.sessionCtxDeleteBtn.disabled = !this.sessionId;
  }

  private closeSessionCtx(): void {
    this.sessionCtxEl.setAttribute('hidden', '');
  }

  private async showSessionsList(): Promise<void> {
    const roomName = this.getRoomName() ?? '';
    if (!roomName) return;
    this.sessionsModalEl.removeAttribute('hidden');
    this.sessionsListEl.innerHTML = '<div style="padding:6px 10px;font-size:10px;color:#444">cargando…</div>';
    try {
      const resp = await fetch(`/api/live/session?roomName=${encodeURIComponent(roomName)}&list=1`);
      if (!resp.ok) throw new Error();
      const { sessions } = await resp.json();
      if (!sessions.length) {
        this.sessionsListEl.innerHTML = '<div style="padding:6px 10px;font-size:10px;color:#444">sin sesiones</div>';
        return;
      }
      await this.loadSessionResources(sessions.map((session: any) => String(session.id || '')).filter(Boolean));
      this.sessionsListEl.innerHTML = '';
      for (const s of sessions) {
        const item = document.createElement('div');
        item.className = 're-session-item' + (s.id === this.sessionId ? ' re-session-item--active' : '');
        const date = new Date(s.createdAt).toLocaleDateString('es', { month: 'short', day: 'numeric' });
        const sessionItems = this.itemsForSession(s.id);
        item.innerHTML = `
          <div class="re-session-item-row">
            <span class="re-session-item-name">${this.escapeHtml(s.name)}</span>
            <span class="re-session-item-date">${date}</span>
          </div>
          <div class="re-session-files">
            ${sessionItems.length
              ? sessionItems.map((resource) => `<button type="button" class="re-session-file" data-item-id="${this.escapeHtml(resource.id)}" title="${this.escapeHtml(resource.url)}">${this.escapeHtml(resource.name)}</button>`).join('')
              : '<span class="re-session-file-empty">sin archivos</span>'}
          </div>
        `;
        item.addEventListener('click', async (event) => {
          const target = event.target;
          if (target instanceof HTMLElement && target.matches('[data-item-id]')) {
            const resource = this.items.find((candidate) => candidate.id === target.dataset.itemId);
            if (resource) this.requestResourceOpen(resource);
            return;
          }
          this.sessionId = s.id;
          this.sessionName = s.name;
          this.loadEmptyFoldersFromStorage();
          await this.loadSessionResources([s.id]);
          this.sessionsModalEl.setAttribute('hidden', '');
          this.render();
          this.broadcastSync();
        });
        this.sessionsListEl.appendChild(item);
      }
    } catch {
      this.sessionsListEl.innerHTML = '<div style="padding:6px 10px;font-size:10px;color:#e06666">error</div>';
    }
  }

  private itemsForSession(sessionId: string): ResourceItem[] {
    const known = this.items.filter((item) => item.sessionId === sessionId);
    const loaded = this.sessionResources.get(sessionId) ?? [];
    return this.dedupeItems([...known, ...loaded]);
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private downloadCtxTarget(): void {
    const item = this.ctxTargetItem;
    this.closeCtxMenu();
    if (!item?.url) return;
    const anchor = document.createElement('a');
    anchor.href = item.url;
    anchor.download = item.name || item.url.split('/').pop() || 'recurso';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  private openCtxTargetInNewInstance(): void {
    const item = this.ctxTargetItem;
    this.closeCtxMenu();
    if (!item) return;
    this.requestResourceOpen(item, { forceNew: true });
  }

  // ── Upload ───────────────────────────────────────────────────────────────────

  private folderFromDropTarget(target: EventTarget | null): string | undefined {
    if (!(target instanceof Element)) return undefined;
    const folderEl = target.closest<HTMLElement>('[data-folder]');
    return folderEl?.dataset.folder?.trim() || undefined;
  }

  private async uploadFile(file: File, targetFolder?: string) {
    if (!this.canEdit()) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const resp = await fetch('/api/room/re-store', { method: 'POST', body: form });
      if (!resp.ok) { console.error('[Re] upload failed', resp.status); return; }
      const { url } = await resp.json();
      const type = typeFromUrl(url);
      const sid = await this.ensureSession();
      const newItem: ResourceItem = {
        id: crypto.randomUUID(), url, name: nameFromFile(file),
        type, folder: targetFolder ?? this.defaultFolderForType(type), source: 'upload',
        createdBy: this.getIdentity(), sortOrder: this.items.length, createdAt: new Date().toISOString(),
        sessionId: sid || null,
      };
      this.commitItemsIfChanged(addItem(this.items, newItem));
    } catch (e) { console.error('[Re] upload error', e); }
  }

  private async pasteClipboard() {
    if (!this.canEdit()) return;
    try {
      const clipboard = navigator.clipboard as Clipboard & {
        read?: () => Promise<ClipboardItem[]>;
      };
      if (typeof clipboard.read === 'function') {
        const entries = await clipboard.read();
        for (const entry of entries) {
          const type = entry.types.find((candidate) =>
            candidate.startsWith('image/') || candidate.startsWith('audio/') || candidate.startsWith('video/') || candidate === 'application/pdf'
          );
          if (!type) continue;
          const blob = await entry.getType(type);
          const ext = type.split('/').pop()?.replace('jpeg', 'jpg') || 'bin';
          const file = new File([blob], `clipboard-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`, { type });
          await this.uploadFile(file);
          return;
        }
      }
      const text = (await navigator.clipboard.readText()).trim();
      if (!/^https?:\/\//i.test(text)) return;
      const sid = await this.ensureSession();
      const type = typeFromUrl(text);
      const item: ResourceItem = {
        id: crypto.randomUUID(), url: text, name: quickNameFromUrl(text),
        type, folder: this.defaultFolderForType(type), source: 'paste',
        createdBy: this.getIdentity(), sortOrder: this.items.length, createdAt: new Date().toISOString(),
        sessionId: sid || null,
      };
      const added = this.commitItemsIfChanged(addItem(this.items, item));
      if (!added) return;
      void resolveNameFromUrl(text).then(name => {
        this.items = this.items.map(i => i.id === item.id ? { ...i, name } : i);
        this.render(); this.scheduleAutosave();
        void this.saveNow();
      });
    } catch { /**/ }
  }

  // ── Sync ─────────────────────────────────────────────────────────────────────

  private broadcastSync() {
    this.items = this.dedupeItems(this.items);
    this.publish({
      type: 'recursos:sync',
      items: this.items,
      allowStudents: this.allowStudents,
      emptyFolders: [...this.emptyFolders],
      sessionId: this.sessionId,
      sessionName: this.sessionName,
    });
  }

  public publishCurrentState(): void {
    this.broadcastSync();
  }

  applyRemoteMessage(msg: RecursosMessage) {
    if (msg.type === 'recursos:sync') {
      const nextSessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim()
        ? msg.sessionId.trim()
        : null;
      const nextSessionName = typeof msg.sessionName === 'string' ? msg.sessionName.trim() : '';
      const sessionChanged = nextSessionId !== this.sessionId || nextSessionName !== this.sessionName;
      this.sessionId = nextSessionId;
      this.sessionName = nextSessionName;
      this.items = this.dedupeItems(msg.items);
      this.allowStudents = msg.allowStudents;
      this.emptyFolders = new Set((msg.emptyFolders ?? []).map((folder) => String(folder || '').trim()).filter(Boolean));
      this.persistEmptyFolders();
      if (sessionChanged && this.sessionId) {
        this.sessionResources.set(this.sessionId, this.items.filter((item) => item.sessionId === this.sessionId));
      }
      this.render();
      void this.saveNow();
      this.emitAllowStudentsChanged();
    } else if (msg.type === 'recursos:allow-students') {
      this.allowStudents = true;
      this.emitAllowStudentsChanged();
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  private scheduleAutosave() {
    this.autosaveDirty = true;
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => void this.save(), 5000);
  }

  private async save() {
    const roomName = this.getRoomName() ?? '';
    if (!roomName || !this.autosaveDirty) return;
    try {
      const resp = await fetch('/api/live/recursos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // claseId must be string | null. The live autosave endpoint persists DB only;
        // markdown projection is intentionally reserved for the recursos editor.
        body: JSON.stringify(this.buildSavePayload(roomName)),
      });
      if (resp.ok) this.autosaveDirty = false;
    } catch { /**/ }
  }

  private async saveNow() {
    this.autosaveDirty = true;
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    await this.save();
  }

  private flushSave() {
    const roomName = this.getRoomName() ?? '';
    if (!roomName || !this.autosaveDirty) return;
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    this.autosaveDirty = false;
    navigator.sendBeacon('/api/live/recursos',
      new Blob([JSON.stringify(this.buildSavePayload(roomName))],
        { type: 'application/json' }));
  }

  private buildSavePayload(roomName: string) {
    const courseRootId = this.getCourseRootId?.() ?? null;
    return {
      roomName,
      claseId: this.getEffectiveCourseId(),
      courseRootId,
      items: this.dedupeItems(this.items),
    };
  }

  private getEffectiveCourseId(): string | null {
    return this.getCourseRootId?.() ?? this.getCourseId() ?? null;
  }

  private dedupeItems(items: ResourceItem[]): ResourceItem[] {
    const seen = new Set<string>();
    const result: ResourceItem[] = [];
    for (const item of items) {
      const url = String(item?.url || '').trim();
      if (!url) continue;
      const folder = String(item?.folder || '').trim();
      const sessionId = String(item?.sessionId || '').trim();
      const key = `${sessionId}\n${folder}\n${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ...item, url, folder });
    }
    return result;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  private visibleItems(): ResourceItem[] {
    return this.sessionId
      ? this.itemsForSession(this.sessionId)
      : this.items.filter((item) => !item.sessionId);
  }

  private render() {
    const visibleItems = this.visibleItems();
    renderFiletree(this.contentEl, visibleItems, this.collapsedFolders, this.emptyFolders, {
      headerEl: this.buildHeaderEl(),
      canEdit: this.canEdit(),
      onItemClick: (item) => {
        if (this.getRecursosAutoOpen ? this.getRecursosAutoOpen() : false) {
          this.requestResourceOpen(item);
        }
      },
      onItemDblClick: (item) => this.requestResourceOpen(item),
      onItemContextMenu: (item, e) => this.openItemCtxMenu(item, e),
      onFolderContextMenu: (folder, e) => this.openFolderCtxMenu(folder, e),
      onFolderToggle: (folder) => this.toggleFolder(folder),
      onDragStart: (id) => { this.draggedItemId = id; },
      onDragOverFolder: (folder) => {
        this.contentEl.querySelectorAll('[data-folder]').forEach(el =>
          (el.querySelector('.re-folder-row') as HTMLElement)?.removeAttribute('data-drag-over'));
        const row = this.contentEl.querySelector<HTMLElement>(`[data-folder="${folder}"] .re-folder-row`);
        if (row) row.dataset.dragOver = 'true';
      },
      onDrop: (targetFolder) => {
      if (this.draggedItemId) {
          this.items = moveItem(this.items, this.draggedItemId, targetFolder);
          this.draggedItemId = null;
          this.render(); this.scheduleAutosave(); this.broadcastSync();
          void this.saveNow();
        }
      },
    });
  }

  private requestResourceOpen(item: ResourceItem, options: { forceNew?: boolean } = {}): void {
    if (this.isExternalMediaLink(item)) {
      this.requestExternalMediaLoad(item);
      return;
    }

    const sentVisual = this.isVisualMedia(item) && this.canSendVisual();
    const sentSonic = this.isSonicMedia(item) && this.canSendSonic();
    if (sentVisual) {
      this.requestVisualLoad(item, options);
    }
    if (sentSonic) {
      this.requestSonicLoad(item, options);
    }
    if (sentVisual || sentSonic) return;
    window.open(item.url, '_blank', 'noopener');
  }

  // ── Folders ───────────────────────────────────────────────────────────────────

  private toggleFolder(folder: string) {
    if (this.collapsedFolders.has(folder)) this.collapsedFolders.delete(folder);
    else this.collapsedFolders.add(folder);
    localStorage.setItem(`re:collapsed:${this.getCourseId() ?? '_'}`, JSON.stringify([...this.collapsedFolders]));
    this.render();
  }

  private startNewFolder() {
    if (!this.canEdit()) return;
    // Render a temporary editable row at top of tree
    const el = document.createElement('div');
    el.className = 're-folder-row';
    el.innerHTML = `<span class="re-caret">▸</span><span class="re-folder-icon">📁</span><span class="re-folder-name" contenteditable="true" style="min-width:60px"></span>`;
    const input = el.querySelector<HTMLElement>('.re-folder-name')!;
    // Insert after header
    const header = this.contentEl.querySelector('.re-header');
    if (header) header.after(el); else this.contentEl.prepend(el);
    input.focus();
    const finish = () => {
      const name = input.textContent?.trim() ?? '';
      el.remove();
      if (name) {
        this.emptyFolders.add(name);
        this.render();
        this.persistEmptyFolders();
        this.scheduleAutosave();
        this.broadcastSync();
      }
      input.removeEventListener('blur', finish);
      input.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(); }
      if (e.key === 'Escape') { el.remove(); input.removeEventListener('blur', finish); }
    };
    input.addEventListener('blur', finish, { once: true });
    input.addEventListener('keydown', onKey);
  }

  private emptyFoldersStorageKey(sessionId = this.sessionId): string {
    const scope = sessionId ? `session:${sessionId}` : 'hold-root';
    return `re:empty-folders:${this.getRoomName() ?? '_'}:${this.getEffectiveCourseId() ?? '_'}:${scope}`;
  }

  private loadEmptyFoldersFromStorage(): void {
    this.emptyFolders = new Set();
    try {
      const raw = localStorage.getItem(this.emptyFoldersStorageKey());
      if (raw) JSON.parse(raw).forEach((f: string) => {
        const folder = String(f || '').trim();
        if (folder) this.emptyFolders.add(folder);
      });
    } catch { /**/ }
  }

  private persistEmptyFolders(): void {
    try {
      localStorage.setItem(this.emptyFoldersStorageKey(), JSON.stringify([...this.emptyFolders]));
    } catch { /**/ }
  }

  // ── Context menu ──────────────────────────────────────────────────────────────

  private openItemCtxMenu(item: ResourceItem, e: MouseEvent) {
    const canEdit = this.canEdit();
    const canOpenInPod = this.canOpenInAssociatedPod(item);
    if (!canEdit && !canOpenInPod) return;
    this.ctxTargetItem = item; this.ctxTargetFolder = null;
    this.ctxNewFolderBtn.style.display = 'none';
    this.ctxPasteBtn.style.display = 'none';
    this.ctxDownloadBtn.style.display = '';
    this.ctxOpenNewBtn.style.display = canOpenInPod ? '' : 'none';
    this.ctxMoveBtn.style.display = 'none';
    this.ctxRenameBtn.style.display = canEdit ? '' : 'none';
    this.ctxDeleteBtn.style.display = canEdit ? '' : 'none';
    this.ctxMenuEl.removeAttribute('hidden');
    this.ctxMenuEl.style.left = `${e.clientX}px`;
    this.ctxMenuEl.style.top  = `${e.clientY}px`;
  }

  private openFolderCtxMenu(folder: string, e: MouseEvent) {
    if (!this.canEdit()) return;
    const isPinnedFolder = folder === 'DOC' || folder === 'compartidos' || folder === 'media';
    this.ctxTargetFolder = folder; this.ctxTargetItem = null;
    this.ctxNewFolderBtn.style.display = '';
    this.ctxPasteBtn.style.display = '';
    this.ctxDownloadBtn.style.display = 'none';
    this.ctxOpenNewBtn.style.display = 'none';
    this.ctxMoveBtn.style.display = 'none';
    this.ctxRenameBtn.style.display = isPinnedFolder ? 'none' : '';
    this.ctxDeleteBtn.style.display = isPinnedFolder ? 'none' : '';
    this.ctxMenuEl.removeAttribute('hidden');
    this.ctxMenuEl.style.left = `${e.clientX}px`;
    this.ctxMenuEl.style.top  = `${e.clientY}px`;
  }

  private openRootCtxMenu(e: MouseEvent) {
    if (!this.canEdit()) return;
    this.ctxTargetFolder = null; this.ctxTargetItem = null;
    this.ctxNewFolderBtn.style.display = '';
    this.ctxPasteBtn.style.display = '';
    this.ctxDownloadBtn.style.display = 'none';
    this.ctxOpenNewBtn.style.display = 'none';
    this.ctxMoveBtn.style.display = 'none';
    this.ctxRenameBtn.style.display = 'none';
    this.ctxDeleteBtn.style.display = 'none';
    this.ctxMenuEl.removeAttribute('hidden');
    this.ctxMenuEl.style.left = `${e.clientX}px`;
    this.ctxMenuEl.style.top  = `${e.clientY}px`;
  }

  private canOpenInAssociatedPod(item: ResourceItem): boolean {
    return this.isExternalMediaLink(item) || this.isSonicMedia(item) || this.isVisualMedia(item);
  }

  private isExternalMediaLink(item: ResourceItem): boolean {
    return isVideoUrl(item.url);
  }

  private isSonicMedia(item: ResourceItem): boolean {
    const inferred = typeFromUrl(item.url);
    return item.type === 'audio' || item.type === 'video' || inferred === 'audio' || inferred === 'video';
  }

  private isVisualMedia(item: ResourceItem): boolean {
    const inferred = typeFromUrl(item.url);
    return item.type === 'pdf' || item.type === 'pptx' || item.type === 'img' || item.type === 'video'
      || inferred === 'pdf' || inferred === 'pptx' || inferred === 'img' || inferred === 'video';
  }

  private defaultFolderForType(type: ResourceType | 'other'): string {
    if (type === 'audio') return 'media';
    if (type === 'pdf' || type === 'pptx' || type === 'img' || type === 'video') return 'DOC';
    return '';
  }

  private requestSonicLoad(item: ResourceItem, options: { forceNew?: boolean } = {}): void {
    window.dispatchEvent(new CustomEvent('musiki:sonic:load-url', {
      detail: { url: item.url, name: item.name, source: 'recursos', forceNew: Boolean(options.forceNew) },
    }));
  }

  private requestVisualLoad(item: ResourceItem, options: { forceNew?: boolean } = {}): void {
    window.dispatchEvent(new CustomEvent('musiki:visual:load-url', {
      detail: { url: item.url, name: item.name, source: 'recursos', forceNew: Boolean(options.forceNew) },
    }));
  }

  private requestExternalMediaLoad(item: ResourceItem): void {
    window.dispatchEvent(new CustomEvent('musiki:external-media:open-url', {
      detail: { url: item.url, name: item.name, source: 'recursos' },
    }));
  }

  private closeCtxMenu() {
    this.ctxMenuEl.setAttribute('hidden', '');
    this.ctxTargetItem = null; this.ctxTargetFolder = null;
  }

  // ── Inline rename via contenteditable ─────────────────────────────────────────

  private startInlineRename() {
    const item   = this.ctxTargetItem;
    const folder = this.ctxTargetFolder;
    this.closeCtxMenu();

    if (item) {
      const el = this.contentEl.querySelector<HTMLElement>(`[data-item-id="${item.id}"] .re-item-name`);
      if (!el) return;
      this.makeEditable(el, item.name, (newName) => {
        this.items = this.items.map(i => i.id === item.id ? { ...i, name: newName } : i);
        this.render(); this.scheduleAutosave(); this.broadcastSync();
      });
    } else if (folder) {
      const el = this.contentEl.querySelector<HTMLElement>(`[data-folder="${folder}"] .re-folder-name`);
      if (!el) return;
      this.makeEditable(el, folder, (newName) => {
        this.items = this.items.map(i => i.folder === folder ? { ...i, folder: newName } : i);
        if (this.emptyFolders.has(folder)) { this.emptyFolders.delete(folder); this.emptyFolders.add(newName); }
        this.persistEmptyFolders();
        this.render(); this.scheduleAutosave(); this.broadcastSync();
      });
    }
  }

  private makeEditable(el: HTMLElement, original: string, onConfirm: (value: string) => void) {
    el.contentEditable = 'true';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const finish = () => {
      el.contentEditable = 'false';
      const val = el.textContent?.trim() ?? '';
      if (val && val !== original) onConfirm(val);
      else el.textContent = original;
      el.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(); }
      if (e.key === 'Escape') { el.textContent = original; el.contentEditable = 'false'; el.removeEventListener('keydown', onKey); }
    };
    el.addEventListener('blur', finish, { once: true });
    el.addEventListener('keydown', onKey);
  }

  // ── Delete / move ──────────────────────────────────────────────────────────────

  private async deleteCtxTarget() {
    const item = this.ctxTargetItem;
    const folder = this.ctxTargetFolder;
    this.closeCtxMenu();

    if (item) {
      if (!confirm(`¿Borrar "${item.name}" de RECURSOS?`)) return;
      this.items = removeItem(this.items, item.id);
      this.render(); this.scheduleAutosave(); this.broadcastSync();
      void this.saveNow();
    } else if (folder) {
      if (!confirm(`¿Borrar la carpeta "${folder}" y quitar sus recursos de esta sesión?`)) return;
      const visibleIds = new Set(this.visibleItems().filter((i) => i.folder === folder).map((i) => i.id));
      this.items = this.items.filter((i) => !visibleIds.has(i.id));
      this.emptyFolders.delete(folder);
      this.persistEmptyFolders();
      this.render(); this.scheduleAutosave(); this.broadcastSync();
      void this.saveNow();
    }
  }

  private showMoveSubmenu() {
    const item = this.ctxTargetItem; this.closeCtxMenu();
    if (!item) return;
    const folders = foldersFromItems(this.visibleItems()).filter(f => f !== item.folder);
    const target = prompt(`Mover a carpeta:\n${['(raíz)', ...folders].join('\n')}`);
    if (target === null) return;
    this.items = moveItem(this.items, item.id, target === '(raíz)' ? '' : target.trim());
    this.render(); this.scheduleAutosave(); this.broadcastSync();
    void this.saveNow();
  }

  private emitAllowStudentsChanged(): void {
    window.dispatchEvent(new CustomEvent('musiki:recursos:allow-students-changed', {
      detail: { allow: this.allowStudents },
    }));
  }

  dispose() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
  }
}
