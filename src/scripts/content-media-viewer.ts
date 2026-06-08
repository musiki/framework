type ViewerCleanup = () => void;

type ViewerElements = {
  modal: HTMLElement;
  stage: HTMLElement;
  viewport: HTMLElement;
  content: HTMLElement;
  closeButton: HTMLButtonElement;
  controls: HTMLButtonElement[];
};

type Point = {
  x: number;
  y: number;
};

const STYLE_ID = 'musiki-content-media-viewer-style';
const MODAL_ID = 'musiki-content-media-viewer-modal';
const STAGE_ID = 'musiki-content-media-viewer-stage';
const VIEWPORT_ID = 'musiki-content-media-viewer-viewport';
const CONTENT_ID = 'musiki-content-media-viewer-content';
const CLOSE_ID = 'musiki-content-media-viewer-close';
const MAX_SCALE = 10;
const MIN_SCALE = 1;

function injectViewerStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .content-media-modal {
      position: fixed;
      inset: 0;
      z-index: 140;
      display: grid;
      place-items: center;
      background: rgba(0, 0, 0, 0.92);
      padding: 1rem;
    }
    .content-media-modal[hidden] { display: none; }
    .content-media-modal-stage {
      position: relative;
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .content-media-modal-close,
    .content-media-modal-control {
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(12, 14, 18, 0.72);
      color: rgba(255, 255, 255, 0.9);
      font: inherit;
      line-height: 1;
      cursor: pointer;
    }
    .content-media-modal-close {
      position: absolute;
      top: 0.8rem;
      right: 0.8rem;
      z-index: 2;
      width: 2.35rem;
      height: 2.35rem;
      border-radius: 999px;
      font-size: 1.65rem;
    }
    .content-media-modal-controls {
      position: absolute;
      left: 50%;
      bottom: 1rem;
      z-index: 2;
      display: flex;
      gap: 0.4rem;
      transform: translateX(-50%);
    }
    .content-media-modal-control {
      min-width: 2.25rem;
      height: 2.1rem;
      border-radius: 6px;
      padding: 0 0.7rem;
      font-size: 0.95rem;
    }
    .content-media-modal-viewport {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      overflow: hidden;
      cursor: grab;
      touch-action: none;
    }
    .content-media-modal-viewport.is-dragging { cursor: grabbing; }
    .content-media-modal-content {
      display: grid;
      place-items: center;
      max-width: 94vw;
      max-height: 88vh;
      transform-origin: center center;
      will-change: transform;
      user-select: none;
    }
    .content-media-modal-content img,
    .content-media-modal-content svg {
      display: block;
      max-width: 94vw;
      max-height: 88vh;
      width: auto;
      height: auto;
      user-select: none;
      -webkit-user-drag: none;
    }
    .content-media-modal-content .mermaid {
      display: block;
      max-width: none;
      margin: 0;
      padding: 0;
      background: transparent;
    }
    .content-media-modal-content .mermaid svg {
      max-width: none;
      max-height: 88vh;
    }
    [data-content-media-viewer-source='true'] {
      cursor: zoom-in;
    }
    a [data-content-media-viewer-source='true'],
    button [data-content-media-viewer-source='true'] {
      cursor: inherit;
    }
  `;
  document.head.appendChild(style);
}

function createModal(): ViewerElements {
  const modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.className = 'content-media-modal';
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div id="${STAGE_ID}" class="content-media-modal-stage" role="dialog" aria-modal="true" aria-label="Media ampliado">
      <button id="${CLOSE_ID}" class="content-media-modal-close" type="button" aria-label="Cerrar" title="Cerrar">×</button>
      <div id="${VIEWPORT_ID}" class="content-media-modal-viewport">
        <div id="${CONTENT_ID}" class="content-media-modal-content"></div>
      </div>
      <div class="content-media-modal-controls" aria-label="Controles de zoom">
        <button class="content-media-modal-control" type="button" data-content-media-zoom="out" aria-label="Alejar" title="Alejar">−</button>
        <button class="content-media-modal-control" type="button" data-content-media-zoom="reset" aria-label="Restablecer zoom" title="Restablecer zoom">1:1</button>
        <button class="content-media-modal-control" type="button" data-content-media-zoom="in" aria-label="Acercar" title="Acercar">+</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return getViewerElements()!;
}

function getViewerElements(): ViewerElements | null {
  const modal = document.getElementById(MODAL_ID);
  const stage = document.getElementById(STAGE_ID);
  const viewport = document.getElementById(VIEWPORT_ID);
  const content = document.getElementById(CONTENT_ID);
  const closeButton = document.getElementById(CLOSE_ID);
  const controls = modal instanceof HTMLElement
    ? Array.from(modal.querySelectorAll<HTMLButtonElement>('[data-content-media-zoom]'))
    : [];

  if (
    !(modal instanceof HTMLElement) ||
    !(stage instanceof HTMLElement) ||
    !(viewport instanceof HTMLElement) ||
    !(content instanceof HTMLElement) ||
    !(closeButton instanceof HTMLButtonElement)
  ) {
    return null;
  }

  return { modal, stage, viewport, content, closeButton, controls };
}

function getOrCreateViewerElements(): ViewerElements {
  injectViewerStyles();
  return getViewerElements() || createModal();
}

function cloneSvg(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.style.maxWidth = '94vw';
  clone.style.maxHeight = '88vh';
  clone.style.width = 'auto';
  clone.style.height = 'auto';
  return clone;
}

function cloneImage(image: HTMLImageElement) {
  const clone = document.createElement('img');
  clone.src = image.currentSrc || image.src;
  clone.alt = image.alt || '';
  clone.loading = 'eager';
  clone.decoding = 'async';
  return clone;
}

function resolveMediaNode(root: HTMLElement, rawTarget: EventTarget | null) {
  const target = rawTarget instanceof Element ? rawTarget : null;
  if (!target || !root.contains(target)) return null;
  if (target.closest('button, input, textarea, select, #lesson-forum, #notes-editor-mount, [data-content-media-ignore]')) {
    return null;
  }

  const mermaid = target.closest<HTMLElement>('.mermaid');
  if (mermaid && root.contains(mermaid)) return mermaid.cloneNode(true) as HTMLElement;

  const image = target.closest<HTMLImageElement>('img');
  if (image && root.contains(image) && image.src) return cloneImage(image);

  const svg = target.closest<SVGSVGElement>('svg');
  if (svg && root.contains(svg) && !svg.closest('a, button')) return cloneSvg(svg);

  return null;
}

function distance(a: PointerEvent, b: PointerEvent) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function midpoint(a: PointerEvent, b: PointerEvent): Point {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function markSources(root: HTMLElement) {
  const mark = (node: Element) => {
    if (node.closest('button, a, input, textarea, select, #lesson-forum, #notes-editor-mount')) return;
    if (node instanceof HTMLElement) {
      node.dataset.contentMediaViewerSource = 'true';
    } else if (node instanceof SVGElement) {
      node.setAttribute('data-content-media-viewer-source', 'true');
    }
  };
  root.querySelectorAll(':scope img, :scope .mermaid, :scope svg').forEach(mark);
}

export function setupContentMediaViewer(root: HTMLElement | null): ViewerCleanup {
  if (!(root instanceof HTMLElement)) return () => {};
  if (root.dataset.contentMediaViewerBound === 'true') return () => {};
  root.dataset.contentMediaViewerBound = 'true';

  const { modal, stage, viewport, content, closeButton, controls } = getOrCreateViewerElements();

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragPointerId: number | null = null;
  let dragOriginX = 0;
  let dragOriginY = 0;
  let startOffsetX = 0;
  let startOffsetY = 0;
  let movedDuringPointer = false;
  let pinchStartDistance = 0;
  let pinchStartScale = 1;
  let pinchStartOffsetX = 0;
  let pinchStartOffsetY = 0;
  let pinchCenter: Point = { x: 0, y: 0 };
  const activePointers = new Map<number, PointerEvent>();

  const applyTransform = () => {
    if (scale <= 1) {
      offsetX = 0;
      offsetY = 0;
    }
    content.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  };

  const setScale = (nextScale: number, center?: Point) => {
    const previousScale = scale;
    scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    if (center && previousScale > 0 && scale > 1) {
      const rect = viewport.getBoundingClientRect();
      const dx = center.x - rect.left - rect.width / 2;
      const dy = center.y - rect.top - rect.height / 2;
      const ratio = scale / previousScale;
      offsetX = dx - (dx - offsetX) * ratio;
      offsetY = dy - (dy - offsetY) * ratio;
    }
    applyTransform();
  };

  const resetView = () => {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    applyTransform();
  };

  const close = () => {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    content.replaceChildren();
    content.style.transform = '';
    document.documentElement.style.overflow = '';
    activePointers.clear();
    dragPointerId = null;
    viewport.classList.remove('is-dragging');
    resetView();
  };

  const open = (node: HTMLElement | SVGSVGElement) => {
    resetView();
    content.replaceChildren(node);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    closeButton.focus({ preventScroll: true });
  };

  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartTime = Date.now();
  };

  const handleTouchEnd = (event: TouchEvent) => {
    if (event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const dt = Date.now() - touchStartTime;

    // Detect a quick tap (touch duration under 300ms, moved less than 10px)
    if (Math.hypot(dx, dy) < 10 && dt < 300) {
      const node = resolveMediaNode(root, event.target);
      if (node) {
        event.preventDefault();
        event.stopPropagation();
        open(node);
      }
    }
  };

  const handleRootDblClick = (event: MouseEvent) => {
    const node = resolveMediaNode(root, event.target);
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    open(node);
  };

  const handleWheel = (event: WheelEvent) => {
    if (modal.hidden) return;
    event.preventDefault();
    const step = event.deltaY < 0 ? 0.25 : -0.25;
    setScale(scale + step, { x: event.clientX, y: event.clientY });
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (modal.hidden) return;
    activePointers.set(event.pointerId, event);
    viewport.setPointerCapture(event.pointerId);

    if (activePointers.size === 2) {
      const [a, b] = Array.from(activePointers.values());
      pinchStartDistance = Math.max(1, distance(a, b));
      pinchStartScale = scale;
      pinchStartOffsetX = offsetX;
      pinchStartOffsetY = offsetY;
      pinchCenter = midpoint(a, b);
      movedDuringPointer = true;
      viewport.classList.add('is-dragging');
      return;
    }

    if (scale <= 1) return;
    dragPointerId = event.pointerId;
    dragOriginX = event.clientX;
    dragOriginY = event.clientY;
    startOffsetX = offsetX;
    startOffsetY = offsetY;
    movedDuringPointer = false;
    viewport.classList.add('is-dragging');
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (modal.hidden || !activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, event);

    if (activePointers.size >= 2) {
      const [a, b] = Array.from(activePointers.values());
      const nextDistance = Math.max(1, distance(a, b));
      const nextCenter = midpoint(a, b);
      scale = clamp(pinchStartScale * (nextDistance / pinchStartDistance), MIN_SCALE, MAX_SCALE);
      offsetX = pinchStartOffsetX + (nextCenter.x - pinchCenter.x);
      offsetY = pinchStartOffsetY + (nextCenter.y - pinchCenter.y);
      applyTransform();
      return;
    }

    if (dragPointerId !== event.pointerId || scale <= 1) return;
    const deltaX = event.clientX - dragOriginX;
    const deltaY = event.clientY - dragOriginY;
    movedDuringPointer = movedDuringPointer || Math.abs(deltaX) + Math.abs(deltaY) > 6;
    offsetX = startOffsetX + deltaX;
    offsetY = startOffsetY + deltaY;
    applyTransform();
  };

  const stopPointer = (event: PointerEvent) => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.delete(event.pointerId);
    try {
      viewport.releasePointerCapture(event.pointerId);
    } catch {}
    if (dragPointerId === event.pointerId) dragPointerId = null;
    if (activePointers.size < 2) {
      pinchStartDistance = 0;
      viewport.classList.remove('is-dragging');
    }
  };

  const handleModalClick = (event: MouseEvent) => {
    if (modal.hidden) return;
    if (movedDuringPointer) {
      movedDuringPointer = false;
      return;
    }
    if (event.target === modal || event.target === stage || event.target === viewport) close();
  };

  const handleDblClick = (event: MouseEvent) => {
    if (modal.hidden) return;
    event.preventDefault();
    setScale(scale < 2 ? 2 : 1, { x: event.clientX, y: event.clientY });
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (modal.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setScale(scale + 0.5);
    } else if (event.key === '-') {
      event.preventDefault();
      setScale(scale - 0.5);
    } else if (event.key === '0') {
      event.preventDefault();
      resetView();
    }
  };

  const handleControlClick = (event: MouseEvent) => {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    const action = button.dataset.contentMediaZoom;
    if (action === 'in') setScale(scale + 0.5);
    else if (action === 'out') setScale(scale - 0.5);
    else resetView();
  };

  markSources(root);
  const observer = new MutationObserver(() => markSources(root));
  observer.observe(root, { childList: true, subtree: true });

  root.addEventListener('dblclick', handleRootDblClick);
  root.addEventListener('touchstart', handleTouchStart, { passive: true });
  root.addEventListener('touchend', handleTouchEnd, { passive: false });
  closeButton.addEventListener('click', close);
  modal.addEventListener('click', handleModalClick);
  viewport.addEventListener('wheel', handleWheel, { passive: false });
  viewport.addEventListener('pointerdown', handlePointerDown);
  viewport.addEventListener('pointermove', handlePointerMove);
  viewport.addEventListener('pointerup', stopPointer);
  viewport.addEventListener('pointercancel', stopPointer);
  content.addEventListener('dblclick', handleDblClick);
  document.addEventListener('keydown', handleKeydown);
  controls.forEach((button) => button.addEventListener('click', handleControlClick));

  return () => {
    delete root.dataset.contentMediaViewerBound;
    observer.disconnect();
    root.removeEventListener('dblclick', handleRootDblClick);
    root.removeEventListener('touchstart', handleTouchStart);
    root.removeEventListener('touchend', handleTouchEnd);
    closeButton.removeEventListener('click', close);
    modal.removeEventListener('click', handleModalClick);
    viewport.removeEventListener('wheel', handleWheel);
    viewport.removeEventListener('pointerdown', handlePointerDown);
    viewport.removeEventListener('pointermove', handlePointerMove);
    viewport.removeEventListener('pointerup', stopPointer);
    viewport.removeEventListener('pointercancel', stopPointer);
    content.removeEventListener('dblclick', handleDblClick);
    document.removeEventListener('keydown', handleKeydown);
    controls.forEach((button) => button.removeEventListener('click', handleControlClick));
    close();
  };
}
