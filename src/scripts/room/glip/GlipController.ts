export type GlipAnnotationItem = {
  id: string;
  title: string;
  work?: string;
  composer?: string;
  year?: number;
  tags?: string[];
  performer?: string;
  provider?: string;
  url?: string;
  thumbnail?: string;
  clip?: { in: number; out: number | null };
  shapeCount?: number;
  updated?: string;
};

export type GlipSessionState = {
  annotationId: string;
  title?: string;
  url?: string;
};

export type GlipControllerOptions = {
  container: HTMLElement;
  publish?: (msg: any) => void;
  canLead?: () => boolean;
  onShareToRecursos?: (item: { url: string; name: string }) => void;
};

const GLIP_HOST = 'https://glip.zztt.org';

export class GlipController {
  private container: HTMLElement;
  private publish?: (msg: any) => void;
  private canLead: () => boolean;
  private onShareToRecursos?: (item: { url: string; name: string }) => void;

  private frameContainer: HTMLElement | null = null;
  private frame: HTMLIFrameElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private openBtn: HTMLButtonElement | null = null;
  private extBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private listBtn: HTMLButtonElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  private activeSession: GlipSessionState | null = null;
  private cachedAnnotations: GlipAnnotationItem[] = [];
  private debounceTimer = 0;
  private isDestroyed = false;

  constructor(options: GlipControllerOptions) {
    this.container = options.container;
    this.publish = options.publish;
    this.canLead = options.canLead ?? (() => true);
    this.onShareToRecursos = options.onShareToRecursos;

    this.initElements();
    this.bindEvents();
    this.fetchAnnotations();
  }

  private initElements() {
    this.frameContainer = this.container.querySelector('[data-glip-frame-container]');
    this.frame = this.container.querySelector('[data-glip-frame]');
    this.emptyEl = this.container.querySelector('[data-glip-empty]');
    this.input = this.container.querySelector('[data-glip-input]');
    this.openBtn = this.container.querySelector('[data-action="glip-open"]');
    this.extBtn = this.container.querySelector('[data-action="glip-ext"]');
    this.stopBtn = this.container.querySelector('[data-action="glip-stop"]');
    this.listBtn = this.container.querySelector('[data-action="glip-list-toggle"]');
    this.resultsEl = this.container.querySelector('[data-glip-results]');
    this.statusEl = this.container.querySelector('[data-glip-status]');
  }

  private bindEvents() {
    this.input?.addEventListener('input', () => {
      this.handleInput(this.input?.value || '');
    });

    this.input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.openFromInput();
      } else if (e.key === 'Escape') {
        this.hideResults();
      }
    });

    this.openBtn?.addEventListener('click', () => {
      this.openFromInput();
    });

    this.listBtn?.addEventListener('click', () => {
      if (this.resultsEl && !this.resultsEl.hidden) {
        this.hideResults();
      } else {
        this.renderResults(this.cachedAnnotations);
      }
    });

    this.extBtn?.addEventListener('click', () => {
      if (this.activeSession?.annotationId) {
        window.open(`${GLIP_HOST}/annotate/${this.activeSession.annotationId}`, '_blank');
      } else {
        window.open(GLIP_HOST, '_blank');
      }
    });

    this.stopBtn?.addEventListener('click', () => {
      this.closeSession('local');
    });

    // Close dropdown when clicking outside
    document.addEventListener('pointerdown', (e) => {
      if (!this.container.contains(e.target as Node)) {
        this.hideResults();
      }
    });
  }

  private async fetchAnnotations(): Promise<GlipAnnotationItem[]> {
    try {
      const res = await fetch(`${GLIP_HOST}/api/annotations`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          this.cachedAnnotations = data;
          return data;
        }
      }
    } catch {
      // offline or unreachable
    }
    return [];
  }

  private handleInput(val: string) {
    const query = val.trim().toLowerCase();
    window.clearTimeout(this.debounceTimer);
    if (!query) {
      this.hideResults();
      return;
    }

    // Check if it's a direct URL
    if (query.includes('glip.zztt.org')) {
      this.hideResults();
      return;
    }

    this.debounceTimer = window.setTimeout(async () => {
      if (this.cachedAnnotations.length === 0) {
        await this.fetchAnnotations();
      }
      const filtered = this.cachedAnnotations.filter((a) => {
        const text = [a.title, a.work, a.composer, a.performer, ...(a.tags || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return text.includes(query);
      });
      this.renderResults(filtered);
    }, 180);
  }

  private renderResults(items: GlipAnnotationItem[]) {
    if (!this.resultsEl) return;
    this.resultsEl.innerHTML = '';
    if (items.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.style.padding = '8px 12px';
      emptyMsg.style.fontSize = '0.72rem';
      emptyMsg.style.color = '#94a3b8';
      emptyMsg.textContent = 'No se encontraron anotaciones.';
      this.resultsEl.appendChild(emptyMsg);
      this.resultsEl.hidden = false;
      return;
    }

    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'glip-pod-result-item';

      const thumb = document.createElement('img');
      thumb.className = 'glip-pod-result-thumb';
      thumb.src = item.thumbnail || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      thumb.alt = '';

      const info = document.createElement('div');
      info.className = 'glip-pod-result-info';

      const title = document.createElement('div');
      title.className = 'glip-pod-result-title';
      title.textContent = item.title || item.work || item.id;

      const meta = document.createElement('div');
      meta.className = 'glip-pod-result-meta';
      const parts = [item.composer, item.performer, item.year ? String(item.year) : '']
        .filter(Boolean)
        .join(' · ');
      meta.textContent = parts || `Anotación #${item.id}`;

      info.append(title, meta);
      btn.append(thumb, info);

      btn.addEventListener('click', () => {
        this.openAnnotation(item.id, item.title, 'local');
        this.hideResults();
        if (this.input) this.input.value = item.title;
      });

      this.resultsEl?.appendChild(btn);
    });

    this.resultsEl.hidden = false;
  }

  private hideResults() {
    if (this.resultsEl) this.resultsEl.hidden = true;
  }

  private extractId(inputVal: string): string {
    const val = inputVal.trim();
    if (!val) return '';
    // If it's a URL like https://glip.zztt.org/embed/xyz or /annotate/xyz
    const urlMatch = val.match(/(?:embed|annotate)\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];
    // If entered directly as ID or search
    return val;
  }

  private openFromInput() {
    const val = this.input?.value.trim() || '';
    if (!val) return;
    const id = this.extractId(val);
    const item = this.cachedAnnotations.find((a) => a.id === id);
    const title = item?.title || id;
    this.openAnnotation(id, title, 'local');
    this.hideResults();
  }

  public openAnnotation(id: string, title?: string, source: 'local' | 'remote' = 'local') {
    if (!id) return;
    this.activeSession = {
      annotationId: id,
      title: title || id,
      url: `${GLIP_HOST}/embed/${id}`,
    };

    if (this.frame) {
      this.frame.src = `${GLIP_HOST}/embed/${id}`;
    }
    if (this.frameContainer) this.frameContainer.hidden = false;
    if (this.emptyEl) this.emptyEl.hidden = true;

    if (source === 'local') {
      if (this.canLead() && this.publish) {
        this.publish({
          type: 'glip-state',
          action: 'open',
          annotationId: id,
          title: this.activeSession.title,
        });
      }
      this.onShareToRecursos?.({
        url: `${GLIP_HOST}/embed/${id}`,
        name: `GLIP: ${this.activeSession.title}`,
      });
      window.dispatchEvent(
        new CustomEvent('musiki:recursos:external-media', {
          detail: {
            url: `${GLIP_HOST}/embed/${id}`,
            name: `GLIP: ${this.activeSession.title}`,
          },
        })
      );
    }
  }

  public closeSession(source: 'local' | 'remote' = 'local') {
    this.activeSession = null;
    if (this.frame) this.frame.src = 'about:blank';
    if (this.frameContainer) this.frameContainer.hidden = true;
    if (this.emptyEl) this.emptyEl.hidden = false;
    if (this.input) this.input.value = '';
    this.hideResults();

    if (source === 'local') {
      if (this.canLead() && this.publish) {
        this.publish({
          type: 'glip-state',
          action: 'close',
        });
      }
    }
  }

  public handleRemoteMessage(msg: any) {
    if (msg.type !== 'glip-state') return;
    if (msg.action === 'close') {
      this.closeSession('remote');
    } else if (msg.action === 'open' && msg.annotationId) {
      this.openAnnotation(msg.annotationId, msg.title, 'remote');
    }
  }

  public dispose() {
    this.isDestroyed = true;
    if (this.frame) this.frame.src = 'about:blank';
  }
}
