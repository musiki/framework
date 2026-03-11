const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:/i;
const SLIDES_PREFIX = '/cursos/slides/';

export type PresentationController = {
  clear: () => void;
  getHref: () => string | null;
  setHref: (nextValue: string | null | undefined) => string | null;
};

type PresentationControllerOptions = {
  frame: HTMLIFrameElement;
  placeholder: HTMLElement;
};

export const normalizePresentationHref = (
  value: string | null | undefined,
  origin = window.location.origin,
) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const inferred =
    raw.startsWith('/') || ABSOLUTE_URL_RE.test(raw)
      ? raw
      : `${SLIDES_PREFIX}${raw.replace(/^\/+/, '')}`;

  const url = new URL(inferred, origin);
  if (url.origin !== origin) {
    throw new Error('Only same-origin presentation URLs are supported.');
  }

  return `${url.pathname}${url.search}${url.hash}`;
};

export const createPresentationController = ({
  frame,
  placeholder,
}: PresentationControllerOptions): PresentationController => {
  let currentHref: string | null = null;

  const render = () => {
    const hasPresentation = Boolean(currentHref);
    frame.hidden = !hasPresentation;
    placeholder.hidden = hasPresentation;
    frame.src = hasPresentation ? currentHref ?? '' : 'about:blank';
  };

  const setHref = (nextValue: string | null | undefined) => {
    currentHref = normalizePresentationHref(nextValue);
    render();
    return currentHref;
  };

  const clear = () => {
    currentHref = null;
    render();
  };

  render();

  return {
    clear,
    getHref: () => currentHref,
    setHref,
  };
};
