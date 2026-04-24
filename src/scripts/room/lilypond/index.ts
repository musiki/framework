import type { MarkdownCodeMirrorBinding, RemoteCursorState } from '../../markdown-codemirror.ts';
import { enhanceMarkdownTextarea } from '../../markdown-editor-tools';
import type { ConferenceMessage } from '../session/messages.ts';

type MarkdownPreviewWindow = Window & {
  __roomLilyMarkedPromise?: Promise<{ parse?: (markdown: string) => string } | null>;
  __roomLilyMermaidPromise?: Promise<{
    initialize?: (options: Record<string, unknown>) => void;
    run?: (options: { nodes: HTMLElement[] }) => void;
  } | null>;
  hydrateLilypondBlocks?: (node?: ParentNode) => void;
  marked?: { parse?: (markdown: string) => string };
  mermaid?: {
    initialize?: (options: Record<string, unknown>) => void;
    run?: (options: { nodes: HTMLElement[] }) => void;
  };
};

type LilyRenderResult = {
  midiUrl: string;
  url: string;
};

const escapeHtml = (value: string) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

type LilyTransportMessage = Extract<
  ConferenceMessage,
  { type: 'lilypond-live' | 'lilypond-render' | 'lilypond-setup' }
>;

export class LilyPondLiveController {
  private bodyInput: HTMLTextAreaElement | null = null;
  private btnEraseActual: HTMLButtonElement | null = null;
  private btnSaveActual: HTMLButtonElement | null = null;
  private editorBinding: MarkdownCodeMirrorBinding | null = null;
  private hasRenderedPreviewSnapshot = false;
  private inputFilename: HTMLInputElement | null = null;
  private isTeacher = false;
  private allowStudents = false;
  private libraryListEl: HTMLElement | null = null;
  private librarySearchInput: HTMLInputElement | null = null;
  private lilyRenderCache = new Map<string, Promise<LilyRenderResult | null>>();
  private liveSyncTimer: number | null = null;
  private liveSyncNeedsBody = false;
  private lastRenderedBody = '';
  private lastRenderResult: LilyRenderResult | null = null;
  private newBtn: HTMLButtonElement | null = null;
  private onPublish: (msg: LilyTransportMessage) => void;
  private previewEl: HTMLElement | null = null;
  private renderNonce = 0;
  private reportStatus: (msg: string) => void = () => {};
  private snippets: string[] = [];
  private stopEditorSync: (() => void) | null = null;
  private suppressLivePublish = false;

  private remoteCursors = new Map<string, RemoteCursorState>();
  private remoteCursorTimeout = new Map<string, number>();

  constructor(onPublish: (msg: LilyTransportMessage) => void) {
    this.onPublish = onPublish;
  }

  private canEdit() {
    return this.isTeacher || this.allowStudents;
  }

  public init(container: HTMLElement, isTeacher: boolean, reportStatus: (msg: string) => void) {
    this.stopEditorSync?.();
    this.stopEditorSync = null;
    this.isTeacher = isTeacher;
    this.reportStatus = reportStatus;
    this.bodyInput = container.querySelector('[data-lilypond-body]');
    this.previewEl = container.querySelector('[data-lilypond-preview]');
    this.newBtn = container.querySelector('[data-lilypond-new]');
    this.btnSaveActual = container.querySelector('[data-lilypond-btn-save]');
    this.btnEraseActual = container.querySelector('[data-lilypond-btn-erase]');
    this.inputFilename = container.querySelector('[data-lilypond-filename]');
    this.librarySearchInput = container.querySelector('[data-lilypond-library-search]');
    this.libraryListEl = container.querySelector('[data-lilypond-library-list]');

    const editorEl = container.querySelector<HTMLElement>('.conference-lilypond-editor');
    const layoutEl = container.querySelector<HTMLElement>('.conference-lilypond-layout');
    const toggleBtn = container.querySelector<HTMLElement>('[data-lilypond-toggle-editor]');

    // Collaboration toggle button for teacher
    const actionsContainer = container.querySelector('[data-lilypond-actions]');
    if (actionsContainer && this.isTeacher && !container.querySelector('[data-lilypond-collab]')) {
      const collabBtn = document.createElement('button');
      collabBtn.type = 'button';
      collabBtn.className = 'conference-lilypond-action';
      collabBtn.dataset.lilypondCollab = 'true';
      collabBtn.title = 'Permitir a estudiantes editar (Actualmente desactivado)';
      collabBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.5 5.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM1.5 14.5c0-2 1.5-3.5 3.5-3.5h1c2 0 3.5 1.5 3.5 3.5M10.5 5.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z"/></svg>';
      
      const updateCollabBtnUI = () => {
        if (this.allowStudents) {
          collabBtn.classList.add('conference-lilypond-action--active');
          collabBtn.title = 'Permitir a estudiantes editar (Activado)';
        } else {
          collabBtn.classList.remove('conference-lilypond-action--active');
          collabBtn.title = 'Permitir a estudiantes editar (Desactivado)';
        }
      };

      collabBtn.addEventListener('click', () => {
        this.allowStudents = !this.allowStudents;
        updateCollabBtnUI();
        this.updateSetup(this.allowStudents);
        this.onPublish({ type: 'lilypond-setup', allowStudents: this.allowStudents });
      });

      actionsContainer.prepend(collabBtn);
      updateCollabBtnUI();
    }

    if (toggleBtn && layoutEl) {
      const newToggleBtn = toggleBtn.cloneNode(true) as HTMLElement;
      toggleBtn.replaceWith(newToggleBtn);
      newToggleBtn.addEventListener('click', () => {
        const isVisible = layoutEl.dataset.editorVisible === 'true';
        layoutEl.dataset.editorVisible = (!isVisible).toString();
      });
    }

    const canEdit = this.canEdit();

    if (editorEl) {
      editorEl.hidden = false;
      editorEl.dataset.editorMode = canEdit ? 'teacher' : 'viewer';
    }
    if (layoutEl) {
      layoutEl.dataset.editorVisible = 'true';
    }

    if (this.bodyInput) {
      this.bodyInput.readOnly = !canEdit;
      
      if (this.editorBinding) {
        this.editorBinding.destroy();
      }
      
      // Clear datasets to allow re-enhancement
      delete this.bodyInput.dataset.markdownEditorEnhanced;
      delete this.bodyInput.dataset.markdownCodeMirrorEnhanced;
      delete this.bodyInput.dataset.markdownEditorActionsEnhanced;

      this.editorBinding = enhanceMarkdownTextarea(this.bodyInput, {
        actionsContainer: this.canEdit()
          ? container.querySelector<HTMLElement>('[data-lilypond-actions]')
          : null,
        status: this.reportStatus,
        buttonClassName: 'conference-lilypond-action conference-lilypond-action--icon',
        actionSpacerClassName: 'conference-lilypond-action-spacer',
        dropzoneClassName: 'conference-lilypond-dropzone',
        dropzoneOverlayClassName: 'conference-lilypond-dropzone-overlay',
        dropzoneLabelClassName: 'conference-lilypond-dropzone-label',
        inputClassName: 'conference-lilypond-editor-input',
        dropLabel: 'Soltar archivo',
        useCodeMirror: true,
      }) ?? null;
      
      this.editorBinding?.setEditable(canEdit);

      const unsubscribe = this.editorBinding?.onChange((snapshot) => {
        if (this.suppressLivePublish) return;
        if (!snapshot.docChanged && !snapshot.selectionChanged) return;
        if (snapshot.docChanged) this.liveSyncNeedsBody = true;
        this.scheduleLiveSync();
      }) || (() => {});

      this.stopEditorSync = () => {
        unsubscribe();
        this.editorBinding?.destroy();
        this.editorBinding = null;
      };

      this.bodyInput.addEventListener('input', () => {
        if (this.suppressLivePublish) return;
        this.liveSyncNeedsBody = true;
        this.scheduleLiveSync();
      });

      this.bodyInput.addEventListener('selectionchange', () => {
        if (this.suppressLivePublish) return;
        this.scheduleLiveSync();
      });

      container.querySelector('[data-lilypond-form]')?.addEventListener('keydown', (event) => {
        if (!(event instanceof KeyboardEvent)) return;
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          if (this.isTeacher) {
            void this.publishRender();
          }
        }
      });

      void this.fetchSnippetsList();
    }

    if (this.newBtn) {
      this.newBtn.addEventListener('click', () => {
        if (!this.canEdit()) return;
        this.setBodyValue('');
        if (this.inputFilename) this.inputFilename.value = '';
        this.liveSyncNeedsBody = true;
        this.publishLiveSync(true);
      });
    }

    const btnRender = container.querySelector('[data-lilypond-save]');
    if (btnRender) {
      if (this.isTeacher) {
        btnRender.addEventListener('click', () => {
          void this.publishRender();
        });
      } else {
        btnRender.remove();
      }
    }

    if (this.btnSaveActual) {
      this.btnSaveActual.addEventListener('click', () => {
        if (!this.canEdit()) return;
        this.saveCurrentSnippetLocally();
      });
    }

    if (this.btnEraseActual) {
      this.btnEraseActual.addEventListener('click', () => {
        if (!this.canEdit()) return;
        this.eraseCurrentSnippetLocally();
      });
    }

    this.librarySearchInput?.addEventListener('input', () => {
      this.renderSnippetResults();
    });

    this.initResizer(container);
    this.clearPreview();
  }

  private initResizer(container: HTMLElement) {
    const resizer = container.querySelector<HTMLElement>('[data-lilypond-resizer]');
    const layout = container.querySelector<HTMLElement>('.conference-lilypond-layout');
    if (!resizer || !layout) return;

    let isDragging = false;

    const onStart = (e: MouseEvent | TouchEvent) => {
      isDragging = true;
      resizer.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;
      const clientX = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const rect = layout.getBoundingClientRect();
      const offset = clientX - rect.left;
      
      const minWidth = 120;
      const maxWidth = rect.width - 120;
      const width = Math.max(minWidth, Math.min(offset, maxWidth));
      
      layout.style.setProperty('--lily-editor-width', `${width}px`);
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      resizer.classList.remove('is-dragging');
      document.body.style.cursor = '';
    };

    resizer.addEventListener('mousedown', onStart);
    resizer.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);
  }

  public updateSetup(allowStudents: boolean) {
    this.allowStudents = allowStudents;
    const canEdit = this.canEdit();
    if (this.bodyInput) this.bodyInput.readOnly = !canEdit;
    if (this.editorBinding) {
      this.editorBinding.setEditable(canEdit);
    }

    const editorEl = this.bodyInput?.closest('.conference-lilypond-editor') as HTMLElement;
    if (editorEl) {
      editorEl.dataset.editorMode = canEdit ? 'teacher' : 'viewer';
    }
  }

  public getSetupSnapshot() {
    return { allowStudents: this.allowStudents };
  }

  public getCurrentBody() {
    return this.editorBinding?.getValue() || String(this.bodyInput?.value || '');
  }

  public getCurrentLiveState() {
    const selection = this.readCurrentSelection();
    return {
      body: this.getCurrentBody(),
      anchor: selection.anchor,
      head: selection.head,
    };
  }

  public getRenderSnapshot() {
    return {
      body: this.lastRenderedBody,
      published: this.hasRenderedPreviewSnapshot,
      url: this.lastRenderResult?.url,
      midiUrl: this.lastRenderResult?.midiUrl,
    };
  }

  public handleIncomingLiveState(
    message: Extract<ConferenceMessage, { type: 'lilypond-live' }>,
    sender?: { id: string; name: string; color: string },
  ) {
    if (typeof message.body === 'string' && this.getCurrentBody() !== message.body) {
      this.setBodyValue(message.body);
    }

    if (sender) {
      this.remoteCursors.set(sender.id, {
        id: sender.id,
        name: sender.name,
        color: sender.color,
        anchor: message.anchor,
        head: message.head,
      });

      if (this.remoteCursorTimeout.has(sender.id)) {
        window.clearTimeout(this.remoteCursorTimeout.get(sender.id));
      }

      this.remoteCursorTimeout.set(
        sender.id,
        window.setTimeout(() => {
          this.remoteCursors.delete(sender.id);
          this.updateRemoteCursors();
        }, 5000),
      );
    }

    this.updateRemoteCursors();
  }

  private updateRemoteCursors() {
    if (this.editorBinding) {
      const selections = Array.from(this.remoteCursors.values());
      this.editorBinding.setRemoteSelections(selections, { scrollIntoView: false });
    }
  }

  public handleIncomingRenderState(message: Extract<LilyTransportMessage, { type: 'lilypond-render' }>) {
    this.hasRenderedPreviewSnapshot = true;
    this.lastRenderedBody = String(message.body || '');

    if (message.url) {
      const normalized = this.lastRenderedBody.replace(/\r\n?/g, '\n').trim();
      const result = {
        url: message.url,
        midiUrl: message.midiUrl || '',
      };
      if (normalized) {
        this.lilyRenderCache.set(normalized, Promise.resolve(result));
      }
      this.lastRenderResult = result;
    } else {
      this.lastRenderResult = null;
    }

    void this.renderLocally(this.lastRenderedBody);
  }

  private setBodyValue(value: string) {
    if (!this.bodyInput) return;
    const nextValue = String(value || '');
    
    // Crucial: avoid feedback loops
    this.suppressLivePublish = true;

    try {
      if (this.editorBinding) {
        this.editorBinding.setValue(nextValue, {
          scrollIntoView: false,
        });
      } else {
        this.bodyInput.value = nextValue;
        this.bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } finally {
      // Re-enable immediately since CodeMirror's update is synchronous
      this.suppressLivePublish = false;
    }
  }

  private clearPreview() {
    if (!(this.previewEl instanceof HTMLElement)) return;
    this.previewEl.innerHTML = '';
    delete this.previewEl.dataset.loading;
  }

  private readCurrentSelection() {
    if (this.editorBinding) {
      return this.editorBinding.getSelection();
    }

    const bodyLength = this.getCurrentBody().length;
    const anchor = Math.max(0, Math.min(this.bodyInput?.selectionStart ?? bodyLength, bodyLength));
    const head = Math.max(0, Math.min(this.bodyInput?.selectionEnd ?? anchor, bodyLength));
    return { anchor, head };
  }

  private getFilteredSnippets() {
    const query = String(this.librarySearchInput?.value || '').trim().toLowerCase();
    const source = [...this.snippets];
    if (!query) return source.slice(0, 16);

    const exactMatches = source.filter((name) => name.toLowerCase().startsWith(query));
    const partialMatches = source.filter(
      (name) => !exactMatches.includes(name) && name.toLowerCase().includes(query),
    );
    return [...exactMatches, ...partialMatches].slice(0, 16);
  }

  private renderSnippetResults() {
    if (!(this.libraryListEl instanceof HTMLElement)) return;

    this.libraryListEl.innerHTML = '';
    const currentName = String(this.inputFilename?.value || '').trim();
    const matches = this.getFilteredSnippets();

    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'conference-lilypond-library-empty';
      empty.textContent = this.snippets.length > 0 ? 'No hay coincidencias.' : 'No hay snippets guardados.';
      this.libraryListEl.appendChild(empty);
      return;
    }

    matches.forEach((name) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conference-lilypond-library-item';
      button.dataset.active = currentName === name ? 'true' : 'false';
      button.title = name;
      button.textContent = name;
      button.addEventListener('click', () => {
        void this.loadSnippet(name);
      });
      this.libraryListEl?.appendChild(button);
    });
  }

  private async fetchSnippetsList() {
    try {
      const response = await fetch('/api/lily/snippets');
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      this.snippets = Array.isArray(payload?.snippets)
        ? payload.snippets
            .map((name: unknown) => String(name || '').trim())
            .filter(Boolean)
        : [];
      this.renderSnippetResults();
    } catch {
      this.renderSnippetResults();
    }
  }

  private async loadSnippet(name: string) {
    if (!name) return;

    this.reportStatus(`Cargando ${name}...`);
    try {
      const response = await fetch(`/lily/snippets/${encodeURIComponent(name)}`);
      if (!response.ok) {
        this.reportStatus('No se pudo descargar el snippet.');
        return;
      }

      const code = await response.text();
      this.setBodyValue(code);
      if (this.inputFilename) this.inputFilename.value = name;
      if (this.librarySearchInput) this.librarySearchInput.value = name;
      this.renderSnippetResults();
      this.publishLiveSync(true);
      this.reportStatus(`Snippet ${name} cargado.`);
    } catch (error: any) {
      this.reportStatus(error?.message || 'Error descargando snippet.');
    }
  }

  private async saveCurrentSnippetLocally() {
    const name = String(this.inputFilename?.value || '').trim();
    const code = this.getCurrentBody();
    if (!name) {
      this.reportStatus('Un nombre de archivo es requerido.');
      return;
    }

    this.reportStatus('Guardando snippet...');
    try {
      const response = await fetch('/api/lily/snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.reportStatus(String(payload?.error || 'Error guardando snippet.'));
        return;
      }

      const savedName = String(payload?.name || name).trim() || name;
      if (this.inputFilename) this.inputFilename.value = savedName;
      if (this.librarySearchInput) this.librarySearchInput.value = savedName;
      await this.fetchSnippetsList();
      this.reportStatus(`Snippet ${savedName} guardado.`);
    } catch (error: any) {
      this.reportStatus(error?.message || 'Error de red.');
    }
  }

  private async eraseCurrentSnippetLocally() {
    const name = String(this.inputFilename?.value || '').trim();
    if (!name) {
      this.reportStatus('Nombre de archivo vacío.');
      return;
    }

    if (!window.confirm(`¿Borrar el snippet ${name}?`)) return;

    this.reportStatus('Borrando snippet...');
    try {
      const response = await fetch(`/api/lily/snippets?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.reportStatus(String(payload?.error || 'Error borrando snippet.'));
        return;
      }

      if (this.inputFilename) this.inputFilename.value = '';
      if (this.librarySearchInput) this.librarySearchInput.value = '';
      this.setBodyValue('');
      await this.fetchSnippetsList();
      this.publishLiveSync(true);
      this.reportStatus(`Snippet ${name} borrado.`);
    } catch (error: any) {
      this.reportStatus(error?.message || 'Error de red.');
    }
  }

  private scheduleLiveSync() {
    if (!this.canEdit()) return;
    if (this.suppressLivePublish) return;

    if (this.liveSyncTimer) {
      window.clearTimeout(this.liveSyncTimer);
    }
    this.liveSyncTimer = window.setTimeout(() => {
      this.publishLiveSync();
    }, 90);
  }

  private publishLiveSync(forceIncludeBody = false) {
    if (!this.canEdit()) return;
    if (this.suppressLivePublish) return;

    if (this.liveSyncTimer) {
      window.clearTimeout(this.liveSyncTimer);
      this.liveSyncTimer = null;
    }

    const selection = this.readCurrentSelection();
    const includeBody = forceIncludeBody || this.liveSyncNeedsBody;
    const message: LilyTransportMessage = includeBody
      ? {
          type: 'lilypond-live',
          anchor: selection.anchor,
          head: selection.head,
          body: this.getCurrentBody(),
        }
      : {
          type: 'lilypond-live',
          anchor: selection.anchor,
          head: selection.head,
        };

    this.liveSyncNeedsBody = false;
    this.onPublish(message);
  }

  private async publishRender() {
    if (!this.isTeacher) return;
    this.publishLiveSync(true);

    const body = this.getCurrentBody();
    this.hasRenderedPreviewSnapshot = true;
    this.lastRenderedBody = body;

    // Trigger local render first to get the result from cache or API
    await this.renderLocally(body);

    let finalUrl: string | undefined;
    let finalMidiUrl: string | undefined;

    if (this.previewEl) {
      const figure = this.previewEl.querySelector('[data-lily-url]');
      if (figure instanceof HTMLElement) {
        finalUrl = figure.dataset.lilyUrl;
        finalMidiUrl = figure.dataset.midiUrl;
      }
    }

    this.lastRenderResult = finalUrl ? { url: finalUrl, midiUrl: finalMidiUrl || '' } : null;

    this.onPublish({
      type: 'lilypond-render',
      body,
      url: finalUrl,
      midiUrl: finalMidiUrl,
    });
  }

  private async loadMermaid() {
    const previewWindow = window as MarkdownPreviewWindow;
    if (previewWindow.mermaid?.run) return previewWindow.mermaid;
    if (previewWindow.__roomLilyMermaidPromise) return previewWindow.__roomLilyMermaidPromise;

    previewWindow.__roomLilyMermaidPromise = new Promise((resolve) => {
      const existing = document.querySelector('script[src*="mermaid"]');
      if (existing) {
        const poll = () => {
          if (previewWindow.mermaid) {
            resolve(previewWindow.mermaid);
            return;
          }
          window.setTimeout(poll, 40);
        };
        poll();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
      script.onload = () => resolve(previewWindow.mermaid ?? null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });

    return previewWindow.__roomLilyMermaidPromise;
  }

  private runMermaidIn(container: HTMLElement) {
    const nodes = Array.from(container.querySelectorAll<HTMLElement>('.mermaid'))
      .filter((node) => node.dataset.mermaidRendered !== 'true');
    if (nodes.length === 0) return;

    void this.loadMermaid().then((mermaid) => {
      if (!mermaid?.run) return;
      try {
        mermaid.initialize?.({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'loose',
        });
        mermaid.run({ 
          nodes
        });
        nodes.forEach((node) => {
          node.dataset.mermaidRendered = 'true';
        });
      } catch (error) {
        console.error('[lilypond-live] Mermaid render error:', error);
      }
    });
  }

  private hydrateRenderedLilyBlocks(container: HTMLElement) {
    const previewWindow = window as MarkdownPreviewWindow;
    if (typeof previewWindow.hydrateLilypondBlocks === 'function') {
      previewWindow.hydrateLilypondBlocks(container);
      return;
    }
    if (typeof (window as any).hydrateLilypondBlocks === 'function') {
      (window as any).hydrateLilypondBlocks(container);
    }
  }

  private runScriptsIn(container: HTMLElement) {
    const scripts = Array.from(container.querySelectorAll('script'));
    for (const oldScript of scripts) {
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach((attr) => {
        newScript.setAttribute(attr.name, attr.value);
      });
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode?.replaceChild(newScript, oldScript);
    }
  }

  private async renderLocally(body: string) {
    if (!(this.previewEl instanceof HTMLElement)) return;

    const ticket = ++this.renderNonce;
    const source = String(body || '');
    if (!source.trim()) {
      this.previewEl.innerHTML = '';
      delete this.previewEl.dataset.loading;
      return;
    }

    this.previewEl.dataset.loading = 'true';

    try {
      const response = await fetch('/api/live/preview-markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: source }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const payload = await response.json().catch(() => ({}));
      const html = String(payload.html || '');

      if (ticket !== this.renderNonce) return;
      
      this.previewEl.innerHTML = html;
      delete this.previewEl.dataset.loading;
      
      this.runMermaidIn(this.previewEl);
      this.hydrateRenderedLilyBlocks(this.previewEl);
      this.runScriptsIn(this.previewEl);
    } catch (error: any) {
      if (ticket !== this.renderNonce) return;
      delete this.previewEl.dataset.loading;
      this.previewEl.innerHTML = `<div class="conference-lilypond-render-error">${escapeHtml(
        error?.message || 'No se pudo renderizar el contenido.',
      )}</div>`;
    }
  }
}
