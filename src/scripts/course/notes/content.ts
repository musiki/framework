type MermaidRenderResult = {
  svg?: string;
  bindFunctions?: (element: Element) => void;
};

type MermaidApi = {
  initialize?: (options: Record<string, unknown>) => void;
  render?: (id: string, source: string) => Promise<MermaidRenderResult> | MermaidRenderResult;
};

type CourseNotesWindow = Window & {
  __musikiCourseNotesMermaidPromise?: Promise<MermaidApi | null>;
  hydrateLilypondBlocks?: (root?: ParentNode | null) => void;
  mermaid?: MermaidApi;
};

let courseMermaidRenderSequence = 0;

export function ensureCourseNotesMermaid(): Promise<MermaidApi | null> {
  const courseWindow = window as CourseNotesWindow;
  if (courseWindow.mermaid?.render) {
    return Promise.resolve(courseWindow.mermaid);
  }

  if (courseWindow.__musikiCourseNotesMermaidPromise) {
    return courseWindow.__musikiCourseNotesMermaidPromise;
  }

  courseWindow.__musikiCourseNotesMermaidPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[data-musiki-mermaid-loader="true"]');
    if (existing instanceof HTMLScriptElement) {
      existing.addEventListener('load', () => resolve(courseWindow.mermaid || null), { once: true });
      existing.addEventListener('error', () => resolve(null), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.defer = true;
    script.dataset.musikiMermaidLoader = 'true';
    script.onload = () => resolve(courseWindow.mermaid || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return courseWindow.__musikiCourseNotesMermaidPromise;
}

function getRenderableRoot(container: ParentNode | null | undefined): ParentNode | null {
  if (!container) return null;
  if (
    container instanceof HTMLElement
    || container instanceof SVGElement
    || container instanceof Document
    || container instanceof DocumentFragment
  ) {
    return container;
  }
  return null;
}

function collectCourseMermaidNodes(container: ParentNode): HTMLElement[] {
  const queryRoot = getRenderableRoot(container);
  if (!queryRoot || typeof queryRoot.querySelectorAll !== 'function') return [];

  return Array.from(queryRoot.querySelectorAll('.mermaid'))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((node) => !node.closest('#lesson-forum'))
    .filter(
      (node) =>
        node.dataset.mermaidRendered !== 'true'
        && node.dataset.mermaidRendering !== 'true',
    );
}

export function renderCourseNotesMermaid(container: ParentNode, attempt = 0): void {
  const nodes = collectCourseMermaidNodes(container);
  if (nodes.length === 0) return;

  ensureCourseNotesMermaid()
    .then((mermaid) => {
      if (!mermaid?.render) return;

      try {
        mermaid.initialize?.({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          suppressErrorRendering: false,
        });
      } catch {
        // ignore duplicate mermaid initialization
      }

      const tasks = nodes.map(async (node) => {
        const source = String(node.dataset.mermaidSource || node.textContent || '').trim();
        if (!source) return;

        node.dataset.mermaidSource = source;
        node.dataset.mermaidRendering = 'true';
        const renderId = `course-mermaid-${Date.now()}-${courseMermaidRenderSequence += 1}`;
        const result = await mermaid.render?.(renderId, source);
        node.innerHTML = result?.svg || '';
        if (typeof result?.bindFunctions === 'function') {
          result.bindFunctions(node);
        }
        delete node.dataset.mermaidRendering;
        node.dataset.mermaidRendered = 'true';
      });

      Promise.all(tasks).catch((error) => {
        nodes.forEach((node) => {
          delete node.dataset.mermaidRendering;
          delete node.dataset.mermaidRendered;
          const source = String(node.dataset.mermaidSource || node.textContent || '').trim();
          if (source) node.textContent = source;
        });

        if (attempt < 3) {
          window.setTimeout(() => renderCourseNotesMermaid(container, attempt + 1), 180 * (attempt + 1));
        } else {
          console.error('Course mermaid render error:', error);
        }
      });
    })
    .catch((error) => {
      console.error('Course mermaid loader error:', error);
    });
}

export function hydrateCourseNotesLilypond(container: ParentNode | null | undefined): void {
  const courseWindow = window as CourseNotesWindow;
  if (typeof courseWindow.hydrateLilypondBlocks !== 'function') return;

  const root = getRenderableRoot(container) || document.body;
  courseWindow.hydrateLilypondBlocks(root);
}

export function enhanceCourseNotesContent(container: ParentNode | null | undefined): void {
  const root = getRenderableRoot(container);
  if (!root) return;
  renderCourseNotesMermaid(root);
  hydrateCourseNotesLilypond(root);
}
