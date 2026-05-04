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
  getRoomName: () => string | null;
  getIdentity: () => string;
  publish: (msg: RecursosMessage) => void;
};

type RecursosMessage =
  | { type: 'recursos:sync'; items: ResourceItem[]; allowStudents: boolean }
  | { type: 'recursos:allow-students'; allow: boolean };

type RenameMode =
  | { kind: 'item';       target: ResourceItem }
  | { kind: 'folder';     target: string }
  | { kind: 'header' }
  | { kind: 'new-folder' };

export class RecursosController {
  private container: HTMLElement;
  private isTeacher: boolean;
  private getCourseId: () => string | null;
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

  // Rename state — separate from ctx menu targets so closeCtxMenu doesn't clobber them
  private renameMode: RenameMode | null = null;

  // Ctx menu targets (only live while menu is open)
  private ctxTargetItem: ResourceItem | null = null;
  private ctxTargetFolder: string | null = null;

  // Header label (defaults to claseId path, overridable per course)
  private headerLabel = '';

  private contentEl!: HTMLElement;
  private dropOverlayEl!: HTMLElement;
  private ctxMenuEl!: HTMLElement;
  private ctxRenameBtn!: HTMLButtonElement;
  private ctxMoveBtn!: HTMLButtonElement;
  private ctxDeleteBtn!: HTMLButtonElement;
  private renameBarEl!: HTMLElement;
  private renameInputEl!: HTMLInputElement;
  private collabBtn!: HTMLButtonElement;
  private foldBtn!: HTMLButtonElement;
  private newFolderBtn!: HTMLButtonElement;
  private pasteBtn!: HTMLButtonElement;
  private guardarlBtn!: HTMLButtonElement;
  private bottombarEl!: HTMLElement;

  constructor(opts: RecursosOptions) {
    this.container = opts.container;
    this.isTeacher = opts.isTeacher;
    this.getCourseId = opts.getCourseId;
    this.getRoomName = opts.getRoomName;
    this.getIdentity = opts.getIdentity;
    this.publish = opts.publish;
    this.bindElements();
    this.bindEvents();
    void this.bootstrap();
  }

  private bindElements() {
    const q = <T extends HTMLElement>(sel: string) =>
      this.container.querySelector<T>(sel)!;

    this.contentEl      = q('[data-re-content]');
    this.dropOverlayEl  = q('[data-re-drop-overlay]');
    this.ctxMenuEl      = q('[data-re-ctx-menu]');
    this.ctxRenameBtn   = q('[data-re-ctx-rename]');
    this.ctxMoveBtn     = q('[data-re-ctx-move]');
    this.ctxDeleteBtn   = q('[data-re-ctx-delete]');
    this.renameBarEl    = q('[data-re-rename-bar]');
    this.renameInputEl  = q('[data-re-rename-input]');
    this.collabBtn      = q('[data-re-collab]');
    this.foldBtn        = q('[data-re-fold]');
    this.newFolderBtn   = q('[data-re-new-folder]');
    this.pasteBtn       = q('[data-re-paste]');
    this.guardarlBtn    = q('[data-re-guardar]');
    this.bottombarEl    = q('[data-re-bottombar]');

    // Students: only the tree (no bottom bar)
    if (!this.isTeacher) this.bottombarEl.hidden = true;
    // Teacher-only collab toggle
    if (this.isTeacher) this.collabBtn.style.display = '';
  }

  private async bootstrap() {
    const roomName = this.getRoomName() ?? '';
    const claseId  = this.getCourseId();
    if (!roomName) return;

    // Restore custom header label
    this.headerLabel = localStorage.getItem(`re:header:${claseId ?? '_'}`) ?? '';

    // Restore collapsed state
    try {
      const raw = localStorage.getItem(`re:collapsed:${claseId ?? '_'}`);
      if (raw) JSON.parse(raw).forEach((f: string) => this.collapsedFolders.add(f));
    } catch { /* ignore */ }

    try {
      const params = new URLSearchParams({ roomName });
      params.set('claseId', claseId ?? '');
      const resp = await fetch(`/api/live/recursos?${params}`);
      if (!resp.ok) return;
      const data = await resp.json();
      this.items = Array.isArray(data.items) ? data.items : [];
    } catch { /* network error — start empty */ }

    try {
      const resp = await fetch(`/api/live/recursos/compartidos-history?roomName=${encodeURIComponent(roomName)}`);
      if (resp.ok) {
        const data = await resp.json();
        for (const item of (data.items ?? [])) {
          this.items = addItem(this.items, item);
        }
      }
    } catch { /* non-fatal */ }

    this.render();
  }

  private bindEvents() {
    window.addEventListener('musiki:recursos:receive', (e: Event) => {
      const ev = e as CustomEvent<RecursosMessage>;
      this.applyRemoteMessage(ev.detail);
    });

    window.addEventListener('musiki:clase-presentation-changed', (e: Event) => {
      const ev = e as CustomEvent<{ lessonId: string | null }>;
      if (!this.headerLabel) {
        // Only update header display when no custom label is set
        const claseId = ev.detail?.lessonId ?? null;
        const display = claseId
          ? claseId.split('/').slice(-2).join(' / ')
          : '';
        this.updateHeaderEl(display);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushSave();
    });
    window.addEventListener('beforeunload', () => this.flushSave());

    window.addEventListener('musiki:recursos:sa-uploaded', (e: Event) => {
      const ev = e as CustomEvent<{ url: string; name: string }>;
      this.addCompartido(ev.detail.url, ev.detail.name, 'sa');
    });

    window.addEventListener('musiki:recursos:chat-url', (e: Event) => {
      const ev = e as CustomEvent<{ url: string }>;
      this.addCompartido(ev.detail.url, quickNameFromUrl(ev.detail.url), 'chat');
      void resolveNameFromUrl(ev.detail.url).then(name => {
        this.items = this.items.map(i => i.url === ev.detail.url ? { ...i, name } : i);
        this.render();
        this.scheduleAutosave();
      });
    });

    window.addEventListener('musiki:recursos:external-media', (e: Event) => {
      const ev = e as CustomEvent<{ url: string; name: string }>;
      this.addCompartido(ev.detail.url, ev.detail.name || quickNameFromUrl(ev.detail.url), 'external-media');
    });

    // Bottom bar
    this.foldBtn.addEventListener('click', () => this.toggleFoldAll());
    this.newFolderBtn.addEventListener('click', () => this.startNewFolder());
    this.pasteBtn.addEventListener('click', () => void this.pasteClipboard());
    this.guardarlBtn.addEventListener('click', () => void this.doGuardar());
    this.collabBtn.addEventListener('click', () => this.toggleAllowStudents());

    // Rename bar
    this.renameInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.confirmRename();
      if (e.key === 'Escape') this.closeRename();
    });
    this.container.querySelector('[data-re-rename-ok]')!
      .addEventListener('click', () => this.confirmRename());
    this.container.querySelector('[data-re-rename-cancel]')!
      .addEventListener('click', () => this.closeRename());

    // Context menu
    this.ctxRenameBtn.addEventListener('click', () => this.startRename());
    this.ctxDeleteBtn.addEventListener('click', () => this.deleteCtxTarget());
    this.ctxMoveBtn.addEventListener('click', () => this.showMoveSubmenu());

    document.addEventListener('click', (e) => {
      if (!this.ctxMenuEl.contains(e.target as Node)) this.closeCtxMenu();
    });

    // Drag & drop files into the pod
    this.container.addEventListener('dragenter', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        this.dropOverlayEl.dataset.active = 'true';
      }
    });
    this.container.addEventListener('dragleave', (e) => {
      if (!this.container.contains(e.relatedTarget as Node)) {
        this.dropOverlayEl.dataset.active = 'false';
      }
    });
    this.container.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    this.container.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropOverlayEl.dataset.active = 'false';
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const file of files) void this.uploadFile(file);
    });

    // Long-press on mobile
    this.contentEl.addEventListener('touchstart', (e) => {
      const el = (e.target as Element).closest('[data-item-id]');
      if (!el) return;
      this.longPressTimer = setTimeout(() => {
        const id = (el as HTMLElement).dataset.itemId!;
        const item = this.items.find(i => i.id === id);
        if (item) this.openItemCtxMenu(item, { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY } as MouseEvent);
      }, 500);
    }, { passive: true });
    this.contentEl.addEventListener('touchend', () => {
      if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
    }, { passive: true });
  }

  private canEdit(): boolean {
    return this.isTeacher || this.allowStudents;
  }

  // ── Header ─────────────────────────────────────────────────────────────────

  private updateHeaderEl(text: string) {
    const el = this.contentEl.querySelector<HTMLElement>('.re-header');
    if (el) el.textContent = this.headerLabel || text || 'Re';
  }

  private buildHeaderEl(): HTMLElement {
    const claseId = this.getCourseId();
    const defaultLabel = claseId ? claseId.split('/').slice(-2).join(' / ') : '';
    const el = document.createElement('div');
    el.className = 're-header';
    el.textContent = this.headerLabel || defaultLabel || 'Re';
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.startHeaderRename();
    });
    return el;
  }

  private startHeaderRename() {
    const claseId = this.getCourseId();
    const defaultLabel = claseId ? claseId.split('/').slice(-2).join(' / ') : '';
    this.renameMode = { kind: 'header' };
    this.renameBarEl.removeAttribute('hidden');
    this.renameInputEl.value = this.headerLabel || defaultLabel;
    this.renameInputEl.focus();
    this.renameInputEl.select();
  }

  // ── Compartidos ─────────────────────────────────────────────────────────────

  private addCompartido(url: string, name: string, source: ResourceItem['source']) {
    if (!url) return;
    const newItem: ResourceItem = {
      id: crypto.randomUUID(),
      url,
      name,
      type: typeFromUrl(url),
      folder: 'compartidos',
      source,
      createdBy: this.getIdentity(),
      sortOrder: Date.now(),
      createdAt: new Date().toISOString(),
    };
    this.items = addItem(this.items, newItem);
    this.render();
    this.scheduleAutosave();
    this.broadcastSync();
  }

  // ── Upload ──────────────────────────────────────────────────────────────────

  private async uploadFile(file: File) {
    if (!this.canEdit()) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const resp = await fetch('/api/room/recursos-upload', { method: 'POST', body: form });
      if (!resp.ok) { console.error('[Re] upload failed', resp.status); return; }
      const data = await resp.json();
      const name = nameFromFile(file);
      const newItem: ResourceItem = {
        id: crypto.randomUUID(),
        url: data.url,
        name,
        type: typeFromUrl(data.url),
        folder: '',
        source: 'upload',
        createdBy: this.getIdentity(),
        sortOrder: Date.now(),
        createdAt: new Date().toISOString(),
      };
      this.items = addItem(this.items, newItem);
      this.render();
      this.scheduleAutosave();
      this.broadcastSync();
      void resolveNameFromUrl(data.url).then(resolved => {
        this.items = this.items.map(i => i.id === newItem.id ? { ...i, name: resolved } : i);
        this.render();
        this.scheduleAutosave();
      });
    } catch (e) { console.error('[Re] upload error', e); }
  }

  // ── Paste clipboard ─────────────────────────────────────────────────────────

  private async pasteClipboard() {
    if (!this.canEdit()) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      if (/^https?:\/\//i.test(text.trim())) {
        const url = text.trim();
        const name = quickNameFromUrl(url);
        const item: ResourceItem = {
          id: crypto.randomUUID(),
          url,
          name,
          type: typeFromUrl(url),
          folder: '',
          source: 'paste',
          createdBy: this.getIdentity(),
          sortOrder: Date.now(),
          createdAt: new Date().toISOString(),
        };
        this.items = addItem(this.items, item);
        this.render();
        this.scheduleAutosave();
        this.broadcastSync();
        void resolveNameFromUrl(url).then(resolved => {
          this.items = this.items.map(i => i.id === item.id ? { ...i, name: resolved } : i);
          this.render();
          this.scheduleAutosave();
        });
      }
    } catch { /* clipboard read denied */ }
  }

  // ── Sync ────────────────────────────────────────────────────────────────────

  private broadcastSync() {
    this.publish({ type: 'recursos:sync', items: this.items, allowStudents: this.allowStudents });
  }

  applyRemoteMessage(msg: RecursosMessage) {
    if (msg.type === 'recursos:sync') {
      this.items = msg.items;
      this.allowStudents = msg.allowStudents;
      this.updateCollabBtn();
      this.render();
    } else if (msg.type === 'recursos:allow-students') {
      this.allowStudents = msg.allow;
      this.updateCollabBtn();
    }
  }

  // ── Autosave ────────────────────────────────────────────────────────────────

  private scheduleAutosave() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => void this.save(), 5000);
  }

  private async save() {
    const roomName = this.getRoomName() ?? '';
    if (!roomName) return;
    const claseId = this.getCourseId();
    try {
      await fetch('/api/live/recursos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, claseId, items: this.items }),
      });
    } catch { /* non-fatal */ }
  }

  private flushSave() {
    const roomName = this.getRoomName() ?? '';
    if (!roomName) return;
    const payload = JSON.stringify({ roomName, claseId: this.getCourseId(), items: this.items });
    navigator.sendBeacon('/api/live/recursos', new Blob([payload], { type: 'application/json' }));
  }

  // ── Guardar (save + export) ─────────────────────────────────────────────────

  private async doGuardar() {
    void this.save();
    const claseId = this.getCourseId();
    const filename = this.computeExportFilename();
    const md = this.buildMarkdown(filename, claseId);
    const courseId = claseId?.split('/')?.[0] ?? '';
    const targetPath = claseId
      ? `${claseId}/${filename}`
      : `public/recursos/${filename}`;
    try {
      const resp = await fetch('/api/content-admin/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, targetPath, content: md, mode: 'create', editSummary: 'Re pod guardar' }),
      });
      if (!resp.ok) console.error('[Re] guardar failed', resp.status);
    } catch (e) { console.error('[Re] guardar error', e); }
  }

  private computeExportFilename(): string {
    const claseId = this.getCourseId();
    if (claseId) {
      const slug = claseId.split('/').pop() ?? 'clase';
      return `recursos-${slug}.md`;
    }
    const date = new Date().toISOString().slice(0, 10);
    return `recursos-${date}.md`;
  }

  private buildMarkdown(filename: string, claseId: string | null): string {
    const title = filename.replace(/\.md$/, '').replace(/-/g, ' ');
    const folders = ['compartidos', ...foldersFromItems(this.items).filter(f => f !== 'compartidos')];
    const rootItems = itemsInFolder(this.items, '');

    const treeLines: string[] = ['recursos/'];
    const folderLines = folders.filter(f => itemsInFolder(this.items, f).length > 0);
    folderLines.forEach((folder, fi) => {
      const items = itemsInFolder(this.items, folder);
      const isLast = fi === folderLines.length - 1 && rootItems.length === 0;
      treeLines.push(`${isLast ? '└──' : '├──'} ${folder}/`);
      items.forEach((item, ii) => {
        const isLastItem = ii === items.length - 1;
        treeLines.push(`${isLast ? '    ' : '│   '}${isLastItem ? '└──' : '├──'} [${item.type}] ${item.name}`);
      });
    });
    rootItems.forEach((item, ii) => {
      treeLines.push(`${ii === rootItems.length - 1 ? '└──' : '├──'} ${item.name}`);
    });

    let md = `---\ntitle: Recursos — ${title}\n${claseId ? `claseId: ${claseId}\n` : ''}updatedAt: ${new Date().toISOString()}\n---\n\n## Recursos — ${title}\n\n\`\`\`\n${treeLines.join('\n')}\n\`\`\`\n`;

    for (const folder of folderLines) {
      const items = itemsInFolder(this.items, folder);
      md += `\n## ${folder}\n\n`;
      for (const item of items) {
        md += `- [${item.name}](${item.url}) — *${item.source}*\n`;
      }
    }
    if (rootItems.length > 0) {
      md += `\n## raíz\n\n`;
      for (const item of rootItems) {
        md += `- [${item.name}](${item.url}) — *${item.source}*\n`;
      }
    }
    return md;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

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
        this.contentEl.querySelectorAll('[data-folder]').forEach(el => {
          (el.querySelector('.re-folder-row') as HTMLElement)?.removeAttribute('data-drag-over');
        });
        const folderRow = this.contentEl.querySelector<HTMLElement>(`[data-folder="${folder}"] .re-folder-row`);
        if (folderRow) folderRow.dataset.dragOver = 'true';
      },
      onDrop: (targetFolder) => {
        if (this.draggedItemId) {
          this.items = moveItem(this.items, this.draggedItemId, targetFolder);
          this.draggedItemId = null;
          this.render();
          this.scheduleAutosave();
          this.broadcastSync();
        }
      },
    });
  }

  // ── Folder management ───────────────────────────────────────────────────────

  private toggleFolder(folder: string) {
    if (this.collapsedFolders.has(folder)) this.collapsedFolders.delete(folder);
    else this.collapsedFolders.add(folder);
    this.persistCollapsedState();
    this.render();
  }

  private persistCollapsedState() {
    const key = `re:collapsed:${this.getCourseId() ?? '_'}`;
    localStorage.setItem(key, JSON.stringify([...this.collapsedFolders]));
  }

  private toggleFoldAll() {
    const folders = foldersFromItems(this.items);
    const allCollapsed = folders.every(f => this.collapsedFolders.has(f));
    if (allCollapsed) this.collapsedFolders.clear();
    else folders.forEach(f => this.collapsedFolders.add(f));
    this.persistCollapsedState();
    this.render();
  }

  // Opens the rename bar in "new-folder" mode instead of using prompt()
  private startNewFolder() {
    if (!this.canEdit()) return;
    this.renameMode = { kind: 'new-folder' };
    this.renameBarEl.removeAttribute('hidden');
    this.renameInputEl.value = '';
    this.renameInputEl.placeholder = 'nombre de carpeta';
    this.renameInputEl.focus();
  }

  // ── Context menu ────────────────────────────────────────────────────────────

  private openItemCtxMenu(item: ResourceItem, e: MouseEvent) {
    if (!this.canEdit()) return;
    this.ctxTargetItem = item;
    this.ctxTargetFolder = null;
    this.ctxMoveBtn.style.display = '';
    this.positionCtxMenu(e);
  }

  private openFolderCtxMenu(folder: string, e: MouseEvent) {
    if (!this.canEdit()) return;
    if (folder === 'compartidos') return;
    this.ctxTargetFolder = folder;
    this.ctxTargetItem = null;
    this.ctxMoveBtn.style.display = 'none';
    this.positionCtxMenu(e);
  }

  private positionCtxMenu(e: MouseEvent) {
    this.ctxMenuEl.removeAttribute('hidden');
    this.ctxMenuEl.style.left = `${e.clientX}px`;
    this.ctxMenuEl.style.top  = `${e.clientY}px`;
  }

  private closeCtxMenu() {
    this.ctxMenuEl.setAttribute('hidden', '');
    this.ctxTargetItem = null;
    this.ctxTargetFolder = null;
  }

  // ── Rename (shared bar) ─────────────────────────────────────────────────────

  private startRename() {
    // Capture targets BEFORE closeCtxMenu clears them
    const item   = this.ctxTargetItem;
    const folder = this.ctxTargetFolder;
    this.closeCtxMenu();

    const current = item?.name ?? folder ?? '';
    this.renameMode = item
      ? { kind: 'item',   target: item }
      : { kind: 'folder', target: folder! };

    this.renameBarEl.removeAttribute('hidden');
    this.renameInputEl.placeholder = '';
    this.renameInputEl.value = current;
    this.renameInputEl.focus();
    this.renameInputEl.select();
  }

  private confirmRename() {
    const newName = this.renameInputEl.value.trim();
    if (!newName) { this.closeRename(); return; }

    const mode = this.renameMode;
    this.closeRename();

    if (!mode) return;

    if (mode.kind === 'item') {
      const id = mode.target.id;
      this.items = this.items.map(i => i.id === id ? { ...i, name: newName } : i);
      this.render();
      this.scheduleAutosave();
      this.broadcastSync();
    } else if (mode.kind === 'folder') {
      const old = mode.target;
      this.items = this.items.map(i => i.folder === old ? { ...i, folder: newName } : i);
      if (this.emptyFolders.has(old)) {
        this.emptyFolders.delete(old);
        this.emptyFolders.add(newName);
      }
      this.render();
      this.scheduleAutosave();
      this.broadcastSync();
    } else if (mode.kind === 'header') {
      this.headerLabel = newName;
      localStorage.setItem(`re:header:${this.getCourseId() ?? '_'}`, newName);
      this.render();
    } else if (mode.kind === 'new-folder') {
      this.emptyFolders.add(newName);
      this.render();
    }
  }

  private closeRename() {
    this.renameBarEl.setAttribute('hidden', '');
    this.renameInputEl.placeholder = '';
    this.renameMode = null;
  }

  // ── Delete / move ────────────────────────────────────────────────────────────

  private deleteCtxTarget() {
    const item   = this.ctxTargetItem;
    const folder = this.ctxTargetFolder;
    this.closeCtxMenu();
    if (item) {
      this.items = removeItem(this.items, item.id);
    } else if (folder) {
      this.items = this.items.map(i => i.folder === folder ? { ...i, folder: '' } : i);
      this.emptyFolders.delete(folder);
    }
    this.render();
    this.scheduleAutosave();
    this.broadcastSync();
  }

  private showMoveSubmenu() {
    const item = this.ctxTargetItem;
    this.closeCtxMenu();
    if (!item) return;
    const folders = foldersFromItems(this.items).filter(f => f !== item.folder);
    const target = prompt(`Mover a carpeta:\n${['(raíz)', ...folders].join('\n')}`);
    if (target === null) return;
    const folder = target === '(raíz)' ? '' : target.trim();
    this.items = moveItem(this.items, item.id, folder);
    this.render();
    this.scheduleAutosave();
    this.broadcastSync();
  }

  // ── Collab toggle ───────────────────────────────────────────────────────────

  private toggleAllowStudents() {
    if (!this.isTeacher) return;
    this.allowStudents = !this.allowStudents;
    this.updateCollabBtn();
    this.broadcastSync();
  }

  private updateCollabBtn() {
    this.collabBtn.dataset.active = String(this.allowStudents);
    this.collabBtn.title = this.allowStudents
      ? 'Alumnos pueden agregar recursos (activo)'
      : 'Alumnos pueden agregar recursos (desactivado)';
    // Students gain/lose the bottom bar when teacher toggles allowStudents
    if (!this.isTeacher) {
      this.bottombarEl.hidden = !this.allowStudents;
    }
  }

  // ── Dispose ──────────────────────────────────────────────────────────────────

  dispose() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
  }
}
