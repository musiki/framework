import { hydrateLilypondBlocks, setupLilypondAutoHydration } from '../../../lib/lilypond-player';
import { initStrudelBlocks } from '../strudel-blocks';

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
  __musikiCourseNotesLilypondReady?: boolean;
  __musikiCourseNotesMermaidContrastObserverReady?: boolean;
  hydrateLilypondBlocks?: (root?: HTMLElement | null) => Promise<void> | void;
  mermaid?: MermaidApi;
};

let courseMermaidRenderSequence = 0;

const MERMAID_DARK_TEXT = '#f8fafc';
const MERMAID_LIGHT_TEXT = '#111827';
const MERMAID_EDGE_COLOR = '#8dd9ff';
const MERMAID_EDGE_LABEL_BG = 'rgba(9, 14, 24, 0.92)';

if (typeof window !== 'undefined') {
  const courseWindow = window as CourseNotesWindow;
  courseWindow.hydrateLilypondBlocks = hydrateLilypondBlocks;
}

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

function isCourseNotesDarkMode(): boolean {
  const root = document.documentElement;
  return root.classList.contains('dark') || root.dataset.theme === 'dark';
}

function parseCssColor(value: string | null | undefined): { r: number; g: number; b: number; a: number } | null {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'none' || raw === 'transparent') return null;

  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    const parts = hex.length === 3 || hex.length === 4
      ? hex.split('').map((part) => part + part)
      : hex.match(/.{1,2}/g);
    if (!parts || (parts.length !== 3 && parts.length !== 4)) return null;
    const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseInt(part, 16));
    const alpha = parts[3] ? Number.parseInt(parts[3], 16) / 255 : 1;
    if ([r, g, b, alpha].some((part) => !Number.isFinite(part))) return null;
    return { r, g, b, a: alpha };
  }

  const rgbMatch = raw.match(/^rgba?\(([^)]+)\)$/);
  if (!rgbMatch) return null;
  const parts = rgbMatch[1].split(',').map((part) => part.trim());
  if (parts.length < 3) return null;
  const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
  const a = parts[3] ? Number.parseFloat(parts[3]) : 1;
  if ([r, g, b, a].some((part) => !Number.isFinite(part))) return null;
  return { r, g, b, a };
}

function relativeLuminance(color: { r: number; g: number; b: number }): number {
  const channel = (value: number) => {
    const normalized = Math.max(0, Math.min(255, value)) / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (0.2126 * channel(color.r)) + (0.7152 * channel(color.g)) + (0.0722 * channel(color.b));
}

function rememberInlineStyle(element: Element): CSSStyleDeclaration | null {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return null;
  if (element.dataset.musikiMermaidContrastStyle !== 'true') {
    element.dataset.musikiMermaidContrastStyle = 'true';
    element.dataset.musikiMermaidOriginalStyle = element.getAttribute('style') || '';
  }
  return element.style;
}

function setMermaidStyle(element: Element, property: string, value: string, priority = 'important'): void {
  const style = rememberInlineStyle(element);
  if (!style) return;
  style.setProperty(property, value, priority);
}

function restoreMermaidContrast(container: ParentNode): void {
  const queryRoot = getRenderableRoot(container);
  if (!queryRoot || typeof queryRoot.querySelectorAll !== 'function') return;
  queryRoot.querySelectorAll('[data-musiki-mermaid-contrast-style="true"]').forEach((element) => {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return;
    const original = element.dataset.musikiMermaidOriginalStyle || '';
    if (original) element.setAttribute('style', original);
    else element.removeAttribute('style');
    delete element.dataset.musikiMermaidContrastStyle;
    delete element.dataset.musikiMermaidOriginalStyle;
  });
}

function findMermaidShape(group: Element): SVGElement | null {
  const selectors = [
    ':scope > rect',
    ':scope > circle',
    ':scope > ellipse',
    ':scope > polygon',
    ':scope > path',
    'rect',
    'circle',
    'ellipse',
    'polygon',
    'path',
  ];

  for (const selector of selectors) {
    try {
      const shape = group.querySelector(selector);
      if (shape instanceof SVGElement && !shape.closest('.label, .nodeLabel, .edgeLabel')) {
        return shape;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function colorForMermaidGroup(group: Element): string {
  const shape = findMermaidShape(group);
  if (!shape) return MERMAID_DARK_TEXT;

  const computed = window.getComputedStyle(shape);
  const color = parseCssColor(computed.fill || shape.getAttribute('fill'));
  if (!color || color.a < 0.2) return MERMAID_DARK_TEXT;
  return relativeLuminance(color) > 0.55 ? MERMAID_LIGHT_TEXT : MERMAID_DARK_TEXT;
}

function applyMermaidTextColor(group: Element, color: string): void {
  const isLightText = color === MERMAID_DARK_TEXT;
  group.querySelectorAll('text, tspan, .label, .nodeLabel, .nodetext, .cluster-label, foreignObject, foreignObject *')
    .forEach((label) => {
      setMermaidStyle(label, 'fill', color);
      setMermaidStyle(label, 'color', color);
      setMermaidStyle(label, 'text-shadow', isLightText ? '0 1px 3px rgba(0, 0, 0, 0.55)' : 'none');
    });
}

function applyMermaidEdgeContrast(svg: SVGSVGElement): void {
  svg.querySelectorAll(
    '.edgePath .path, .flowchart-link, .messageLine0, .messageLine1, .relation, .transition',
  ).forEach((edge) => {
    setMermaidStyle(edge, 'stroke', MERMAID_EDGE_COLOR);
    setMermaidStyle(edge, 'stroke-width', '2.5px');
    setMermaidStyle(edge, 'filter', 'drop-shadow(0 0 3px rgba(141, 217, 255, 0.45))');
  });

  svg.querySelectorAll('.marker, .arrowheadPath, marker path').forEach((marker) => {
    setMermaidStyle(marker, 'fill', MERMAID_EDGE_COLOR);
    setMermaidStyle(marker, 'stroke', MERMAID_EDGE_COLOR);
  });

  svg.querySelectorAll('.edgeLabel, [id*="edgeLabel"]').forEach((label) => {
    setMermaidStyle(label, 'color', MERMAID_DARK_TEXT);
    setMermaidStyle(label, 'background-color', MERMAID_EDGE_LABEL_BG);
  });

  svg.querySelectorAll('.edgeLabel text, .edgeLabel tspan, .edgeLabel span, .edgeLabel p').forEach((label) => {
    setMermaidStyle(label, 'fill', MERMAID_DARK_TEXT);
    setMermaidStyle(label, 'color', MERMAID_DARK_TEXT);
    setMermaidStyle(label, 'text-shadow', 'none');
  });

  svg.querySelectorAll('.edgeLabel rect, .labelBkg, [id*="edgeLabel"] rect').forEach((background) => {
    setMermaidStyle(background, 'fill', MERMAID_EDGE_LABEL_BG);
    setMermaidStyle(background, 'stroke', 'none');
  });
}

export function applyCourseNotesMermaidContrast(container: ParentNode | null | undefined): void {
  const root = getRenderableRoot(container);
  if (!root || typeof root.querySelectorAll !== 'function') return;

  restoreMermaidContrast(root);
  if (!isCourseNotesDarkMode()) return;

  root.querySelectorAll('.mermaid svg').forEach((svg) => {
    if (!(svg instanceof SVGSVGElement)) return;
    applyMermaidEdgeContrast(svg);
    svg.querySelectorAll('.node, .cluster, .actor, .note, .loopLine, .stateGroup').forEach((group) => {
      applyMermaidTextColor(group, colorForMermaidGroup(group));
    });
  });
}

function setupCourseNotesMermaidContrastObserver(): void {
  const courseWindow = window as CourseNotesWindow;
  if (courseWindow.__musikiCourseNotesMermaidContrastObserverReady) return;
  courseWindow.__musikiCourseNotesMermaidContrastObserverReady = true;

  let frameId = 0;
  const refresh = () => {
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = window.requestAnimationFrame(() => {
      frameId = 0;
      applyCourseNotesMermaidContrast(document.body);
    });
  };

  new MutationObserver(refresh).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  });
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
        applyCourseNotesMermaidContrast(node);
      });

      Promise.all(tasks)
        .then(() => applyCourseNotesMermaidContrast(container))
        .catch((error) => {
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
  if (!courseWindow.__musikiCourseNotesLilypondReady) {
    courseWindow.hydrateLilypondBlocks = hydrateLilypondBlocks;
    setupLilypondAutoHydration();
    courseWindow.__musikiCourseNotesLilypondReady = true;
  }

  const root = getRenderableRoot(container);
  const hydrationRoot = root instanceof HTMLElement ? root : document.body;
  void courseWindow.hydrateLilypondBlocks?.(hydrationRoot);
}

export function enhanceCourseNotesContent(container: ParentNode | null | undefined): void {
  const root = getRenderableRoot(container);
  if (!root) return;
  setupCourseNotesMermaidContrastObserver();
  renderCourseNotesMermaid(root);
  applyCourseNotesMermaidContrast(root);
  hydrateCourseNotesLilypond(root);
  initStrudelBlocks(root);
}
