import type { MarkdownCodeMirrorBinding } from '../../markdown-codemirror.ts';
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

const LILY_CODE_SELECTOR = [
  'pre > code.language-lily',
  'pre > code.lang-lily',
  'pre > code.language-lilypond',
  'pre > code.lang-lilypond',
  'pre > code.language-ly',
  'pre > code.lang-ly',
].join(', ');

const escapeHtml = (value: string) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeMermaidSource = (value: string) =>
  String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();

const looksLikePlainLilySource = (value: string) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.includes('```')) return false;
  return (
    normalized.includes('\\score')
    || normalized.includes('\\relative')
    || normalized.includes('\\version')
    || normalized.includes('\\new Staff')
  );
};

type LilyTransportMessage = Extract<ConferenceMessage, { type: 'lilypond-live' | 'lilypond-render' }>;

export class LilyPondLiveController {
  private bodyInput: HTMLTextAreaElement | null = null;
  private btnEraseActual: HTMLButtonElement | null = null;
  private btnSaveActual: HTMLButtonElement | null = null;
  private editorBinding: MarkdownCodeMirrorBinding | null = null;
  private hasRenderedPreviewSnapshot = false;
  private inputFilename: HTMLInputElement | null = null;
  private isTeacher = false;
  private libraryListEl: HTMLElement | null = null;
  private librarySearchInput: HTMLInputElement | null = null;
  private lilyRenderCache = new Map<string, Promise<LilyRenderResult | null>>();
  private liveSyncTimer: number | null = null;
  private liveSyncNeedsBody = false;
  private lastRenderedBody = '';
  private newBtn: HTMLButtonElement | null = null;
  private onPublish: (msg: LilyTransportMessage) => void;
  private previewEl: HTMLElement | null = null;
  private renderNonce = 0;
  private reportStatus: (msg: string) => void = () => {};
  private saveBtn: HTMLButtonElement | null = null;
  private snippets: string[] = [];
  private stopEditorSync: (() => void) | null = null;
  private suppressLivePublish = false;

  constructor(onPublish: (msg: LilyTransportMessage) => void) {
    this.onPublish = onPublish;
  }

  public init(container: HTMLElement, isTeacher: boolean, reportStatus: (msg: string) => void) {
    this.stopEditorSync?.();
    this.stopEditorSync = null;
    this.isTeacher = isTeacher;
    this.reportStatus = reportStatus;
    this.bodyInput = container.querySelector('[data-lilypond-body]');
    this.previewEl = container.querySelector('[data-lilypond-preview]');
    this.saveBtn = container.querySelector('[data-lilypond-save]');
    this.newBtn = container.querySelector('[data-lilypond-new]');
    this.btnSaveActual = container.querySelector('[data-lilypond-btn-save]');
    this.btnEraseActual = container.querySelector('[data-lilypond-btn-erase]');
    this.inputFilename = container.querySelector('[data-lilypond-filename]');
    this.librarySearchInput = container.querySelector('[data-lilypond-library-search]');
    this.libraryListEl = container.querySelector('[data-lilypond-library-list]');

    const editorEl = container.querySelector<HTMLElement>('.conference-lilypond-editor');
    const layoutEl = container.querySelector<HTMLElement>('.conference-lilypond-layout');

    if (editorEl) {
      editorEl.hidden = false;
      editorEl.dataset.editorMode = isTeacher ? 'teacher' : 'viewer';
    }
    if (layoutEl) {
      layoutEl.dataset.editorVisible = 'true';
    }

    if (this.bodyInput) {
      this.bodyInput.readOnly = !this.isTeacher;
      this.editorBinding = enhanceMarkdownTextarea(this.bodyInput, {
        actionsContainer: this.isTeacher
          ? container.querySelector<HTMLElement>('[data-lilypond-actions]')
          : null,
        status: reportStatus,
        buttonClassName: 'conference-lilypond-action conference-lilypond-action--icon',
        actionSpacerClassName: 'conference-lilypond-action-spacer',
        dropzoneClassName: 'conference-lilypond-dropzone',
        dropzoneOverlayClassName: 'conference-lilypond-dropzone-overlay',
        dropzoneLabelClassName: 'conference-lilypond-dropzone-label',
        inputClassName: 'conference-lilypond-editor-input',
        dropLabel: 'Soltar archivo',
        useCodeMirror: true,
      }) ?? null;
      this.editorBinding?.setEditable(this.isTeacher);
    }

    if (this.isTeacher && this.bodyInput) {
      if (this.editorBinding) {
        this.stopEditorSync = this.editorBinding.onChange((snapshot) => {
          if (this.suppressLivePublish) return;
          if (snapshot.docChanged) {
            this.liveSyncNeedsBody = true;
          }
          if (!snapshot.docChanged && !snapshot.selectionChanged) return;
          this.scheduleLiveSync();
        });
      } else {
        this.bodyInput.addEventListener('input', () => {
          if (this.suppressLivePublish) return;
          this.liveSyncNeedsBody = true;
          this.scheduleLiveSync();
        });
      }

      this.newBtn?.addEventListener('click', () => {
        this.setBodyValue('');
        if (this.inputFilename) this.inputFilename.value = '';
        if (this.librarySearchInput) this.librarySearchInput.value = '';
        this.renderSnippetResults();
        this.publishLiveSync(true);
      });

      this.saveBtn?.addEventListener('click', () => {
        this.publishRender();
      });

      this.btnSaveActual?.addEventListener('click', () => {
        void this.saveCurrentSnippet();
      });

      this.btnEraseActual?.addEventListener('click', () => {
        void this.eraseCurrentSnippet();
      });

      this.librarySearchInput?.addEventListener('input', () => {
        this.renderSnippetResults();
      });

      this.librarySearchInput?.addEventListener('keydown', (event) => {
        if (!(event instanceof KeyboardEvent) || event.key !== 'Enter') return;
        event.preventDefault();
        const nextName = this.getFilteredSnippets()[0];
        if (nextName) {
          void this.loadSnippet(nextName);
        }
      });

      container.querySelector('[data-lilypond-form]')?.addEventListener('keydown', (event) => {
        if (!(event instanceof KeyboardEvent)) return;
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          this.publishRender();
        }
      });

      void this.fetchSnippetsList();
    }

    this.clearPreview();
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
    };
  }

  public handleIncomingLiveState(message: Extract<ConferenceMessage, { type: 'lilypond-live' }>) {
    if (typeof message.body === 'string' && this.getCurrentBody() !== message.body) {
      this.setBodyValue(message.body);
    }
    this.applyRemoteSelection(message.anchor, message.head, true);
  }

  public handleIncomingRenderState(body: string) {
    this.hasRenderedPreviewSnapshot = true;
    this.lastRenderedBody = String(body || '');
    void this.renderLocally(this.lastRenderedBody);
  }

  private setBodyValue(value: string) {
    if (!this.bodyInput) return;
    const nextValue = String(value || '');
    this.suppressLivePublish = true;

    if (this.editorBinding) {
      this.editorBinding.setValue(nextValue, {
        scrollIntoView: false,
      });
    } else {
      this.bodyInput.value = nextValue;
      this.bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    queueMicrotask(() => {
      this.suppressLivePublish = false;
    });
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

  private applyRemoteSelection(anchor: number, head: number, scrollIntoView = true) {
    const bodyLength = this.getCurrentBody().length;
    const nextAnchor = Math.max(0, Math.min(Number(anchor) || 0, bodyLength));
    const nextHead = Math.max(0, Math.min(Number(head) || nextAnchor, bodyLength));

    if (this.editorBinding) {
      this.editorBinding.setRemoteSelection(nextAnchor, nextHead, {
        scrollIntoView,
      });
      return;
    }

    if (this.bodyInput instanceof HTMLTextAreaElement) {
      this.bodyInput.setSelectionRange(nextAnchor, nextHead);
    }
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

  private async saveCurrentSnippet() {
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

  private async eraseCurrentSnippet() {
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
    if (!this.isTeacher) return;
    if (this.liveSyncTimer) {
      window.clearTimeout(this.liveSyncTimer);
    }
    this.liveSyncTimer = window.setTimeout(() => {
      this.publishLiveSync();
    }, 90);
  }

  private publishLiveSync(forceIncludeBody = false) {
    if (!this.isTeacher) return;
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

  private publishRender() {
    if (!this.isTeacher) return;
    this.publishLiveSync(true);

    const body = this.getCurrentBody();
    this.hasRenderedPreviewSnapshot = true;
    this.lastRenderedBody = body;
    this.onPublish({
      type: 'lilypond-render',
      body,
    });
    void this.renderLocally(body);
  }

  private async createMarkedLoader() {
    const previewWindow = window as MarkdownPreviewWindow;
    if (previewWindow.marked?.parse) return previewWindow.marked;
    if (previewWindow.__roomLilyMarkedPromise) return previewWindow.__roomLilyMarkedPromise;

    previewWindow.__roomLilyMarkedPromise = new Promise((resolve) => {
      const existing = document.querySelector('script[src*="marked"]');
      if (existing) {
        const poll = () => {
          if (previewWindow.marked) {
            resolve(previewWindow.marked);
            return;
          }
          window.setTimeout(poll, 40);
        };
        poll();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/marked@9/marked.min.js';
      script.onload = () => resolve(previewWindow.marked ?? null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });

    return previewWindow.__roomLilyMarkedPromise;
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
          suppressErrorRendering: false,
        });
        mermaid.run({ nodes });
        nodes.forEach((node) => {
          node.dataset.mermaidRendered = 'true';
        });
      } catch {
        // Keep markdown preview readable even if a diagram fails.
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

  private async requestLilyRender(source: string) {
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
        } satisfies LilyRenderResult;
      })
      .catch(() => null);

    this.lilyRenderCache.set(normalized, requestPromise);
    return requestPromise;
  }

  private buildLilyFigureMarkup(result: LilyRenderResult) {
    const midiAttr = result.midiUrl ? ` data-midi-url="${escapeHtml(result.midiUrl)}"` : '';
    return [
      `<figure class="lilypond-block lily-score" data-lily-url="${escapeHtml(result.url)}"${midiAttr}>`,
      `<img src="${escapeHtml(result.url)}" alt="LilyPond render" loading="lazy" />`,
      '</figure>',
    ].join('');
  }

  private rewriteMermaidCodeBlocks(container: HTMLElement) {
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>('pre > code.language-mermaid, pre > code.lang-mermaid'),
    );
    nodes.forEach((codeNode) => {
      const pre = codeNode.closest('pre');
      if (!pre) return;
      const mermaidNode = document.createElement('div');
      mermaidNode.className = 'mermaid';
      mermaidNode.dataset.mermaidSource = normalizeMermaidSource(codeNode.textContent || '');
      mermaidNode.textContent = mermaidNode.dataset.mermaidSource;
      pre.replaceWith(mermaidNode);
    });
  }

  private async rewriteLilyCodeBlocks(container: HTMLElement) {
    const nodes = Array.from(container.querySelectorAll<HTMLElement>(LILY_CODE_SELECTOR));
    if (nodes.length === 0) return;

    await Promise.all(nodes.map(async (codeNode) => {
      const pre = codeNode.closest('pre');
      if (!pre || pre.dataset.lilyStatus === 'done') return;

      const source = String(codeNode.textContent || '');
      if (!source.trim()) return;

      pre.dataset.lilyStatus = 'processing';
      const result = await this.requestLilyRender(source);
      if (!result || !pre.isConnected) {
        pre.dataset.lilyStatus = 'failed';
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.innerHTML = this.buildLilyFigureMarkup(result);
      const figure = wrapper.firstElementChild;
      if (!figure) return;

      pre.replaceWith(figure);
    }));
  }

  private async renderPreviewMarkup(body: string) {
    const source = String(body || '').replace(/\r\n?/g, '\n');
    if (!source.trim()) return '';

    if (looksLikePlainLilySource(source)) {
      const result = await this.requestLilyRender(source);
      if (result) return this.buildLilyFigureMarkup(result);
      return `<pre><code>${escapeHtml(source)}</code></pre>`;
    }

    const marked = await this.createMarkedLoader();
    const html = marked?.parse
      ? String(marked.parse(source))
      : `<pre><code>${escapeHtml(source)}</code></pre>`;

    const container = document.createElement('div');
    container.innerHTML = html;
    this.rewriteMermaidCodeBlocks(container);
    await this.rewriteLilyCodeBlocks(container);
    return container.innerHTML;
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
      const html = await this.renderPreviewMarkup(source);
      if (ticket !== this.renderNonce) return;
      this.previewEl.innerHTML = html;
      delete this.previewEl.dataset.loading;
      this.runMermaidIn(this.previewEl);
      this.hydrateRenderedLilyBlocks(this.previewEl);
    } catch (error: any) {
      if (ticket !== this.renderNonce) return;
      delete this.previewEl.dataset.loading;
      this.previewEl.innerHTML = `<div class="conference-lilypond-render-error">${escapeHtml(
        error?.message || 'No se pudo renderizar el contenido.',
      )}</div>`;
    }
  }
}
