// Full screen for the mm concept graph (graph.astro toolbar button).
// The wrap (toolbar + canvas + timeline) gets the class mm-graph-full, a
// fixed layer over the page that respects the safe areas (notches) — that
// alone works everywhere, including iPhone Safari, which has no element
// Fullscreen API. Where the API exists (desktop, Android, iPad) it is also
// requested, to hide the browser chrome; leaving native full screen (Esc,
// system back gesture) leaves the layer too. Esc leaves the layer in any case.
// graph.ts's ResizeObserver refits the drawing to the new size.

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };

const FULL = 'mm-graph-full';
const NO_SCROLL = 'mm-noscroll';

export function setupGraphFullscreen(wrap: HTMLElement, button: HTMLButtonElement, labels: { enter: string; exit: string }): {
  isFull: () => boolean;
  toggle: () => void;
} {
  const doc = document as FsDocument;
  let native = false;

  const nativeElement = () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  const isFull = () => wrap.classList.contains(FULL);

  const sync = () => {
    const on = isFull();
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? labels.exit : labels.enter);
    button.title = on ? labels.exit : labels.enter;
  };

  const enter = () => {
    wrap.classList.add(FULL);
    document.documentElement.classList.add(NO_SCROLL);
    sync();
    const el = wrap as FsElement;
    const request = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
    if (!request) return;
    try {
      const done = request();
      native = true;
      if (done && typeof (done as Promise<void>).catch === 'function') {
        (done as Promise<void>).catch(() => { native = false; });
      }
    } catch {
      native = false; // the fixed layer still covers the page
    }
  };

  const leave = () => {
    wrap.classList.remove(FULL);
    document.documentElement.classList.remove(NO_SCROLL);
    sync();
    if (native && nativeElement()) {
      const exit = doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc);
      try { void exit?.(); } catch { /* already out */ }
    }
    native = false;
  };

  const onNativeChange = () => {
    if (native && !nativeElement() && isFull()) {
      native = false;
      leave();
      button.focus();
    }
  };
  document.addEventListener('fullscreenchange', onNativeChange);
  document.addEventListener('webkitfullscreenchange', onNativeChange);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isFull() && !nativeElement()) {
      leave();
      button.focus();
    }
  });

  sync();
  return { isFull, toggle: () => (isFull() ? leave() : enter()) };
}
