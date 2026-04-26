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
  pdfUrl: string;
};

const escapeHtml = (value: string) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const looksLikePlainLilySource = (value: string) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.includes('```')) return false;
  return (
    normalized.includes('\\score') ||
    normalized.includes('\\relative') ||
    normalized.includes('\\version') ||
    normalized.includes('\\new Staff')
  );
};

type LilyTransportMessage = Extract<
  ConferenceMessage,
  { type: 'lilypond-live' | 'lilypond-render' | 'lilypond-setup' | 'lilypond-play' }
>;

export class LilyPondLiveController {
  private bodyInput: HTMLTextAreaElement | null = null;
  private btnEraseActual: HTMLButtonElement | null = null;
  private btnSaveActual: HTMLButtonElement | null = null;
  private btnDownloadMidi: HTMLButtonElement | null = null;
  private btnDownloadPdf: HTMLButtonElement | null = null;
  private editorBinding: MarkdownCodeMirrorBinding | null = null;
  private hasRenderedPreviewSnapshot = false;
  private isTeacher = false;
  private allowStudents = false;

  // Combobox elements
  private comboboxInput: HTMLInputElement | null = null;
  private comboboxMenu: HTMLElement | null = null;

  private lilyRenderCache = new Map<string, Promise<LilyRenderResult | null>>();
  private lilypondTemplateOverride: string | null = null;
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
  private currentFilename = '';
  private lastLilySource = '';

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
    this.btnDownloadMidi = container.querySelector('[data-lilypond-btn-midi]');
    this.btnDownloadPdf = container.querySelector('[data-lilypond-btn-pdf]');

    this.comboboxInput = container.querySelector('[data-lilypond-combobox-input]');
    this.comboboxMenu = container.querySelector('[data-lilypond-combobox-menu]');

    const editorEl = container.querySelector<HTMLElement>('.conference-lilypond-editor');
    const layoutEl = container.querySelector<HTMLElement>('.conference-lilypond-layout');
    const toggleBtn = container.querySelector<HTMLElement>('[data-lilypond-toggle-editor]');

    // Prevent form submission
    container.querySelector('[data-lilypond-form]')?.addEventListener('submit', (e) => {
      e.preventDefault();
    });

    // Collaboration toggle button for teacher
    const actionsContainer = container.querySelector('[data-lilypond-actions]');
    if (actionsContainer && this.isTeacher && !container.querySelector('[data-lilypond-collab]')) {
      const collabBtn = document.createElement('button');
      collabBtn.type = 'button';
      collabBtn.className = 'conference-lilypond-action';
      collabBtn.dataset.lilypondCollab = 'true';
      collabBtn.title = 'Permitir a estudiantes editar (Actualmente desactivado)';
      collabBtn.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.5 5.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM1.5 14.5c0-2 1.5-3.5 3.5-3.5h1c2 0 3.5 1.5 3.5 3.5M10.5 5.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z"/></svg>';

      const updateCollabBtnUI = () => {
        if (this.allowStudents) {
          collabBtn.classList.add('conference-lilypond-action--active');
          collabBtn.title = 'Permitir a estudiantes editar (Activado)';
        } else {
          collabBtn.classList.remove('conference-lilypond-action--active');
          collabBtn.title = 'Permitir a estudiantes editar (Desactivado)';
        }
      };

      collabBtn.addEventListener('click', (e) => {
        e.preventDefault();
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
      newToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
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

      const setupEditor = () => {
        if (!this.bodyInput) return;

        // DESTROY existing binding before creating a new one to prevent duplication
        if (this.editorBinding) {
          this.editorBinding.destroy();
          this.editorBinding = null;
        }

        // Clear action buttons from the toolbar to prevent duplication
        const actions = container.querySelector<HTMLElement>('[data-lilypond-actions]');
        if (actions) {
          // Remove only the injected template/upload buttons, preserving manual ones like RENDER/SAVE
          actions
            .querySelectorAll('.conference-lilypond-action--icon, .conference-lilypond-action-spacer')
            .forEach((el) => el.remove());
          // Also remove any hidden file inputs created by enhanceMarkdownTextarea
          actions.querySelectorAll('input[type="file"]').forEach((el) => el.remove());
        }

        // Clear datasets to allow re-enhancement
        delete this.bodyInput.dataset.markdownEditorEnhanced;
        delete this.bodyInput.dataset.markdownCodeMirrorEnhanced;
        delete this.bodyInput.dataset.markdownEditorActionsEnhanced;

        this.editorBinding =
          enhanceMarkdownTextarea(this.bodyInput, {
            actionsContainer: this.canEdit() ? actions : null,
            status: this.reportStatus,
            buttonClassName: 'conference-lilypond-action conference-lilypond-action--icon',
            actionSpacerClassName: 'conference-lilypond-action-spacer',
            dropzoneClassName: 'conference-lilypond-dropzone',
            dropzoneOverlayClassName: 'conference-lilypond-dropzone-overlay',
            dropzoneLabelClassName: 'conference-lilypond-dropzone-label',
            inputClassName: 'conference-lilypond-editor-input',
            dropLabel: 'Soltar archivo',
            useCodeMirror: true,
            templateOverrides: this.lilypondTemplateOverride
              ? {
                  lilypond: this.lilypondTemplateOverride,
                }
              : undefined,
          }) ?? null;

        this.editorBinding?.setEditable(this.canEdit());

        const unsubscribe =
          this.editorBinding?.onChange((snapshot) => {
            if (this.suppressLivePublish) return;
            if (!snapshot.docChanged && !snapshot.selectionChanged) return;
            if (snapshot.docChanged) this.liveSyncNeedsBody = true;
            this.scheduleLiveSync();
          }) || (() => {});

        this.stopEditorSync = () => {
          unsubscribe();
          if (this.editorBinding) {
            this.editorBinding.destroy();
            this.editorBinding = null;
          }
        };
      };

      // Initial setup
      setupEditor();

      // Try to load default.md and refresh if found
      void this.loadDefaultTemplate().then((found) => {
        if (found) setupEditor();
      });

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
      const newNewBtn = this.newBtn.cloneNode(true) as HTMLButtonElement;
      this.newBtn.replaceWith(newNewBtn);
      this.newBtn = newNewBtn;
      this.newBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!this.canEdit()) return;
        this.setBodyValue('');
        this.currentFilename = '';
        if (this.comboboxInput) this.comboboxInput.value = '';
        this.liveSyncNeedsBody = true;
        this.publishLiveSync(true);
      });
    }

    const btnRender = container.querySelector('[data-lilypond-save]');
    if (btnRender) {
      if (this.isTeacher) {
        const newRenderBtn = btnRender.cloneNode(true) as HTMLButtonElement;
        btnRender.replaceWith(newRenderBtn);
        newRenderBtn.addEventListener('click', (e) => {
          e.preventDefault();
          void this.publishRender();
        });
      } else {
        btnRender.remove();
      }
    }

    if (this.btnSaveActual) {
      const newSaveBtn = this.btnSaveActual.cloneNode(true) as HTMLButtonElement;
      this.btnSaveActual.replaceWith(newSaveBtn);
      this.btnSaveActual = newSaveBtn;
      this.btnSaveActual.addEventListener('click', (e) => {
        e.preventDefault();
        if (!this.canEdit()) return;
        void this.saveCurrentSnippetLocally();
      });
    }

    if (this.btnEraseActual) {
      const newEraseBtn = this.btnEraseActual.cloneNode(true) as HTMLButtonElement;
      this.btnEraseActual.replaceWith(newEraseBtn);
      this.btnEraseActual = newEraseBtn;
      this.btnEraseActual.addEventListener('click', (e) => {
        e.preventDefault();
        if (!this.canEdit()) return;
        void this.eraseCurrentSnippetLocally();
      });
    }

    if (this.btnDownloadMidi) {
      this.btnDownloadMidi.addEventListener('click', (e) => {
        e.preventDefault();
        this.downloadAsset('midi');
      });
    }

    if (this.btnDownloadPdf) {
      this.btnDownloadPdf.addEventListener('click', (e) => {
        e.preventDefault();
        this.downloadAsset('pdf');
      });
    }

    // Combobox Event Listeners
    if (this.comboboxInput) {
      this.comboboxInput.addEventListener('input', () => {
        this.currentFilename = this.comboboxInput?.value || '';
        this.renderComboboxMenu(this.currentFilename);
      });
      this.comboboxInput.addEventListener('focus', () => {
        this.renderComboboxMenu(this.comboboxInput?.value || '');
      });
      // Handle Enter in combobox to prevent page reset
      this.comboboxInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (this.comboboxMenu) this.comboboxMenu.hidden = true;
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (
        this.comboboxMenu &&
        !container.querySelector('[data-lilypond-combobox]')?.contains(e.target as Node)
      ) {
        this.comboboxMenu.hidden = true;
      }
    });

    this.initResizer(container);
    this.clearPreview();
    this.updateDownloadButtons();

    // Listen for playback events from LilypondPlayer to broadcast them
    window.addEventListener('musiki:lilypond:play', (e: any) => {
      if (!this.canEdit()) return;
      const { action, url } = e.detail;
      this.onPublish({
        type: 'lilypond-play',
        action: action === 'start' ? 'start' : 'stop',
        url: url
      });
    });
  }

  public handleIncomingPlayState(message: Extract<ConferenceMessage, { type: 'lilypond-play' }>) {
    // Forward to LilypondPlayer globally
    window.dispatchEvent(new CustomEvent('musiki:lilypond:remote-play', {
        detail: {
            action: message.action,
            url: message.url
        }
    }));
  }

  private updateDownloadButtons() {
    if (this.btnDownloadMidi) {
      this.btnDownloadMidi.disabled = !this.lastRenderResult?.midiUrl;
      this.btnDownloadMidi.style.opacity = this.btnDownloadMidi.disabled ? '0.3' : '1';
    }
    if (this.btnDownloadPdf) {
      // PDF can be generated on demand if we have source
      this.btnDownloadPdf.disabled = !this.lastLilySource;
      this.btnDownloadPdf.style.opacity = this.btnDownloadPdf.disabled ? '0.3' : '1';
    }
  }

  private async downloadAsset(kind: 'midi' | 'pdf') {
    let url = kind === 'midi' ? this.lastRenderResult?.midiUrl : this.lastRenderResult?.pdfUrl;
    
    if (kind === 'pdf' && !url && this.lastLilySource) {
      this.reportStatus('Generando PDF...');
      try {
        const response = await fetch('/api/lily/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: this.lastLilySource, format: 'pdf' }),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.url) {
          url = payload.url;
          if (this.lastRenderResult) this.lastRenderResult.pdfUrl = url;
          this.reportStatus('PDF generado.');
        } else {
          throw new Error(payload.error || 'Error en servidor');
        }
      } catch (err: any) {
        this.reportStatus(`No se pudo generar el PDF: ${err.message}`);
        return;
      }
    }

    if (!url) return;

    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.currentFilename || 'score'}.${kind === 'midi' ? 'mid' : 'pdf'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
      pdfUrl: this.lastRenderResult?.pdfUrl,
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

  public handleIncomingRenderState(
    message: Extract<LilyTransportMessage, { type: 'lilypond-render' }>,
  ) {
    this.hasRenderedPreviewSnapshot = true;
    this.lastRenderedBody = String(message.body || '');

    // Extract lily source from incoming body for students to be able to download PDF
    const body = this.lastRenderedBody;
    if (looksLikePlainLilySource(body)) {
      this.lastLilySource = body;
    } else {
      const match = body.match(/```lily(?:pond)?\n([\s\S]*?)```/);
      this.lastLilySource = match ? match[1] : '';
    }

    if (message.url) {
      const normalized = this.lastRenderedBody.replace(/\r\n?/g, '\n').trim();
      const result = {
        url: message.url,
        midiUrl: message.midiUrl || '',
        pdfUrl: message.pdfUrl || '',
      };
      if (normalized) {
        this.lilyRenderCache.set(normalized, Promise.resolve(result));
      }
      this.lastRenderResult = result;
      this.updateDownloadButtons();
    } else {
      this.lastRenderResult = null;
      this.updateDownloadButtons();
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
      setTimeout(() => {
        this.suppressLivePublish = false;
      }, 50);
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

  private renderComboboxMenu(query = '') {
    if (!this.comboboxMenu) return;

    const matches = this.snippets.filter((file) => file.toLowerCase().includes(query.toLowerCase()));

    this.comboboxMenu.innerHTML = '';

    if (matches.length === 0) {
      const li = document.createElement('li');
      li.className = 'conference-lilypond-combobox-empty';
      li.textContent = 'Sin coincidencias.';
      this.comboboxMenu.appendChild(li);
    } else {
      for (const file of matches) {
        const li = document.createElement('li');
        li.className = 'conference-lilypond-combobox-item';
        if (file === this.currentFilename)
          li.classList.add('conference-lilypond-combobox-item--active');
        li.textContent = file;
        li.tabIndex = 0;

        li.addEventListener('click', (e) => {
          e.preventDefault();
          this.selectFile(file);
        });

        this.comboboxMenu.appendChild(li);
      }
    }

    this.comboboxMenu.hidden = false;
  }

  private selectFile(file: string) {
    this.currentFilename = file;
    if (this.comboboxInput) this.comboboxInput.value = file;
    if (this.comboboxMenu) this.comboboxMenu.hidden = true;
    void this.loadSnippet(file);
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
      // No automatic render here, wait for interaction
    } catch {
      // Ignore
    }
  }

  private async loadDefaultTemplate(): Promise<boolean> {
    try {
      const response = await fetch('/lily/snippets/default.md');
      if (response.ok) {
        const code = await response.text();
        if (code.trim()) {
          this.lilypondTemplateOverride = code.trim();
          return true;
        }
      }
    } catch (e) {
      // Ignore errors
    }
    return false;
  }

  private async loadSnippet(name: string) {
    if (!name) return;

    this.reportStatus(`Cargando ${name}...`);
    try {
      const response = await fetch(`/lily/snippets/${encodeURIComponent(name)}`);
      if (!response.ok) {
        this.reportStatus('No se pudo descargar el archivo.');
        return;
      }

      const code = await response.text();
      this.setBodyValue(code);
      this.currentFilename = name;
      if (this.comboboxInput) this.comboboxInput.value = name;

      this.publishLiveSync(true);
      // Trigger render after loading
      void this.renderLocally(code);

      this.reportStatus(`${name} cargado.`);

      if (name === 'default.md') {
        this.lilypondTemplateOverride = code.trim();
      }
    } catch (error: any) {
      this.reportStatus(error?.message || 'Error descargando archivo.');
    }
  }

  private async saveCurrentSnippetLocally() {
    let name = String(this.currentFilename || this.comboboxInput?.value || '').trim();
    const code = this.getCurrentBody();

    if (!name) {
      this.reportStatus('Un nombre de archivo es requerido.');
      return;
    }

    // Ensure .md if no extension
    if (!name.includes('.')) {
      name += '.md';
    }

    this.reportStatus('Guardando...');
    try {
      const response = await fetch('/api/lily/snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.reportStatus(String(payload?.error || 'Error guardando.'));
        return;
      }

      const savedName = String(payload?.name || name).trim() || name;
      this.currentFilename = savedName;
      if (this.comboboxInput) this.comboboxInput.value = savedName;

      await this.fetchSnippetsList();
      this.reportStatus(`${savedName} guardado.`);

      if (savedName === 'default.md') {
        this.lilypondTemplateOverride = code.trim();
      }

      // TRIGGER RENDER AFTER SAVE as requested
      void this.renderLocally(code);
    } catch (error: any) {
      this.reportStatus(error?.message || 'Error de red.');
    }
  }

  private async eraseCurrentSnippetLocally() {
    const name = String(this.currentFilename || this.comboboxInput?.value || '').trim();
    if (!name) {
      this.reportStatus('Nombre de archivo vacío.');
      return;
    }

    if (!window.confirm(`¿Borrar el archivo ${name}?`)) return;

    this.reportStatus('Borrando...');
    try {
      const response = await fetch(`/api/lily/snippets?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.reportStatus(String(payload?.error || 'Error borrando.'));
        return;
      }

      this.currentFilename = '';
      if (this.comboboxInput) this.comboboxInput.value = '';
      this.setBodyValue('');
      await this.fetchSnippetsList();
      this.publishLiveSync(true);
      this.reportStatus(`${name} borrado.`);
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

    const result = await this.renderLocally(body);

    this.onPublish({
      type: 'lilypond-render',
      body,
      url: result?.url,
      midiUrl: result?.midiUrl,
      pdfUrl: result?.pdfUrl,
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
    const nodes = Array.from(container.querySelectorAll<HTMLElement>('.mermaid')).filter(
      (node) => node.dataset.mermaidRendered !== 'true',
    );
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
          nodes,
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

  private async requestLilyRender(source: string): Promise<LilyRenderResult | null> {
    const normalized = String(source || '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) return null;
    
    if (this.lilyRenderCache.has(normalized)) {
      return this.lilyRenderCache.get(normalized) ?? null;
    }

    const requestPromise = fetch('/api/lily/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: normalized }),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json().catch(() => null);
        if (!payload || payload.success !== true || !payload.url) return null;
        return {
          midiUrl: String(payload.midiUrl || ''),
          url: String(payload.url),
          pdfUrl: String(payload.pdfUrl || ''),
        } satisfies LilyRenderResult;
      })
      .catch(() => null);

    this.lilyRenderCache.set(normalized, requestPromise);
    return requestPromise;
  }

  private async renderLocally(body: string): Promise<LilyRenderResult | null> {
    if (!(this.previewEl instanceof HTMLElement)) return null;

    const ticket = ++this.renderNonce;
    const source = String(body || '');
    if (!source.trim()) {
      this.previewEl.innerHTML = '';
      delete this.previewEl.dataset.loading;
      return null;
    }

    this.previewEl.dataset.loading = 'true';

    try {
      // Find the first Lilypond block to extract metadata for download buttons
      let firstLilySource = '';
      if (looksLikePlainLilySource(source)) {
        firstLilySource = source;
      } else {
        const match = source.match(/```lily(?:pond)?\n([\s\S]*?)```/);
        if (match) firstLilySource = match[1];
      }

      const resultPromise = firstLilySource ? this.requestLilyRender(firstLilySource) : Promise.resolve(null);

      // Main markdown render
      let markdown = source;
      if (looksLikePlainLilySource(source)) {
        markdown = `\`\`\`lily\n${source}\n\`\`\``;
      }

      const response = await fetch('/api/live/preview-markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const payload = await response.json().catch(() => ({}));
      const html = String(payload.html || '');
      const result = await resultPromise;
      this.lastLilySource = firstLilySource;

      if (ticket !== this.renderNonce) return result;

      this.previewEl.innerHTML = html;
      delete this.previewEl.dataset.loading;

      if (result) {
        this.lastRenderResult = result;
        this.updateDownloadButtons();
      }

      this.runMermaidIn(this.previewEl);
      this.hydrateRenderedLilyBlocks(this.previewEl);
      this.runScriptsIn(this.previewEl);
      
      return result;
    } catch (error: any) {
      if (ticket !== this.renderNonce) return null;
      delete this.previewEl.dataset.loading;
      this.previewEl.innerHTML = `<div class="conference-lilypond-render-error">${escapeHtml(
        error?.message || 'No se pudo renderizar el contenido.',
      )}</div>`;
      return null;
    }
  }
}
