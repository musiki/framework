import {
  type ResourceItem,
  renderFiletree,
  addItem,
  removeItem,
  moveItem,
  foldersFromItems,
  itemsInFolder,
} from './filetree';
import {
  typeFromUrl,
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
};

type RecursosMessage =
  | { type: 'recursos:sync'; items: ResourceItem[]; allowStudents: boolean }
  | { type: 'recursos:allow-students'; allow: boolean };

export class RecursosController {
  private container: HTMLElement;
  private isTeacher: boolean;
  private getCourseId: () => string | null;
  private getCourseRootId?: () => string | null;
  private getRoomName: () => string | null;
  private getIdentity: () => string;
  private publish: (msg: RecursosMessage) => void;

  private items: ResourceItem[] = [];
  private allowStudents = false;
  private collapsedFolders = new Set<string>();
  private emptyFolders = new Set<string>();
  private draggedItemId: string | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private headerLabel = '';

  private ctxTargetItem: ResourceItem | null = null;
  private ctxTargetFolder: string | null = null;

  private sessionId: string | null = null;
  private sessionName = '';

  private contentEl!: HTMLElement;
  private dropOverlayEl!: HTMLElement;
  private ctxMenuEl!: HTMLElement;
  private ctxRenameBtn!: HTMLButtonElement;
  private ctxMoveBtn!: HTMLButtonElement;
  private ctxDeleteBtn!: HTMLButtonElement;
  private ctxSendToSaBtn!: HTMLButtonElement;
  private sessionCtxEl!: HTMLElement;
  private sessionCtxNewBtn!: HTMLButtonElement;
  private sessionCtxListBtn!: HTMLButtonElement;
  private sessionCtxDeleteBtn!: HTMLButtonElement;
  private sessionsModalEl!: HTMLElement;
  private sessionsListEl!: HTMLElement;
  private collabBtn!: HTMLButtonElement;
  private foldBtn!: HTMLButtonElement;
  private newFolderBtn!: HTMLButtonElement;
  private pasteBtn!: HTMLButtonElement;
  private bottombarEl!: HTMLElement;

  constructor(opts: RecursosOptions) {
    this.container = opts.container;
    this.isTeacher = opts.isTeacher;
    this.getCourseId = opts.getCourseId;
    this.getCourseRootId = opts.getCourseRootId;
    this.getRoomName = opts.getRoomName;
    this.getIdentity = opts.getIdentity;
    this.publish = opts.publish;
    this.bindElements();
    this.bindEvents();
    void this.bootstrap();
  }

  private bindElements() {
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector<T>(sel)!;
    this.contentEl          = q('[data-re-content]');
    this.dropOverlayEl      = q('[data-re-drop-overlay]');
    this.ctxMenuEl          = q('[data-re-ctx-menu]');
    this.ctxRenameBtn       = q('[data-re-ctx-rename]');
    this.ctxMoveBtn         = q('[data-re-ctx-move]');
    this.ctxDeleteBtn       = q('[data-re-ctx-delete]');
    this.ctxSendToSaBtn     = q('[data-re-ctx-send-to-sa]');
    this.sessionCtxEl       = q('[data-re-session-ctx]');
    this.sessionCtxNewBtn   = q('[data-re-sctx-new]');
    this.sessionCtxListBtn  = q('[data-re-sctx-list]');
    this.sessionCtxDeleteBtn = q('[data-re-sctx-delete]');
    this.sessionsModalEl    = q('[data-re-sessions-modal]');
    this.sessionsListEl     = q('[data-re-sessions-list]');
    this.collabBtn          = q('[data-re-collab]');
    this.foldBtn            = q('[data-re-fold]');
    this.newFolderBtn       = q('[data-re-new-folder]');
    this.pasteBtn           = q('[data-re-paste]');
    this.bottombarEl        = q('[data-re-bottombar]');

    if (!this.isTeacher) this.bottombarEl.hidden = true;
    if (this.isTeacher)  this.collabBtn.style.display = '';
  }

  private async bootstrap() {
    const roomName = this.getRoomName() ?? '';
    const claseId  = this.getCourseId();
    if (!roomName) return;

    this.headerLabel = localStorage.getItem(`re:header:${claseId ?? '_'}`) ?? '';
    try {
      const raw = localStorage.getItem(`re:collapsed:${claseId ?? '_'}`);
      if (raw) JSON.parse(raw).forEach((f: string) => this.collapsedFolders.add(f));
    } catch { /**/ }

    try {
      const params = new URLSearchParams({ roomName, claseId: claseId ?? '' });
      const resp = await fetch(`/api/live/recursos?${params}`);
      if (resp.ok) this.items = (await resp.json()).items ?? [];
    } catch { /**/ }

    try {
      const resp = await fetch(`/api/live/recursos/compartidos-history?roomName=${encodeURIComponent(roomName)}`);
      if (resp.ok) for (const item of ((await resp.json()).items ?? [])) this.items = addItem(this.items, item);
    } catch { /**/ }

    await this.loadSession();
    this.render();
  }

  private async loadSession(): Promise<void> {
    const roomName = this.getRoomName() ?? '';
    if (!roomName) return;
    try {
      const resp = await fetch(`/api/live/session?roomName=${encodeURIComponent(roomName)}`);
      if (resp.ok) {
        const { session } = await resp.json();
        if (session) { this.sessionId = session.id; this.sessionName = session.name; }
      }
    } catch { /**/ }
    this.updateSessionBar();
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const roomName = this.getRoomName() ?? '';
    const claseId  = this.getCourseId();
    const name = new Date().toISOString().slice(0, 10) + '-sesión';
    try {
      const resp = await fetch('/api/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, name, claseId }),
      });
      if (resp.ok) {
        const { session } = await resp.json();
        this.sessionId = session.id;
        this.sessionName = session.name;
        this.updateSessionBar();
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
    window.addEventListener('musiki:recursos:chat-url', (e: Event) => {
      const { url } = (e as CustomEvent<{ url: string }>).detail;
      this.addCompartido(url, quickNameFromUrl(url), 'chat');
      void resolveNameFromUrl(url).then(name => {
        this.items = this.items.map(i => i.url === url ? { ...i, name } : i);
        this.render(); this.scheduleAutosave();
      });
    });
    window.addEventListener('musiki:recursos:external-media', (e: Event) => {
      const { url, name } = (e as CustomEvent<{ url: string; name: string }>).detail;
      this.addCompartido(url, name || quickNameFromUrl(url), 'external-media');
    });

    this.foldBtn.addEventListener('click', () => this.toggleFoldAll());
    this.newFolderBtn.addEventListener('click', () => this.startNewFolder());
    this.pasteBtn.addEventListener('click', () => void this.pasteClipboard());
    this.collabBtn.addEventListener('click', () => this.toggleAllowStudents());

    this.ctxRenameBtn.addEventListener('click', () => this.startInlineRename());
    this.ctxDeleteBtn.addEventListener('click', () => this.deleteCtxTarget());
    this.ctxMoveBtn.addEventListener('click', () => this.showMoveSubmenu());
    this.ctxSendToSaBtn.addEventListener('click', (e) => { e.stopPropagation(); this.sendCtxItemToSa(); });

    this.sessionCtxNewBtn.addEventListener('click', () => { this.closeSessionCtx(); void this.newSession(); });
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
      Array.from(e.dataTransfer?.files ?? []).forEach(f => void this.uploadFile(f));
    });
    this.contentEl.addEventListener('touchstart', (e) => {
      const el = (e.target as Element).closest('[data-item-id]');
      if (!el) return;
      this.longPressTimer = setTimeout(() => {
        const item = this.items.find(i => i.id === (el as HTMLElement).dataset.itemId!);
        if (item) this.openItemCtxMenu(item, { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY } as MouseEvent);
      }, 500);
    }, { passive: true });
    this.contentEl.addEventListener('touchend', () => {
      if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
    }, { passive: true });
  }

  private canEdit() { return this.isTeacher || this.allowStudents; }

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

  private addCompartido(url: string, name: string, source: ResourceItem['source']) {
    if (!url) return;
    this.items = addItem(this.items, {
      id: crypto.randomUUID(), url, name,
      type: typeFromUrl(url), folder: 'compartidos', source,
      createdBy: this.getIdentity(), sortOrder: this.items.length, createdAt: new Date().toISOString(),
    });
    this.render(); this.scheduleAutosave(); this.broadcastSync();
  }

  // ── SA media file ─────────────────────────────────────────────────────────────

  private async addSaFile(url: string, name: string): Promise<void> {
    if (!url) return;
    const sid = await this.ensureSession();
    this.items = addItem(this.items, {
      id: crypto.randomUUID(), url, name,
      type: typeFromUrl(url), folder: 'media', source: 'sa',
      createdBy: this.getIdentity(), sortOrder: this.items.length, createdAt: new Date().toISOString(),
      sessionId: sid || null,
    });
    this.render(); this.scheduleAutosave(); this.broadcastSync();
  }

  // ── Session management ────────────────────────────────────────────────────────

  private async newSession(): Promise<void> {
    const roomName = this.getRoomName() ?? '';
    const claseId  = this.getCourseId();
    const name = new Date().toISOString().slice(0, 10) + '-sesión';
    try {
      const resp = await fetch('/api/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, name, claseId }),
      });
      if (resp.ok) {
        const { session } = await resp.json();
        this.sessionId = session.id;
        this.sessionName = session.name;
        this.updateSessionBar();
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
    this.updateSessionBar();
  }

  // ── Session context menu ──────────────────────────────────────────────────────

  private openSessionCtx(e: MouseEvent): void {
    this.sessionCtxEl.removeAttribute('hidden');
    this.sessionCtxEl.style.left = `${e.clientX}px`;
    this.sessionCtxEl.style.top  = `${e.clientY}px`;
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
      this.sessionsListEl.innerHTML = '';
      for (const s of sessions) {
        const item = document.createElement('div');
        item.className = 're-session-item' + (s.id === this.sessionId ? ' re-session-item--active' : '');
        const date = new Date(s.createdAt).toLocaleDateString('es', { month: 'short', day: 'numeric' });
        item.innerHTML = `<span class="re-session-item-name">${s.name}</span><span class="re-session-item-date">${date}</span>`;
        item.addEventListener('click', () => {
          this.sessionId = s.id;
          this.sessionName = s.name;
          this.sessionsModalEl.setAttribute('hidden', '');
          this.updateSessionBar();
        });
        this.sessionsListEl.appendChild(item);
      }
    } catch {
      this.sessionsListEl.innerHTML = '<div style="padding:6px 10px;font-size:10px;color:#e06666">error</div>';
    }
  }

  // ── Enviar a SA ───────────────────────────────────────────────────────────────

  private sendCtxItemToSa(): void {
    const item = this.ctxTargetItem;
    this.closeCtxMenu();
    if (!item) return;
    window.dispatchEvent(new CustomEvent('musiki:sa:load-url', {
      detail: { url: item.url, name: item.name },
    }));
  }

  // ── Upload ───────────────────────────────────────────────────────────────────

  private async uploadFile(file: File) {
    if (!this.canEdit()) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const resp = await fetch('/api/room/re-store', { method: 'POST', body: form });
      if (!resp.ok) { console.error('[Re] upload failed', resp.status); return; }
      const { url } = await resp.json();
      const newItem: ResourceItem = {
        id: crypto.randomUUID(), url, name: nameFromFile(file),
        type: typeFromUrl(url), folder: '', source: 'upload',
        createdBy: this.getIdentity(), sortOrder: this.items.length, createdAt: new Date().toISOString(),
      };
      this.items = addItem(this.items, newItem);
      this.render(); this.scheduleAutosave(); this.broadcastSync();
      void resolveNameFromUrl(url).then(name => {
        this.items = this.items.map(i => i.id === newItem.id ? { ...i, name } : i);
        this.render(); this.scheduleAutosave();
      });
    } catch (e) { console.error('[Re] upload error', e); }
  }

  private async pasteClipboard() {
    if (!this.canEdit()) return;
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!/^https?:\/\//i.test(text)) return;
      const item: ResourceItem = {
        id: crypto.randomUUID(), url: text, name: quickNameFromUrl(text),
        type: typeFromUrl(text), folder: '', source: 'paste',
        createdBy: this.getIdentity(), sortOrder: this.items.length, createdAt: new Date().toISOString(),
      };
      this.items = addItem(this.items, item);
      this.render(); this.scheduleAutosave(); this.broadcastSync();
      void resolveNameFromUrl(text).then(name => {
        this.items = this.items.map(i => i.id === item.id ? { ...i, name } : i);
        this.render(); this.scheduleAutosave();
      });
    } catch { /**/ }
  }

  // ── Sync ─────────────────────────────────────────────────────────────────────

  private broadcastSync() {
    this.publish({ type: 'recursos:sync', items: this.items, allowStudents: this.allowStudents });
  }

  applyRemoteMessage(msg: RecursosMessage) {
    if (msg.type === 'recursos:sync') {
      this.items = msg.items; this.allowStudents = msg.allowStudents;
      this.updateCollabBtn(); this.render();
    } else if (msg.type === 'recursos:allow-students') {
      this.allowStudents = msg.allow; this.updateCollabBtn();
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  private scheduleAutosave() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => void this.save(), 5000);
  }

  private async save() {
    const roomName = this.getRoomName() ?? '';
    if (!roomName) return;
    try {
      await fetch('/api/live/recursos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // claseId must be string | null — never send undefined
        body: JSON.stringify({ roomName, claseId: this.getCourseId() ?? null, items: this.items }),
      });
    } catch { /**/ }
  }

  private flushSave() {
    const roomName = this.getRoomName() ?? '';
    if (!roomName) return;
    navigator.sendBeacon('/api/live/recursos',
      new Blob([JSON.stringify({ roomName, claseId: this.getCourseId() ?? null, items: this.items })],
        { type: 'application/json' }));
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  private render() {
    renderFiletree(this.contentEl, this.items, this.collapsedFolders, this.emptyFolders, {
      headerEl: this.buildHeaderEl(),
      canEdit: this.canEdit(),
      onItemClick: (item) => window.open(item.url, '_blank', 'noopener'),
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
        }
      },
    });
  }

  // ── Folders ───────────────────────────────────────────────────────────────────

  private toggleFolder(folder: string) {
    if (this.collapsedFolders.has(folder)) this.collapsedFolders.delete(folder);
    else this.collapsedFolders.add(folder);
    localStorage.setItem(`re:collapsed:${this.getCourseId() ?? '_'}`, JSON.stringify([...this.collapsedFolders]));
    this.render();
  }

  private toggleFoldAll() {
    const folders = foldersFromItems(this.items);
    const allCollapsed = folders.every(f => this.collapsedFolders.has(f));
    if (allCollapsed) this.collapsedFolders.clear();
    else folders.forEach(f => this.collapsedFolders.add(f));
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
      if (name) { this.emptyFolders.add(name); this.render(); }
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

  // ── Context menu ──────────────────────────────────────────────────────────────

  private openItemCtxMenu(item: ResourceItem, e: MouseEvent) {
    if (!this.canEdit()) return;
    this.ctxTargetItem = item; this.ctxTargetFolder = null;
    this.ctxMoveBtn.style.display = '';
    const canSendToSa = item.folder === 'media' || item.type === 'audio';
    this.ctxSendToSaBtn.hidden = !canSendToSa;
    this.ctxMenuEl.removeAttribute('hidden');
    this.ctxMenuEl.style.left = `${e.clientX}px`;
    this.ctxMenuEl.style.top  = `${e.clientY}px`;
  }

  private openFolderCtxMenu(folder: string, e: MouseEvent) {
    if (!this.canEdit() || folder === 'compartidos' || folder === 'media') return;
    this.ctxTargetFolder = folder; this.ctxTargetItem = null;
    this.ctxMoveBtn.style.display = 'none';
    this.ctxMenuEl.removeAttribute('hidden');
    this.ctxMenuEl.style.left = `${e.clientX}px`;
    this.ctxMenuEl.style.top  = `${e.clientY}px`;
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

  private deleteCtxTarget() {
    const item = this.ctxTargetItem; const folder = this.ctxTargetFolder;
    this.closeCtxMenu();
    if (item) this.items = removeItem(this.items, item.id);
    else if (folder) { this.items = this.items.map(i => i.folder === folder ? { ...i, folder: '' } : i); this.emptyFolders.delete(folder); }
    this.render(); this.scheduleAutosave(); this.broadcastSync();
  }

  private showMoveSubmenu() {
    const item = this.ctxTargetItem; this.closeCtxMenu();
    if (!item) return;
    const folders = foldersFromItems(this.items).filter(f => f !== item.folder);
    const target = prompt(`Mover a carpeta:\n${['(raíz)', ...folders].join('\n')}`);
    if (target === null) return;
    this.items = moveItem(this.items, item.id, target === '(raíz)' ? '' : target.trim());
    this.render(); this.scheduleAutosave(); this.broadcastSync();
  }

  // ── Collab ────────────────────────────────────────────────────────────────────

  private toggleAllowStudents() {
    if (!this.isTeacher) return;
    this.allowStudents = !this.allowStudents;
    this.updateCollabBtn(); this.broadcastSync();
  }

  private updateCollabBtn() {
    this.collabBtn.dataset.active = String(this.allowStudents);
    this.collabBtn.title = this.allowStudents
      ? 'Alumnos pueden agregar recursos (activo)'
      : 'Alumnos pueden agregar recursos (desactivado)';
    if (!this.isTeacher) this.bottombarEl.hidden = !this.allowStudents;
  }

  dispose() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
  }
}
