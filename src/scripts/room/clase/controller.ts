type ClaseWindow = Window & {
  __claseMarkedPromise?: Promise<any>;
  marked?: { parse?: (markdown: string) => string };
};

export const loadMarked = async (): Promise<((md: string) => string) | null> => {
  const w = window as ClaseWindow;
  if (w.marked?.parse) return w.marked.parse;
  if (w.__claseMarkedPromise) return w.__claseMarkedPromise;

  w.__claseMarkedPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
    script.async = true;
    script.onload = () => {
      resolve(w.marked?.parse || null);
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return w.__claseMarkedPromise;
};

const splitSlides = (markdown: string): string[] => {
  if (!markdown) return [];
  // Use the same separator as Reveal: \n---\n
  return markdown
    .split(/\n---\n/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const stripCoverBlocks = (markdown: string) =>
  String(markdown || '')
    .replace(/<!--cover-->[\s\S]*?<!--\/cover-->/gi, '')
    .replace(/%%cover%%[\s\S]*?%%\/cover%%/gi, '')
    .replace(/^\s*(?:%%\/?cover%%|<!--\/?cover-->)\s*$/gim, '');

const escapeHtml = (unsafe: string) => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export type ClaseController = {
  bind: () => void;
};

export const createClaseController = ({
  contentEl,
  focusBtnEl,
}: {
  contentEl: HTMLElement | null;
  focusBtnEl?: HTMLElement | null;
  placeholderEl?: HTMLElement | null;
  sectionEl?: HTMLElement | null;
}): ClaseController => {
  let sections: string[] = [];
  let activeIndex = 0;
  let lastKnownRevealIndex = 0;
  let currentLessonId: string | null = null;

  const showPlaceholder = (msg?: string) => {
    if (!contentEl) return;
    contentEl.innerHTML = `<p class="clase-placeholder">${escapeHtml(msg ?? 'Seleccioná una clase en la barra inferior.')}</p>`;
  };

  const renderSections = async () => {
    if (!contentEl || sections.length === 0) return;

    const parse = await loadMarked();

    contentEl.innerHTML = sections
      .map((section, index) => {
        const processedSection = section.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
        const html = parse ? (parse(processedSection) as string) : `<pre>${escapeHtml(section)}</pre>`;
        const isActive = index === activeIndex;
        return [
          `<div class="clase-section${isActive ? ' is-active' : ''}" data-clase-index="${index}">${html}</div>`,
          index < sections.length - 1 ? '<hr class="clase-section-divider" />' : '',
        ].join('');
      })
      .join('');
  };

  const scrollToActive = () => {
    if (!contentEl) return;
    const active = contentEl.querySelector<HTMLElement>('.clase-section.is-active');
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const updateActiveIndex = (index: number, scroll = false) => {
    if (!contentEl) return;
    const clamped = Math.max(0, Math.min(index, sections.length - 1));
    
    if (clamped === activeIndex && contentEl.querySelector('.clase-section')) {
      contentEl.querySelectorAll<HTMLElement>('.clase-section').forEach((el) => {
        el.classList.toggle('is-active', Number(el.dataset.claseIndex) === clamped);
      });
      activeIndex = clamped;
      if (scroll) {
        scrollToActive();
      }
      return;
    }
    activeIndex = clamped;
    void renderSections().then(() => {
      if (scroll) {
        scrollToActive();
      }
    });
  };

  const loadLesson = async (lessonId: string) => {
    if (!contentEl) return;
    if (currentLessonId === lessonId) return;
    currentLessonId = lessonId;
    activeIndex = 0;

    contentEl.innerHTML = `<p class="clase-placeholder">Cargando…</p>`;

    try {
      const resp = await fetch(`/api/get-lesson-content?path=${encodeURIComponent(lessonId)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const raw = await resp.text();
      sections = splitSlides(stripCoverBlocks(raw));
      if (sections.length === 0) {
        showPlaceholder('Sin contenido de diapositivas.');
        return;
      }
      await renderSections();
      contentEl.scrollTop = 0;
    } catch (err) {
      console.error('[clase] load error', err);
      showPlaceholder('Error al cargar la clase.');
    }
  };

  const clearLesson = () => {
    currentLessonId = null;
    sections = [];
    activeIndex = 0;
    showPlaceholder();
  };

  const bind = () => {
    focusBtnEl?.addEventListener('click', () => {
      updateActiveIndex(lastKnownRevealIndex, true);
    });

    window.addEventListener('musiki:clase-presentation-changed', (e: Event) => {
      const ev = e as CustomEvent<{ lessonId: string | null }>;
      const lessonId = ev.detail?.lessonId ?? null;
      if (!lessonId) {
        clearLesson();
      } else {
        void loadLesson(lessonId);
      }
    });

    window.addEventListener('musiki:clase-slide-changed', (e: Event) => {
      const ev = e as CustomEvent<{ indexh: number }>;
      const indexh = Number(ev.detail?.indexh ?? 0);
      lastKnownRevealIndex = indexh;
      updateActiveIndex(indexh, true);
    });
  };

  return { bind };
};
