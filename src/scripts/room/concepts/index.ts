import { type ConferenceMessage } from '../session';
import { loadMarked } from '../clase/controller';

export class ConceptsController {
  private searchIndex: any[] | null = null;
  private isLoading = false;
  private currentSlug: string | null = null;
  private currentFontSize = 100; // percent
  private isRevealMode = false;
  
  // Track bound elements for the active instance
  private currentContentEl: HTMLElement | null = null;
  private currentRevealFrame: HTMLIFrameElement | null = null;
  private currentToggleRevealBtn: HTMLElement | null = null;
  private currentPlaceholder: HTMLElement | null = null;

  constructor(private publish: (msg: ConferenceMessage) => void) {}

  private async ensureIndex() {
    if (this.searchIndex || this.isLoading) return;
    this.isLoading = true;
    try {
      const response = await fetch('/search-index.json');
      if (response.ok) {
        this.searchIndex = await response.json();
      }
    } catch (err) {
      console.error('Error loading search index:', err);
    } finally {
      this.isLoading = false;
    }
  }

  async search(query: string): Promise<any[]> {
    await this.ensureIndex();
    if (!this.searchIndex) return [];

    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) return [];

    return this.searchIndex.filter((item: any) => {
      const type = String(item.type || '').toLowerCase();
      const isPublic = item.isPublic === true;
      const isMatch = isPublic ||
                      type.includes('concept') || 
                      type.includes('glossary') || 
                      type.includes('lesson') || 
                      type.includes('note') || 
                      type.includes('contenido');
      
      if (!isMatch) return false;

      const q = normalizedQuery;
      return (item.title?.toLowerCase().includes(q) || 
              item.slug?.toLowerCase().includes(q));
    }).slice(0, 15);
  }

  bindElements(container: HTMLElement) {
    this.currentContentEl = container.querySelector<HTMLElement>('[data-concept-content]');
    this.currentPlaceholder = container.querySelector<HTMLElement>('[data-concept-placeholder]');
    this.currentRevealFrame = container.querySelector<HTMLIFrameElement>('[data-concept-presentation-frame]');
    this.currentToggleRevealBtn = container.querySelector<HTMLElement>('[data-concept-action="toggle-reveal"]');

    const input = container.querySelector('[data-concept-search]') as HTMLInputElement;
    const results = container.querySelector('[data-concept-results]') as HTMLElement;
    
    if (input && results) {
      this.bind({ input, results });
    }

    this.bindToolbar(container);
    this.bindScroll(container);
    
    // If we have a current slug, re-render it in the new content element
    if (this.currentSlug) {
        void this.load('/' + this.currentSlug, false);
    }
  }

  handleMessage(msg: ConferenceMessage) {
    if (msg.type === 'concept-load') {
      void this.load(msg.href, false);
    } else if (msg.type === 'concept-zoom') {
      this.currentFontSize = msg.level;
      this.applyZoom(false);
    } else if (msg.type === 'concept-reveal') {
      this.setRevealMode(msg.active, false);
    } else if (msg.type === 'concept-scroll') {
      this.applyScroll(msg.top, msg.left, false);
    }
  }

  async load(href: string, broadcast = false) {
    if (!this.currentContentEl) return;

    // Extract slug from href
    let slug = decodeURIComponent(href.split('?')[0]);
    if (slug.startsWith('/')) slug = slug.slice(1);
    
    this.currentSlug = slug;

    if (this.currentPlaceholder) this.currentPlaceholder.hidden = true;
    this.currentContentEl.innerHTML = `<p class="clase-placeholder">Cargando ${slug}…</p>`;
    
    // Reset view mode to markdown on new load
    this.isRevealMode = false;
    if (this.currentContentEl) this.currentContentEl.hidden = false;
    if (this.currentRevealFrame) {
      this.currentRevealFrame.hidden = true;
      this.currentRevealFrame.src = '';
    }

    try {
      const resp = await fetch(`/api/get-note-content?slug=${encodeURIComponent(slug)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      
      const parse = await loadMarked();
      const processedBody = (data.body || '').replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
      const html = parse ? (parse(processedBody) as string) : `<pre>${data.body}</pre>`;
      
      if (this.currentContentEl) {
        this.currentContentEl.innerHTML = html;
        this.currentContentEl.scrollTop = 0;
        this.applyZoom();
      }

      // Update reveal button visibility
      if (this.currentToggleRevealBtn) {
        this.currentToggleRevealBtn.hidden = !data.reveal;
        // Also prepare the iframe source if reveal is true
        if (data.reveal && this.currentRevealFrame) {
          this.currentRevealFrame.dataset.revealUrl = href.includes('/slides/') ? href : `/slides/${slug}`;
        }
      }

    } catch (err) {
      console.error('[concepts] load error', err);
      if (this.currentContentEl) {
        this.currentContentEl.innerHTML = `<p class="clase-placeholder">Error al cargar concepto: ${slug}</p>`;
      }
    }

    if (broadcast) {
      this.publish({
        type: 'concept-load',
        href
      });
    }
  }

  private applyZoom(broadcast = true) {
    if (this.currentContentEl) {
      this.currentContentEl.style.fontSize = `${this.currentFontSize / 100}rem`;
      this.currentContentEl.style.lineHeight = '1.6';
    }
    if (broadcast) {
      this.publish({ type: 'concept-zoom', level: this.currentFontSize });
    }
  }

  private setRevealMode(active: boolean, broadcast = true) {
    this.isRevealMode = active;
    if (this.currentContentEl) this.currentContentEl.hidden = this.isRevealMode;
    if (this.currentRevealFrame) {
      this.currentRevealFrame.hidden = !this.isRevealMode;
      if (this.isRevealMode && !this.currentRevealFrame.src && this.currentRevealFrame.dataset.revealUrl) {
        this.currentRevealFrame.src = this.currentRevealFrame.dataset.revealUrl;
      }
    }
    if (broadcast) {
      this.publish({ type: 'concept-reveal', active: this.isRevealMode });
    }
  }

  private applyScroll(top: number, left: number, broadcast = true) {
    if (this.currentContentEl) {
      this.currentContentEl.scrollTop = top;
      this.currentContentEl.scrollLeft = left;
    }
    if (broadcast) {
      this.publish({ type: 'concept-scroll', top, left });
    }
  }

  private bindScroll(container: HTMLElement) {
    const content = container.querySelector<HTMLElement>('[data-concept-content]');
    if (!content) return;

    let scrollTimeout: number;
    content.addEventListener('scroll', () => {
      window.clearTimeout(scrollTimeout);
      scrollTimeout = window.setTimeout(() => {
        this.applyScroll(content.scrollTop, content.scrollLeft, true);
      }, 150);
    }, { passive: true });
  }

  launch(href: string, mode: 'split' | 'overlay') {
    void this.load(href, true);

    if (mode === 'split') {
        this.publish({
            type: 'layout-split',
            left: 'presentation',
            right: 'concept'
        });
    } else {
        this.publish({
            type: 'layout-overlay',
            overlay: 'concept'
        });
    }
  }

  bind({
    input,
    results,
  }: {
    input: HTMLInputElement | null;
    results: HTMLElement | null;
  }) {
    if (!input || !results) return;

    const renderResults = async () => {
      const query = input.value;
      const matches = await this.search(query);
      
      results.innerHTML = '';
      results.hidden = matches.length === 0;

      matches.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'musiki-pod-result-item';
        btn.innerHTML = `<strong>${item.title}</strong> <small>${item.type}</small>`;
        btn.addEventListener('click', () => {
          let href = item.slug;
          if (!href.startsWith('/')) href = '/' + href;
          this.launch(href, 'split');
          results.hidden = true;
          input.value = '';
        });
        results.appendChild(btn);
      });
    };

    input.addEventListener('input', () => {
      void renderResults();
    });
  }

  private bindToolbar(container: HTMLElement) {
    const zoomInBtn = container.querySelector('[data-concept-action="zoom-in"]');
    const zoomOutBtn = container.querySelector('[data-concept-action="zoom-out"]');
    const zoomResetBtn = container.querySelector('[data-concept-action="zoom-reset"]');
    const toggleRevealBtn = container.querySelector('[data-concept-action="toggle-reveal"]');

    zoomInBtn?.addEventListener('click', () => {
      this.currentFontSize += 10;
      this.applyZoom();
    });

    zoomOutBtn?.addEventListener('click', () => {
      this.currentFontSize = Math.max(50, this.currentFontSize - 10);
      this.applyZoom();
    });

    zoomResetBtn?.addEventListener('click', () => {
      this.currentFontSize = 100;
      this.applyZoom();
    });

    toggleRevealBtn?.addEventListener('click', () => {
      this.setRevealMode(!this.isRevealMode, true);
    });
  }
}
