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
  private draggedItemId: string | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private ctxTargetItem: ResourceItem | null = null;
  private ctxTargetFolder: string | null = null;

  private contentEl!: HTMLElement;
  private claseNameEl!: HTMLElement;
  private dropOverlayEl!: HTMLElement;
  private ctxMenuEl!: HTMLElement;
  private ctxRenameBtn!: HTMLButtonElement;
  private ctxMoveBtn!: HTMLButtonElement;
  private ctxDeleteBtn!: HTMLButtonElement;
  private renameBarEl!: HTMLElement;
  private renameInputEl!: HTMLInputElement;
  private exportPopoverEl!: HTMLElement;
  private exportInputEl!: HTMLInputElement;
  private collabBtn!: HTMLButtonElement;
  private foldBtn!: HTMLButtonElement;
  private newFolderBtn!: HTMLButtonElement;
  private pasteBtn!: HTMLButtonElement;
  private exportBtn!: HTMLButtonElement;

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
    this.claseNameEl    = q('[data-re-clase-name]');
    this.dropOverlayEl  = q('[data-re-drop-overlay]');
    this.ctxMenuEl      = q('[data-re-ctx-menu]');
    this.ctxRenameBtn   = q('[data-re-ctx-rename]');
    this.ctxMoveBtn     = q('[data-re-ctx-move]');
    this.ctxDeleteBtn   = q('[data-re-ctx-delete]');
    this.renameBarEl    = q('[data-re-rename-bar]');
    this.renameInputEl  = q('[data-re-rename-input]');
    this.exportPopoverEl = q('[data-re-export-popover]');
    this.exportInputEl  = q('[data-re-export-input]');
    this.collabBtn      = q('[data-re-collab]');
    this.foldBtn        = q('[data-re-fold]');
    this.newFolderBtn   = q('[data-re-new-folder]');
    this.pasteBtn       = q('[data-re-paste]');
    this.exportBtn      = q('[data-re-export]');

    if (this.isTeacher) this.collabBtn.style.display = '';
  }

  private async bootstrap() {
    const roomName = this.getRoomName() ?? '';
    const claseId  = this.getCourseId();
    if (!roomName) return;

    try {
      const params = new URLSearchParams({ roomName });
      if (claseId) params.set('claseId', claseId);
      else params.set('claseId', '');

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
      const name = ev.detail?.lessonId?.split('/').slice(-2).join(' / ') ?? '';
      this.claseNameEl.textContent = name;
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

    this.foldBtn.addEventListener('click', () => this.toggleFoldAll());
    this.newFolderBtn.addEventListener('click', () => this.createFolder());
    this.pasteBtn.addEventListener('click', () => void this.pasteClipboard());
    this.exportBtn.addEventListener('click', () => this.toggleExportPopover());
    this.collabBtn.addEventListener('click', () => this.toggleAllowStudents());

    this.exportInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.doExport();
      if (e.key === 'Escape') this.closeExportPopover();
    });
    this.container.querySelector('[data-re-export-ok]')!.addEventListener('click', () => void this.doExport());
    this.container.querySelector('[data-re-export-cancel]')!.addEventListener('click', () => this.closeExportPopover());

    this.ctxRenameBtn.addEventListener('click', () => this.startRename());
    this.ctxDeleteBtn.addEventListener('click', () => this.deleteCtxTarget());
    this.ctxMoveBtn.addEventListener('click', () => this.showMoveSubmenu());

    this.renameInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.confirmRename();
      if (e.key === 'Escape') this.closeRename();
    });
    this.container.querySelector('[data-re-rename-ok]')!.addEventListener('click', () => this.confirmRename());
    this.container.querySelector('[data-re-rename-cancel]')!.addEventListener('click', () => this.closeRename());

    document.addEventListener('click', (e) => {
      if (!this.ctxMenuEl.contains(e.target as Node)) this.closeCtxMenu();
    });

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

  private async doExport() {
    const filename = this.exportInputEl.value.trim() || this.defaultExportFilename();
    const claseId = this.getCourseId();
    const md = this.buildMarkdown(filename, claseId);
    const courseId = claseId?.split('/')?.[0] ?? '';
    const targetPath = claseId
      ? `${claseId}/${filename}`
      : `public/recursos/${filename}`;
    try {
      const resp = await fetch('/api/content-admin/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, targetPath, content: md, mode: 'create', editSummary: 'Re pod export' }),
      });
      if (!resp.ok) console.error('[Re] export failed', resp.status);
    } catch (e) { console.error('[Re] export error', e); }
    this.closeExportPopover();
  }

  private defaultExportFilename(): string {
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

  private render() {
    renderFiletree(this.contentEl, this.items, this.collapsedFolders, {
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

  private createFolder() {
    if (!this.canEdit()) return;
    const name = prompt('Nombre de la carpeta:')?.trim();
    if (!name) return;
    (this as any)._pendingFolders ??= new Set();
    (this as any)._pendingFolders.add(name);
    this.render();
  }

  private openItemCtxMenu(item: ResourceItem, e: MouseEvent) {
    this.ctxTargetItem = item;
    this.ctxTargetFolder = null;
    this.ctxMoveBtn.style.display = '';
    this.positionCtxMenu(e);
  }

  private openFolderCtxMenu(folder: string, e: MouseEvent) {
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

  private startRename() {
    const current = this.ctxTargetItem?.name ?? this.ctxTargetFolder ?? '';
    this.closeCtxMenu();
    this.renameBarEl.removeAttribute('hidden');
    this.renameInputEl.value = current;
    this.renameInputEl.focus();
    this.renameInputEl.select();
  }

  private confirmRename() {
    const newName = this.renameInputEl.value.trim();
    if (!newName) { this.closeRename(); return; }
    if (this.ctxTargetItem) {
      const id = this.ctxTargetItem.id;
      this.items = this.items.map(i => i.id === id ? { ...i, name: newName } : i);
    } else if (this.ctxTargetFolder) {
      const old = this.ctxTargetFolder;
      this.items = this.items.map(i => i.folder === old ? { ...i, folder: newName } : i);
    }
    this.closeRename();
    this.render();
    this.scheduleAutosave();
    this.broadcastSync();
  }

  private closeRename() {
    this.renameBarEl.setAttribute('hidden', '');
    this.ctxTargetItem = null;
    this.ctxTargetFolder = null;
  }

  private deleteCtxTarget() {
    this.closeCtxMenu();
    if (this.ctxTargetItem) {
      this.items = removeItem(this.items, this.ctxTargetItem.id);
    } else if (this.ctxTargetFolder) {
      const folder = this.ctxTargetFolder;
      this.items = this.items.map(i => i.folder === folder ? { ...i, folder: '' } : i);
    }
    this.render();
    this.scheduleAutosave();
    this.broadcastSync();
  }

  private showMoveSubmenu() {
    const folders = foldersFromItems(this.items).filter(f => f !== this.ctxTargetItem?.folder);
    const target = prompt(`Mover a carpeta:\n${['(raíz)', ...folders].join('\n')}`);
    if (target === null) return;
    const folder = target === '(raíz)' ? '' : target.trim();
    if (this.ctxTargetItem) {
      this.items = moveItem(this.items, this.ctxTargetItem.id, folder);
      this.render();
      this.scheduleAutosave();
      this.broadcastSync();
    }
    this.closeCtxMenu();
  }

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
  }

  private toggleExportPopover() {
    const hidden = this.exportPopoverEl.hasAttribute('hidden');
    if (hidden) {
      this.exportInputEl.value = this.defaultExportFilename();
      this.exportPopoverEl.removeAttribute('hidden');
      this.exportInputEl.focus();
      this.exportInputEl.select();
    } else {
      this.closeExportPopover();
    }
  }

  private closeExportPopover() {
    this.exportPopoverEl.setAttribute('hidden', '');
  }

  dispose() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
  }
}
