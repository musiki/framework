import { type ConferenceMessage } from '../session';
import { loadMarked } from '../clase/controller';

export class ConceptsController {
  private searchIndex: any[] | null = null;
  private isLoading = false;
  private currentSlug: string | null = null;
  private currentFontSize = 100; // percent
  private isRevealMode = false;

  constructor(private publish: (msg: ConferenceMessage) => void) {}

  private async ensureIndex() {
    if (this.searchIndex || this.isLoading) return;
    this.isLoading = true;
    try {
      const response = await fetch('/search.json');
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

    return this.searchIndex.filter((item: any) => 
      (item.type === 'Concept' || item.type === 'Glossary' || item.type === 'Note' || item.type === 'Contenido') &&
      (item.title?.toLowerCase().includes(normalizedQuery) || 
       item.slug?.toLowerCase().includes(normalizedQuery))
    ).slice(0, 10);
  }

  async load(href: string, broadcast = false) {
    const contentEl = document.querySelector<HTMLElement>('[data-concept-content]');
    const placeholder = document.querySelector<HTMLElement>('[data-concept-placeholder]');
    const revealFrame = document.querySelector<HTMLIFrameElement>('[data-concept-presentation-frame]');
    const toggleRevealBtn = document.querySelector<HTMLElement>('[data-concept-action="toggle-reveal"]');
    
    if (!contentEl) return;

    // Extract slug from href
    let slug = href.split('?')[0];
    if (slug.startsWith('/')) slug = slug.slice(1);
    
    if (this.currentSlug === slug) return;
    this.currentSlug = slug;

    if (placeholder) placeholder.hidden = true;
    contentEl.innerHTML = `<p class="clase-placeholder">Cargando ${slug}…</p>`;
    
    // Reset view mode to markdown on new load
    this.isRevealMode = false;
    if (contentEl) contentEl.hidden = false;
    if (revealFrame) {
      revealFrame.hidden = true;
      revealFrame.src = '';
    }

    try {
      const resp = await fetch(`/api/get-note-content?slug=${encodeURIComponent(slug)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      
      const parse = await loadMarked();
      const html = parse ? (parse(data.body) as string) : `<pre>${data.body}</pre>`;
      
      contentEl.innerHTML = html;
      contentEl.scrollTop = 0;

      // Update reveal button visibility
      if (toggleRevealBtn) {
        toggleRevealBtn.hidden = !data.reveal;
        // Also prepare the iframe source if reveal is true
        if (data.reveal && revealFrame) {
          revealFrame.dataset.revealUrl = href.includes('/slides/') ? href : `/slides/${slug}`;
        }
      }

    } catch (err) {
      console.error('[concepts] load error', err);
      contentEl.innerHTML = `<p class="clase-placeholder">Error al cargar concepto: ${slug}</p>`;
    }

    if (broadcast) {
      this.publish({
        type: 'concept-load',
        href
      });
    }
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

  bindToolbar() {
    const zoomInBtn = document.querySelector('[data-concept-action="zoom-in"]');
    const zoomOutBtn = document.querySelector('[data-concept-action="zoom-out"]');
    const toggleRevealBtn = document.querySelector('[data-concept-action="toggle-reveal"]');
    const contentEl = document.querySelector<HTMLElement>('[data-concept-content]');
    const revealFrame = document.querySelector<HTMLIFrameElement>('[data-concept-presentation-frame]');

    zoomInBtn?.addEventListener('click', () => {
      this.currentFontSize += 10;
      if (contentEl) contentEl.style.fontSize = `${this.currentFontSize}%`;
    });

    zoomOutBtn?.addEventListener('click', () => {
      this.currentFontSize = Math.max(50, this.currentFontSize - 10);
      if (contentEl) contentEl.style.fontSize = `${this.currentFontSize}%`;
    });

    toggleRevealBtn?.addEventListener('click', () => {
      this.isRevealMode = !this.isRevealMode;
      if (contentEl) contentEl.hidden = this.isRevealMode;
      if (revealFrame) {
        revealFrame.hidden = !this.isRevealMode;
        if (this.isRevealMode && !revealFrame.src && revealFrame.dataset.revealUrl) {
          revealFrame.src = revealFrame.dataset.revealUrl;
        }
      }
    });
  }
}
