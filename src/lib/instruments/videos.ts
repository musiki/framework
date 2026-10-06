// Pure video-link extraction for the public instruments payload.
//
// Scans every string value of a note's frontmatter (recursively) and its
// markdown body for YouTube / Vimeo URLs. Only the recognised URLs leave
// this module, normalised to canonical watch URLs — never the text around
// them. No astro/db imports.

export type PublicVideo = { provider: 'youtube' | 'vimeo'; id: string; url: string };

export const MAX_VIDEOS = 12;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d+$/;
const VIMEO_HASH = /^[A-Za-z0-9]+$/;

const YT_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com']);

/** Classifies one URL string; `null` when it is not a recognised video URL. */
export function parseVideoUrl(raw: string): PublicVideo | null {
  let u: URL;
  try {
    u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const seg = u.pathname.split('/').filter((s) => s !== '');

  const yt = (id: string | undefined): PublicVideo | null =>
    id && YT_ID.test(id)
      ? { provider: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` }
      : null;

  if (host === 'youtu.be') return seg.length >= 1 ? yt(seg[0]) : null;
  if (YT_HOSTS.has(host)) {
    if (seg[0] === 'watch' && seg.length === 1) return yt(u.searchParams.get('v') ?? undefined);
    if ((seg[0] === 'embed' || seg[0] === 'shorts') && seg.length === 2) return yt(seg[1]);
    return null;
  }
  if (host === 'youtube-nocookie.com') {
    return seg[0] === 'embed' && seg.length === 2 ? yt(seg[1]) : null;
  }

  const vimeo = (id: string | undefined, hash: string | null | undefined): PublicVideo | null => {
    if (!id || !VIMEO_ID.test(id)) return null;
    const h = hash && VIMEO_HASH.test(hash) ? hash : null;
    return { provider: 'vimeo', id, url: `https://vimeo.com/${id}${h ? `?h=${h}` : ''}` };
  };
  if (host === 'vimeo.com') {
    if (seg.length === 1) return vimeo(seg[0], u.searchParams.get('h'));
    // unlisted videos: vimeo.com/<id>/<hash>
    if (seg.length === 2 && VIMEO_ID.test(seg[0]) && VIMEO_HASH.test(seg[1])) return vimeo(seg[0], seg[1]);
    return null;
  }
  if (host === 'player.vimeo.com') {
    return seg[0] === 'video' && seg.length === 2 ? vimeo(seg[1], u.searchParams.get('h')) : null;
  }
  return null;
}

// `(?<![\w/:.-])` keeps the protocol-relative branch from matching inside
// the `//` of an `https://` URL or a longer path.
const URL_RE = /(?<![\w/:.-])(?:https?:)?\/\/[^\s"'<>()[\]{}`\\]+/gi;

function scanText(text: string, add: (raw: string) => void): void {
  const normalised = text.replace(/&amp;/gi, '&');
  for (const m of normalised.matchAll(URL_RE)) {
    add(m[0].replace(/[.,;:!?*_]+$/, ''));
  }
}

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
  else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out, depth + 1);
  }
}

/**
 * Every YouTube / Vimeo video referenced anywhere in a note: all YAML
 * string values (any field, recursively) and the markdown body. Deduped by
 * provider+id, first-seen order, capped at {@link MAX_VIDEOS}.
 */
export function extractVideos(
  frontmatterData: Record<string, unknown> | null | undefined,
  body: string | null | undefined,
): PublicVideo[] {
  const found: PublicVideo[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    if (found.length >= MAX_VIDEOS) return;
    const v = parseVideoUrl(raw);
    if (!v) return;
    const key = `${v.provider}:${v.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(v);
  };

  const strings: string[] = [];
  collectStrings(frontmatterData ?? {}, strings);
  for (const s of strings) {
    const trimmed = s.trim();
    // A bare scheme-less value like `youtu.be/ID` is a whole-field URL.
    if (/^[\w.-]+\.[a-z]{2,}\/\S*$/i.test(trimmed) && !/\s/.test(trimmed)) add(`https://${trimmed}`);
    scanText(s, add);
  }
  if (typeof body === 'string') scanText(body, add);
  return found;
}
