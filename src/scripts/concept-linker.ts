/**
 * Wikipedia-style concept/glossary linker
 */

interface ConceptIndexEntry {
  id: string;
  title: string;
  slug: string;
  type: 'concept' | 'glossary';
  description: string;
  firstParagraph: string;
}

interface ConceptLookup {
  term: string;
  slug: string;
  type: 'concept' | 'glossary';
}

interface ConceptData {
  index: ConceptIndexEntry[];
  lookup: ConceptLookup[];
}

let cachedData: ConceptData | null = null;

const fetchConceptData = async (): Promise<ConceptData | null> => {
  if (cachedData) return cachedData;
  try {
    const resp = await fetch('/api/internal/concepts.json');
    if (!resp.ok) return null;
    cachedData = await resp.json();
    return cachedData;
  } catch (e) {
    console.error('[ConceptLinker] failed to fetch index', e);
    return null;
  }
};

const injectStyles = () => {
  if (document.getElementById('musiki-concept-styles')) return;
  const style = document.createElement('style');
  style.id = 'musiki-concept-styles';
  style.innerHTML = `
    .musiki-concept-link {
      text-decoration: none;
      border-bottom: 1.5px dashed var(--c-accent-orange, #ff7b00);
      cursor: help;
      color: inherit;
    }
    .musiki-glossary-link {
      text-decoration: none;
      border-bottom: 1.5px dashed var(--c-accent-blue, #007bff);
      cursor: help;
      color: inherit;
    }
    
    .musiki-concept-popup {
      position: fixed;
      z-index: 10000;
      width: 320px;
      background: var(--c-bg, #1a1a1a);
      border: 1px solid var(--c-border, #333);
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      padding: 1rem;
      font-size: 0.9rem;
      line-height: 1.4;
      pointer-events: none;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.2s ease, transform 0.2s ease;
      color: var(--c-fg, #eee);
    }
    
    .musiki-concept-popup.is-active {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    
    .musiki-concept-popup-title {
      font-weight: bold;
      font-size: 1.1rem;
      margin-bottom: 0.5rem;
      display: block;
      color: var(--c-primary, #fff);
      text-decoration: none;
    }
    
    .musiki-concept-popup-title:hover {
      text-decoration: underline;
    }
    
    .musiki-concept-popup-content {
      margin-bottom: 0.5rem;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    
    .musiki-concept-popup-more {
      font-size: 0.8rem;
      color: var(--c-accent, #7b68ee);
      text-decoration: none;
    }
    
    .musiki-concept-shade {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.3);
      backdrop-filter: blur(2px);
      z-index: 9999;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    
    .musiki-concept-shade.is-active {
      opacity: 1;
    }
  `;
  document.head.appendChild(style);
};

export const setupConceptLinks = async (container: HTMLElement = document.body) => {
  const data = await fetchConceptData();
  if (!data || !data.lookup.length) return;

  injectStyles();

  const paragraphs = container.querySelectorAll('p, .clase-section');
  const indexBySlug = new Map(data.index.map(item => [item.slug, item]));

  // Create popup elements
  let popup = document.querySelector('.musiki-concept-popup') as HTMLElement;
  let shade = document.querySelector('.musiki-concept-shade') as HTMLElement;

  if (!popup) {
    popup = document.createElement('div');
    popup.className = 'musiki-concept-popup';
    document.body.appendChild(popup);
  }

  if (!shade) {
    shade = document.createElement('div');
    shade.className = 'musiki-concept-shade';
    document.body.appendChild(shade);
  }

  let hideTimeout: any = null;

  const showPopup = (slug: string, anchor: HTMLElement) => {
    const info = indexBySlug.get(slug);
    if (!info) return;

    clearTimeout(hideTimeout);
    
    popup.innerHTML = `
      <a href="/${info.slug}" class="musiki-concept-popup-title">${info.title}</a>
      <div class="musiki-concept-popup-content">${info.firstParagraph || info.description}</div>
      <a href="/${info.slug}" class="musiki-concept-popup-more">Leer más...</a>
    `;

    const rect = anchor.getBoundingClientRect();
    let top = rect.bottom + 10;
    let left = rect.left + rect.width / 2 - 160;

    // Boundary checks
    if (left < 10) left = 10;
    if (left + 320 > window.innerWidth) left = window.innerWidth - 330;
    if (top + 200 > window.innerHeight) {
        top = rect.top - popup.offsetHeight - 10;
    }

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    popup.classList.add('is-active');
    shade.classList.add('is-active');
  };

  const hidePopup = () => {
    hideTimeout = setTimeout(() => {
        popup.classList.remove('is-active');
        shade.classList.remove('is-active');
    }, 300);
  };

  popup.onmouseenter = () => clearTimeout(hideTimeout);
  popup.onmouseleave = hidePopup;

  for (const p of Array.from(paragraphs)) {
    // Avoid double processing or processing specific areas
    if ((p as HTMLElement).dataset.conceptsProcessed) continue;
    if (p.closest('.no-concepts')) continue;

    let html = p.innerHTML;
    const matchedSlugs = new Set<string>();

    // We process each paragraph. For each term in lookup, we replace ONLY the first occurrence
    for (const item of data.lookup) {
      if (matchedSlugs.has(item.slug)) continue;

      // Relaxed regex: match whole word, case insensitive
      // Escape term for regex
      const escapedTerm = item.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b(${escapedTerm})\\b`, 'i');
      
      // Check if term exists in text (excluding inside tags)
      // This is a naive approach, a true DOM walker would be better but slower
      const textOnly = p.textContent || '';
      if (!regex.test(textOnly)) continue;

      // Better approach: only replace if not inside a tag
      // This is tricky with regex on innerHTML. 
      // Let's use a simpler marker strategy
      
      const parts = html.split(/(<[^>]*>)/);
      let replaced = false;
      for (let i = 0; i < parts.length; i++) {
        if (!parts[i].startsWith('<')) { // Text part
          if (!replaced && regex.test(parts[i])) {
            parts[i] = parts[i].replace(regex, (match) => {
                replaced = true;
                matchedSlugs.add(item.slug);
                const className = item.type === 'concept' ? 'musiki-concept-link' : 'musiki-glossary-link';
                return `<span class="${className}" data-concept-slug="${item.slug}">${match}</span>`;
            });
          }
        }
      }
      html = parts.join('');
    }

    p.innerHTML = html;
    (p as HTMLElement).dataset.conceptsProcessed = 'true';

    // Add listeners to new spans
    p.querySelectorAll('[data-concept-slug]').forEach(span => {
        (span as HTMLElement).onmouseenter = () => showPopup((span as HTMLElement).dataset.conceptSlug!, span as HTMLElement);
        (span as HTMLElement).onmouseleave = hidePopup;
    });
  }
};
