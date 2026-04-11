type ClaseWindow = Window & {
  __claseMarkedPromise?: Promise<any>;
  marked?: { parse?: (markdown: string) => string };
};

const loadMarked = async (): Promise<((md: string) => string) | null> => {
  const w = window as ClaseWindow;
  if (typeof w.marked?.parse === 'function') return w.marked.parse.bind(w.marked);

  if (!w.__claseMarkedPromise) {
    w.__claseMarkedPromise = new Promise<any>((resolve) => {
      // Reuse the script tag if notes panel already added it
      const existing = document.querySelector<HTMLScriptElement>('script[src*="marked"]');
      if (existing) {
        if (w.marked?.parse) { resolve(w.marked); return; }
        existing.addEventListener('load', () => resolve(w.marked ?? null), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/marked@9/marked.min.js';
      script.onload = () => resolve(w.marked ?? null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }

  await w.__claseMarkedPromise;
  const parseFn = (w.marked as any)?.parse;
  return typeof parseFn === 'function' ? (parseFn as (md: string) => string).bind(w.marked) : null;
};

// Strip YAML frontmatter from raw markdown body
const stripFrontmatter = (raw: string): string => {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) return raw;
  const rest = trimmed.slice(3);
  const endIdx = rest.search(/^---/m);
  if (endIdx === -1) return raw;
  return rest.slice(endIdx + 3).replace(/^\r?\n/, '');
};

// Split markdown by horizontal-rule slide separators (--- on own line)
const splitSlides = (raw: string): string[] => {
  const body = stripFrontmatter(raw);
  // Match --- or *** or ___ as slide separators (Reveal.js default)
  return body.split(/\n[ \t]*(?:---|___|\*\*\*)[ \t]*\n/).map((s) => s.trim()).filter(Boolean);
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type ClaseController = {
  bind: () => void;
};

export const createClaseController = ({
  contentEl,
}: {
  contentEl: HTMLElement | null;
  placeholderEl?: HTMLElement | null;
  sectionEl?: HTMLElement | null;
}): ClaseController => {
  let sections: string[] = [];
  let activeIndex = 0;
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
        const html = parse ? (parse(section) as string) : `<pre>${escapeHtml(section)}</pre>`;
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

  const updateActiveIndex = (index: number) => {
    if (!contentEl) return;
    const clamped = Math.max(0, Math.min(index, sections.length - 1));
    if (clamped === activeIndex && contentEl.querySelector('.clase-section')) {
      // Already rendered — just toggle classes
      contentEl.querySelectorAll<HTMLElement>('.clase-section').forEach((el) => {
        el.classList.toggle('is-active', Number(el.dataset.claseIndex) === clamped);
      });
      activeIndex = clamped;
      scrollToActive();
      return;
    }
    activeIndex = clamped;
    void renderSections().then(() => scrollToActive());
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
      sections = splitSlides(raw);
      if (sections.length === 0) {
        showPlaceholder('Sin contenido de diapositivas.');
        return;
      }
      await renderSections();
      scrollToActive();
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
      updateActiveIndex(indexh);
    });
  };

  return { bind };
};
