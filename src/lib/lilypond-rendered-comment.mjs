import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const META_ENV = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
const R2_PUBLIC_URL =
  META_ENV?.R2_PUBLIC_URL ||
  process.env.R2_PUBLIC_URL ||
  META_ENV?.R2_PUBLIC_DEV_URL ||
  process.env.R2_PUBLIC_DEV_URL ||
  '';

const RENDERED_COMMENT_LINE_RE = /^\s*%\s*rendered:\s*(.+?)\s*$/im;
const RENDERED_COMMENT_LINE_GLOBAL_RE = /^\s*%\s*rendered:\s*.+?\s*$/gim;
const RENDERED_COMMENT_VALUE_RE = /^(?:(?:sha1|hash):([a-f0-9]{40})\s+)?(.+)$/i;
const LILY_FENCE_RE = /(^```(?:lilypond|lily|ly)[^\n]*\n)([\s\S]*?)(\n```)/gim;
const LILY_RENDER_CACHE_PATH = path.join(process.cwd(), '.cache', 'lilypond-renders.json');
const LILY_RENDER_CACHE_MAX_ENTRIES = 2000;

let lilyRenderCacheLoaded = false;
let lilyRenderCacheDirty = false;
let lilyRenderCache = new Map();

function normalizeText(value) {
  return String(value || '').trim();
}

function ensureLilyRenderCacheLoaded() {
  if (lilyRenderCacheLoaded) return;
  lilyRenderCacheLoaded = true;

  try {
    const raw = fs.readFileSync(LILY_RENDER_CACHE_PATH, 'utf8');
    const payload = JSON.parse(raw);
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    lilyRenderCache = new Map(
      entries
        .filter((entry) => entry && typeof entry.hash === 'string' && typeof entry.url === 'string')
        .map((entry) => [
          normalizeText(entry.hash).toLowerCase(),
          {
            url: normalizeText(entry.url),
            updatedAt: normalizeText(entry.updatedAt) || new Date().toISOString(),
          },
        ]),
    );
  } catch {
    lilyRenderCache = new Map();
  }
}

function persistLilyRenderCache() {
  if (!lilyRenderCacheDirty) return;
  lilyRenderCacheDirty = false;

  try {
    fs.mkdirSync(path.dirname(LILY_RENDER_CACHE_PATH), { recursive: true });
    const entries = Array.from(lilyRenderCache.entries())
      .slice(-LILY_RENDER_CACHE_MAX_ENTRIES)
      .map(([hash, value]) => ({
        hash,
        url: value.url,
        updatedAt: value.updatedAt,
      }));

    fs.writeFileSync(
      LILY_RENDER_CACHE_PATH,
      JSON.stringify(
        {
          version: 1,
          entries,
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch (error) {
    console.warn('[lilypond-cache] Could not persist render cache:', error);
  }
}

function getR2PublicBaseUrl() {
  return normalizeText(R2_PUBLIC_URL).replace(/\/+$/g, '');
}

function normalizeObjectKey(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

function buildPublicUrlFromObjectKey(objectKey) {
  const base = getR2PublicBaseUrl();
  const normalizedKey = normalizeObjectKey(objectKey);
  if (!base || !normalizedKey) return '';
  return `${base}/${normalizedKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

export function stripRenderedLilypondComment(source) {
  return String(source || '').replace(RENDERED_COMMENT_LINE_GLOBAL_RE, '').replace(/^\n+/, '');
}

export function computeRenderedLilypondHash(source) {
  const cleanSource = stripRenderedLilypondComment(source).replace(/\r\n?/g, '\n');
  return crypto.createHash('sha1').update(cleanSource, 'utf8').digest('hex');
}

export function getCachedRenderedLilypondUrl(source) {
  const hash = computeRenderedLilypondHash(source);
  if (!hash) return '';
  ensureLilyRenderCacheLoaded();
  const cached = lilyRenderCache.get(hash);
  return normalizeText(cached?.url);
}

export function cacheRenderedLilypondUrl(source, url) {
  const normalizedUrl = normalizeText(url);
  const hash = computeRenderedLilypondHash(source);
  if (!normalizedUrl || !hash) return '';

  ensureLilyRenderCacheLoaded();
  lilyRenderCache.delete(hash);
  lilyRenderCache.set(hash, {
    url: normalizedUrl,
    updatedAt: new Date().toISOString(),
  });

  while (lilyRenderCache.size > LILY_RENDER_CACHE_MAX_ENTRIES) {
    const firstKey = lilyRenderCache.keys().next().value;
    if (!firstKey) break;
    lilyRenderCache.delete(firstKey);
  }

  lilyRenderCacheDirty = true;
  persistLilyRenderCache();
  return normalizedUrl;
}

export function parseRenderedLilypondComment(source) {
  const rawSource = String(source || '');
  const commentMatch = rawSource.match(RENDERED_COMMENT_LINE_RE);
  const cleanSource = stripRenderedLilypondComment(rawSource);
  const computedHash = computeRenderedLilypondHash(cleanSource);

  if (!commentMatch) {
    return {
      cleanSource,
      computedHash,
      hashMatches: false,
      reference: '',
      resolvedUrl: '',
      storedHash: '',
    };
  }

  const payload = normalizeText(commentMatch[1]);
  const parsed = payload.match(RENDERED_COMMENT_VALUE_RE);
  const storedHash = normalizeText(parsed?.[1]);
  const reference = normalizeText(parsed?.[2] || payload);

  let resolvedUrl = '';
  if (/^https?:\/\//i.test(reference)) {
    resolvedUrl = reference;
  } else if (reference) {
    const objectKey =
      reference.includes('/') || /\.svg$/i.test(reference)
        ? reference
        : `scores/${reference.replace(/\.svg$/i, '')}.svg`;
    resolvedUrl = buildPublicUrlFromObjectKey(objectKey);
  }

  const hashMatches = storedHash ? storedHash === computedHash : Boolean(resolvedUrl);

  return {
    cleanSource,
    computedHash,
    hashMatches,
    reference,
    resolvedUrl,
    storedHash,
  };
}

export function getRenderedLilypondUrl(source) {
  const parsed = parseRenderedLilypondComment(source);
  if (!parsed.reference || !parsed.resolvedUrl || !parsed.hashMatches) {
    return getCachedRenderedLilypondUrl(parsed.cleanSource);
  }
  cacheRenderedLilypondUrl(parsed.cleanSource, parsed.resolvedUrl);
  return parsed.resolvedUrl;
}

export function renderedLilypondReferenceFromUrl(url) {
  const normalizedUrl = normalizeText(url);
  const publicBase = getR2PublicBaseUrl();
  if (!normalizedUrl) return '';
  if (publicBase && normalizedUrl.startsWith(`${publicBase}/`)) {
    const relativePath = normalizedUrl.slice(publicBase.length + 1);
    return relativePath
      .split('/')
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join('/');
  }
  return normalizedUrl;
}

export function withRenderedLilypondComment(source, url) {
  const cleanSource = stripRenderedLilypondComment(source);
  const reference = renderedLilypondReferenceFromUrl(url);
  if (!reference) return cleanSource;
  const hash = computeRenderedLilypondHash(cleanSource);
  return `% rendered: sha1:${hash} ${reference}\n${cleanSource}`;
}

export async function annotateMarkdownLilypondBlocks(markdown, options = {}) {
  const source = String(markdown || '');
  const resolveUrl = typeof options.resolveUrl === 'function' ? options.resolveUrl : null;
  const dropStale = options.dropStale !== false;
  if (!source || !resolveUrl) return source;

  const matches = Array.from(source.matchAll(LILY_FENCE_RE));
  if (matches.length === 0) return source;

  const memo = new Map();
  let result = '';
  let lastIndex = 0;

  for (const match of matches) {
    const index = Number(match.index || 0);
    const fenceOpen = match[1] || '';
    const blockBody = match[2] || '';
    const fenceClose = match[3] || '';

    result += source.slice(lastIndex, index);

    const parsed = parseRenderedLilypondComment(blockBody);
    let nextBody = blockBody;

    if (parsed.resolvedUrl && parsed.hashMatches) {
      nextBody = withRenderedLilypondComment(parsed.cleanSource, parsed.resolvedUrl);
    } else if (parsed.cleanSource.trim()) {
      let requestPromise = memo.get(parsed.cleanSource);
      if (!requestPromise) {
        requestPromise = Promise.resolve(resolveUrl(parsed.cleanSource));
        memo.set(parsed.cleanSource, requestPromise);
      }

      const remoteUrl = normalizeText(await requestPromise);
      if (remoteUrl) {
        nextBody = withRenderedLilypondComment(parsed.cleanSource, remoteUrl);
      } else if (dropStale) {
        nextBody = parsed.cleanSource;
      }
    }

    result += `${fenceOpen}${nextBody}${fenceClose}`;
    lastIndex = index + match[0].length;
  }

  result += source.slice(lastIndex);
  return result;
}
