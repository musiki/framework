import { MESSAGE_TOPIC, type ConferenceMessage } from '../session';

export class ConceptsController {
  private searchIndex: any[] | null = null;
  private isLoading = false;

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

    return this.searchIndex.filter((item: any) => 
      (item.reveal === true) &&
      (item.title?.toLowerCase().includes(normalizedQuery) || 
       item.slug?.toLowerCase().includes(normalizedQuery))
    ).slice(0, 10);
  }

  load(href: string, broadcast = false) {
    const frame = document.querySelector<HTMLIFrameElement>('[data-concept-frame]');
    const placeholder = document.querySelector<HTMLElement>('[data-concept-placeholder]');
    if (frame) {
      frame.src = href;
      frame.hidden = false;
      if (placeholder) placeholder.hidden = true;
    }

    if (broadcast) {
      this.publish({
        type: 'concept-load',
        href
      });
    }
  }

  launch(href: string, mode: 'split' | 'overlay') {
    // 1. Load the concept in all clients
    this.load(href, true);

    // 2. Change layout
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
}
