function escAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function isYouTubeEmbedSrc(src: string): boolean {
  try {
    const url = new URL(src, window.location.href);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    return (
      (host === 'youtube.com' || host === 'youtube-nocookie.com') &&
      (url.pathname.startsWith('/embed/') || url.pathname === '/watch')
    ) || host === 'youtu.be';
  } catch {
    return false;
  }
}

export function getYouTubeId(src: string): string | null {
  try {
    const url = new URL(src, window.location.href);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    
    if (url.pathname.startsWith('/embed/')) {
      const parts = url.pathname.split('/');
      return parts[2] || null;
    }
    
    if (url.pathname === '/watch') {
      return url.searchParams.get('v');
    }
    
    if (host === 'youtu.be') {
      return url.pathname.replace(/^\//, '') || null;
    }
  } catch {}
  return null;
}

function appendAutoplay(src: string): string {
  try {
    const url = new URL(src, window.location.href);
    url.searchParams.set('autoplay', '1');
    return url.toString();
  } catch {
    return src.includes('?') ? `${src}&autoplay=1` : `${src}?autoplay=1`;
  }
}

export function deferYouTubeEmbeds(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll<HTMLIFrameElement>('iframe').forEach((iframe) => {
    const src = iframe.getAttribute('src') || iframe.getAttribute('data-src') || '';
    if (!src || !isYouTubeEmbedSrc(src)) return;

    const title = iframe.getAttribute('title') || 'YouTube';
    const width = Number(iframe.getAttribute('width')) || 16;
    const height = Number(iframe.getAttribute('height')) || 9;
    const ratio = width > 0 && height > 0 ? `${width} / ${height}` : '16 / 9';
    const placeholder = document.createElement('div');
    placeholder.className = 'cnw-lazy-embed cnw-lazy-embed--youtube';
    placeholder.style.aspectRatio = ratio;
    placeholder.dataset.cnwYoutubeSrc = src;
    placeholder.dataset.cnwYoutubeTitle = title;

    const videoId = getYouTubeId(src);
    if (videoId) {
      placeholder.style.backgroundImage = `url(https://img.youtube.com/vi/${videoId}/hqdefault.jpg)`;
    }

    placeholder.innerHTML = `
      <button type="button" class="cnw-lazy-embed-btn" aria-label="${escAttr(`Cargar video: ${title}`)}">
        <span class="cnw-lazy-embed-play" aria-hidden="true">▶</span>
        <span class="cnw-lazy-embed-label">YouTube</span>
      </button>
    `;
    iframe.replaceWith(placeholder);
  });

  return template.innerHTML;
}

function injectLazyYouTubeCss() {
  if (document.querySelector('[data-cnw-lazy-youtube-css]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-cnw-lazy-youtube-css', '1');
  style.textContent = `
    .cnw-lazy-embed {
      position: relative;
      width: 100%;
      min-height: 180px;
      margin: .8em 0;
      border: 1px solid var(--c-border, rgba(148, 163, 184, .35));
      border-radius: 6px;
      overflow: hidden;
      background-color: var(--c-bg-mute, rgba(148, 163, 184, .12));
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      display: grid;
      place-items: center;
    }
    .cnw-lazy-embed:not(.cnw-lazy-embed--loaded)::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.65));
      z-index: 1;
      pointer-events: none;
    }
    .cnw-lazy-embed iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
      background: #000;
    }
    .cnw-lazy-embed-btn {
      position: relative;
      z-index: 2;
      width: 100%;
      height: 100%;
      min-height: 180px;
      border: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: .55rem;
      cursor: pointer;
      color: white;
      background: transparent;
      font: inherit;
    }
    .cnw-lazy-embed-btn:hover {
      background: rgba(220, 38, 38, .12);
    }
    .cnw-lazy-embed-play {
      width: 48px;
      height: 48px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      padding-left: 3px;
      background: #dc2626;
      color: white;
      box-shadow: 0 8px 24px rgba(0, 0, 0, .22);
    }
    .cnw-lazy-embed-label {
      font-size: .82rem;
      opacity: .9;
      font-weight: 500;
    }
  `;
  document.head.appendChild(style);
}

export function hydrateLazyYouTubeEmbeds(root: ParentNode = document) {
  injectLazyYouTubeCss();

  root.querySelectorAll<HTMLElement>('[data-cnw-youtube-src]').forEach((placeholder) => {
    if (placeholder.dataset.cnwYoutubeBound === 'true') return;
    placeholder.dataset.cnwYoutubeBound = 'true';

    const button = placeholder.querySelector<HTMLButtonElement>('.cnw-lazy-embed-btn');
    if (!button) return;

    button.addEventListener('click', () => {
      const src = placeholder.dataset.cnwYoutubeSrc;
      if (!src) return;
      const iframe = document.createElement('iframe');
      iframe.src = appendAutoplay(src);
      iframe.title = placeholder.dataset.cnwYoutubeTitle || 'YouTube';
      iframe.loading = 'lazy';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      placeholder.classList.add('cnw-lazy-embed--loaded');
      placeholder.replaceChildren(iframe);
    }, { once: true });
  });
}
