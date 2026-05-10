import type { ConferenceMessage } from '../session';

export type VisualKind = 'pdf' | 'img' | 'video';
export type VisualZoomMode = 'fit' | 'width' | 'actual' | 'custom';

export type VisualizerState = {
  url: string | null;
  name: string;
  kind: VisualKind | null;
  page: number;
  zoomMode: VisualZoomMode;
  zoom: number;
};

export type VisualizerOptions = {
  container: HTMLElement;
  publish?: (msg: ConferenceMessage) => void;
};

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/quicktime',
  'video/mp4',
  'video/webm',
];

const ACCEPTED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mov', '.mp4', '.webm'];

const emptyState = (): VisualizerState => ({
  url: null,
  name: '',
  kind: null,
  page: 1,
  zoomMode: 'fit',
  zoom: 100,
});

const extFromName = (value: string): string =>
  `.${String(value || '').split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() || ''}`;

const kindFromUrl = (url: string): VisualKind | null => {
  const ext = extFromName(url);
  if (ext === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'img';
  if (['.mov', '.mp4', '.webm'].includes(ext)) return 'video';
  return null;
};

const displayNameFromFile = (file: File): string =>
  file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || file.name || 'document';

export class VisualizerController {
  private container: HTMLElement;
  private publish?: (msg: ConferenceMessage) => void;
  private state: VisualizerState = emptyState();
  private localRole: 'teacher' | 'student' = 'student';
  private allowStudents = false;
  private domAbort = new AbortController();

  private podEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private frameEl!: HTMLIFrameElement;
  private imageEl!: HTMLImageElement;
  private videoEl!: HTMLVideoElement;
  private emptyEl!: HTMLElement;
  private pageInput!: HTMLInputElement;
  private zoomButtons: HTMLButtonElement[] = [];

  private onStateRequest: () => void;

  constructor(options: VisualizerOptions) {
    this.container = options.container;
    this.publish = options.publish;
    this.bindDOM();
    this.bindDropzone();

    this.onStateRequest = () => this.publishCurrentState();

    window.addEventListener('vs:request-state', this.onStateRequest);
  }

  public setRole(role: 'teacher' | 'student'): void {
    this.localRole = role;
  }

  public setAllowStudents(allow: boolean): void {
    this.allowStudents = allow;
  }

  public loadUrl(url: string, name = '', options: { publish?: boolean } = {}): void {
    const kind = kindFromUrl(url);
    if (!kind) return;
    this.state = {
      url,
      name: name || decodeURIComponent(url.split('/').pop() || 'document'),
      kind,
      page: 1,
      zoomMode: 'fit',
      zoom: 100,
    };
    this.render();
    if (options.publish !== false) this.publishState();
  }

  public applyRemoteState(next: Partial<VisualizerState>): void {
    const url = typeof next.url === 'string' && next.url ? next.url : null;
    const kind = next.kind === 'pdf' || next.kind === 'img' || next.kind === 'video' ? next.kind : (url ? kindFromUrl(url) : null);
    this.state = {
      url,
      name: typeof next.name === 'string' ? next.name : '',
      kind,
      page: Math.max(1, Math.round(Number(next.page) || 1)),
      zoomMode: this.normalizeZoomMode(next.zoomMode),
      zoom: this.clampZoom(Number(next.zoom) || 100),
    };
    this.render();
  }

  public publishCurrentState(): void {
    if (!this.canControl() || !this.state.url) return;
    this.publishState();
  }

  public dispose(): void {
    this.domAbort.abort();
    window.removeEventListener('vs:request-state', this.onStateRequest);
  }

  private bindDOM(): void {
    const sig = this.domAbort.signal;
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector<T>(sel)!;
    this.podEl = q('[data-vs-dropzone]');
    this.statusEl = q('[data-vs-status]');
    this.frameEl = q<HTMLIFrameElement>('[data-vs-frame]');
    this.imageEl = q<HTMLImageElement>('[data-vs-image]');
    this.videoEl = q<HTMLVideoElement>('[data-vs-video]');
    this.emptyEl = q('[data-vs-empty]');
    this.pageInput = q<HTMLInputElement>('[data-vs-page]');
    this.zoomButtons = Array.from(this.container.querySelectorAll<HTMLButtonElement>('[data-vs-zoom]'));

    q<HTMLButtonElement>('[data-vs-prev]').addEventListener('click', () => this.setPage(this.state.page - 1), { signal: sig });
    q<HTMLButtonElement>('[data-vs-next]').addEventListener('click', () => this.setPage(this.state.page + 1), { signal: sig });
    q<HTMLButtonElement>('[data-vs-full]').addEventListener('click', () => this.toggleFullscreen(), { signal: sig });
    this.pageInput.addEventListener('change', () => this.setPage(Number(this.pageInput.value) || 1), { signal: sig });
    this.pageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.setPage(Number(this.pageInput.value) || 1);
      }
    }, { signal: sig });
    this.zoomButtons.forEach((button) => {
      button.addEventListener('click', () => this.handleZoom(button.dataset.vsZoom || 'fit'), { signal: sig });
    });
    this.render();
  }

  private bindDropzone(): void {
    const sig = this.domAbort.signal;
    this.podEl.addEventListener('dragover', (event) => {
      if (!this.hasDraggingVisual(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
      this.podEl.classList.add('vs-pod--drag-over');
    }, { signal: sig });
    this.podEl.addEventListener('dragleave', (event) => {
      if (!this.podEl.contains(event.relatedTarget as Node)) this.podEl.classList.remove('vs-pod--drag-over');
    }, { signal: sig });
    this.podEl.addEventListener('drop', (event) => {
      event.preventDefault();
      this.podEl.classList.remove('vs-pod--drag-over');
      const file = this.extractVisualFile(event.dataTransfer);
      if (file) void this.loadFile(file);
    }, { signal: sig });
  }

  private async loadFile(file: File): Promise<void> {
    if (!this.canControl() || !this.isAcceptedFile(file)) return;
    this.statusEl.textContent = `uploading ${displayNameFromFile(file)}…`;
    const form = new FormData();
    form.append('file', file);
    try {
      const resp = await fetch('/api/room/re-store', { method: 'POST', body: form });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { url } = await resp.json();
      const name = displayNameFromFile(file);
      window.dispatchEvent(new CustomEvent('musiki:recursos:visual-uploaded', {
        detail: { url, name },
      }));
      this.loadUrl(url, name);
    } catch (error) {
      console.warn('[vS] upload error', error);
      this.statusEl.textContent = 'upload failed';
    }
  }

  private hasDraggingVisual(event: DragEvent): boolean {
    if (!event.dataTransfer) return false;
    return Array.from(event.dataTransfer.items).some((item) =>
      item.kind === 'file' && (ACCEPTED_TYPES.includes(item.type) || item.type === ''),
    );
  }

  private extractVisualFile(dataTransfer: DataTransfer | null): File | null {
    if (!dataTransfer) return null;
    return Array.from(dataTransfer.files).find((file) => this.isAcceptedFile(file)) ?? null;
  }

  private isAcceptedFile(file: File): boolean {
    const ext = extFromName(file.name);
    return ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTS.includes(ext);
  }

  private setPage(page: number): void {
    if (this.state.kind !== 'pdf') return;
    this.state.page = Math.max(1, Math.round(page || 1));
    this.render();
    this.publishState();
  }

  private handleZoom(action: string): void {
    if (!this.state.url) return;
    if (action === 'in' || action === 'out') {
      const delta = action === 'in' ? 25 : -25;
      this.state.zoom = this.clampZoom(this.state.zoom + delta);
      this.state.zoomMode = 'custom';
    } else {
      this.state.zoomMode = this.normalizeZoomMode(action);
      if (this.state.zoomMode === 'actual') this.state.zoom = 100;
    }
    this.render();
    this.publishState();
  }

  private toggleFullscreen(): void {
    this.podEl.dataset.fullscreen = this.podEl.dataset.fullscreen === 'true' ? 'false' : 'true';
  }

  private render(): void {
    const { url, kind } = this.state;
    this.podEl.dataset.kind = kind || 'empty';
    this.podEl.dataset.zoomMode = this.state.zoomMode;
    this.statusEl.textContent = url ? this.state.name || 'document' : 'waiting for document…';
    this.pageInput.value = String(this.state.page);
    this.zoomButtons.forEach((button) => {
      const zoom = button.dataset.vsZoom || '';
      const active = zoom === this.state.zoomMode || (zoom === 'actual' && this.state.zoomMode === 'custom' && this.state.zoom === 100);
      button.dataset.active = active ? 'true' : 'false';
    });

    if (!url || !kind) {
      this.frameEl.hidden = true;
      this.imageEl.hidden = true;
      this.videoEl.hidden = true;
      this.emptyEl.hidden = false;
      return;
    }

    this.emptyEl.hidden = true;
    if (kind === 'pdf') this.renderPdf(url);
    else if (kind === 'img') this.renderImage(url);
    else this.renderVideo(url);
  }

  private renderPdf(url: string): void {
    this.imageEl.hidden = true;
    this.videoEl.hidden = true;
    this.frameEl.hidden = false;
    this.frameEl.src = `${url}${url.includes('#') ? '&' : '#'}page=${this.state.page}&zoom=${this.pdfZoomFragment()}`;
  }

  private renderImage(url: string): void {
    this.frameEl.hidden = true;
    this.videoEl.hidden = true;
    this.imageEl.hidden = false;
    this.imageEl.src = url;
    this.imageEl.alt = this.state.name || 'visual resource';
    this.imageEl.style.setProperty('--vs-image-scale', String(this.state.zoomMode === 'custom' ? this.state.zoom / 100 : 1));
  }

  private renderVideo(url: string): void {
    this.frameEl.hidden = true;
    this.imageEl.hidden = true;
    this.videoEl.hidden = false;
    if (this.videoEl.getAttribute('src') !== url) this.videoEl.src = url;
    this.videoEl.title = this.state.name || 'video resource';
    this.videoEl.style.setProperty('--vs-image-scale', String(this.state.zoomMode === 'custom' ? this.state.zoom / 100 : 1));
  }

  private pdfZoomFragment(): string {
    if (this.state.zoomMode === 'fit') return 'page-fit';
    if (this.state.zoomMode === 'width') return 'page-width';
    return String(this.state.zoom);
  }

  private publishState(): void {
    if (!this.canControl()) return;
    this.publish?.({
      type: 'vs-state',
      url: this.state.url,
      name: this.state.name,
      kind: this.state.kind,
      page: this.state.page,
      zoomMode: this.state.zoomMode,
      zoom: this.state.zoom,
    });
  }

  private canControl(): boolean {
    return this.localRole === 'teacher' || this.allowStudents;
  }

  private normalizeZoomMode(value: unknown): VisualZoomMode {
    return value === 'width' || value === 'actual' || value === 'custom' ? value : 'fit';
  }

  private clampZoom(value: number): number {
    return Math.min(400, Math.max(25, Math.round(value || 100)));
  }
}
