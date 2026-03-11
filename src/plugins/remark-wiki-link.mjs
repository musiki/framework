import { visit } from 'unist-util-visit';
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS]);

const CONTENT_ROOT = path.join(process.cwd(), 'src', 'content');
const MEDIA_INDEX_TTL_MS = process.env.NODE_ENV === 'development' ? 1200 : 60000;

let mediaIndexCache = null;
let mediaIndexBuiltAt = 0;
const warnedAmbiguousMedia = new Set();

function slugifyNoteTarget(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function splitTargetAndLabel(content) {
  const raw = String(content || '');
  if (!raw.includes('|')) {
    return {
      target: raw.trim(),
      label: raw.trim(),
      width: null,
      height: null,
    };
  }

  const [rawTarget, ...rest] = raw.split('|');
  const target = String(rawTarget || '').trim();
  const rawLabel = rest.join('|').trim();
  const sizeMatch = rawLabel.match(/^(\d+)(?:x(\d+))?$/i);

  if (sizeMatch) {
    const width = Number(sizeMatch[1]);
    const height = sizeMatch[2] ? Number(sizeMatch[2]) : null;
    return {
      target,
      label: '',
      width: Number.isFinite(width) && width > 0 ? Math.round(width) : null,
      height: Number.isFinite(height) && height > 0 ? Math.round(height) : null,
    };
  }

  return {
    target,
    label: rawLabel || target,
    width: null,
    height: null,
  };
}

function detectExtension(target) {
  const cleanTarget = String(target || '').split('#')[0].split('?')[0];
  const fileName = String(cleanTarget.split('/').pop() || '').trim();
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '';
  return fileName
    .slice(dot + 1)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+$/g, '');
}

function toPosixPath(value) {
  return String(value || '').split(path.sep).join('/');
}

function buildMediaIndex() {
  const byRelative = new Map();
  const byBasename = new Map();

  if (!fs.existsSync(CONTENT_ROOT)) {
    return { byRelative, byBasename };
  }

  const stack = [CONTENT_ROOT];
  const discovered = [];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.forEach((entry) => {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        return;
      }
      if (!entry.isFile()) return;

      const ext = detectExtension(entry.name);
      if (!MEDIA_EXTENSIONS.has(ext)) return;

      const relative = toPosixPath(path.relative(CONTENT_ROOT, absolute));
      if (!relative) return;
      discovered.push(relative);
    });
  }

  discovered.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  discovered.forEach((relative) => {
    const key = relative.toLowerCase();
    if (!byRelative.has(key)) {
      byRelative.set(key, relative);
    }

    const basename = path.posix.basename(relative).toLowerCase();
    const current = byBasename.get(basename) || [];
    current.push(relative);
    byBasename.set(basename, current);
  });

  for (const [basename, variants] of byBasename.entries()) {
    variants.sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
    byBasename.set(basename, variants);
  }

  return { byRelative, byBasename };
}

function getMediaIndex() {
  const now = Date.now();
  if (mediaIndexCache && now - mediaIndexBuiltAt < MEDIA_INDEX_TTL_MS) {
    return mediaIndexCache;
  }

  mediaIndexCache = buildMediaIndex();
  mediaIndexBuiltAt = now;
  return mediaIndexCache;
}

function toContentMediaUrl(relativePath) {
  const encoded = String(relativePath || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return encoded ? `/content-media/${encoded}` : '';
}

function normalizeTargetForLookup(target) {
  return String(target || '')
    .split('#')[0]
    .split('?')[0]
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

function resolveFromContentIndex(target) {
  const normalizedTarget = normalizeTargetForLookup(target);
  if (!normalizedTarget) return null;

  const index = getMediaIndex();
  const direct = index.byRelative.get(normalizedTarget.toLowerCase());
  if (direct) return direct;

  const basename = path.posix.basename(normalizedTarget).toLowerCase();
  if (!basename) return null;

  const matches = index.byBasename.get(basename);
  if (!matches || matches.length === 0) return null;

  if (matches.length > 1 && !warnedAmbiguousMedia.has(basename)) {
    warnedAmbiguousMedia.add(basename);
    console.warn(`[remark-wiki-link] Multiple media matches for "${basename}". Using "${matches[0]}".`);
  }

  return matches[0];
}

function isExternalUrl(target) {
  return /^https?:\/\//i.test(String(target || '').trim());
}

function resolveAssetUrl(target) {
  const raw = String(target || '').trim().replaceAll('\\', '/');
  if (!raw) return '';
  if (isExternalUrl(raw)) return raw;
  const fromContent = resolveFromContentIndex(raw);
  if (fromContent) return toContentMediaUrl(fromContent);
  if (raw.startsWith('/')) return encodeURI(raw);
  if (raw.startsWith('./') || raw.startsWith('../')) return encodeURI(raw);
  return encodeURI(`/${raw}`);
}

function createMediaEmbedNode(target, label, width, height) {
  const extension = detectExtension(target);
  if (!extension) return null;

  const url = resolveAssetUrl(target);
  if (!url) return null;

  if (IMAGE_EXTENSIONS.has(extension)) {
    const node = {
      type: 'image',
      url,
      alt: label || '',
      title: null,
    };

    if (width || height) {
      node.data = {
        hProperties: {},
      };
      if (width) node.data.hProperties.width = String(width);
      if (height) node.data.hProperties.height = String(height);
    }

    return node;
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    return {
      type: 'html',
      value: `<figure class="obsidian-media-embed-card obsidian-audio-card"><audio class="obsidian-audio-embed obsidian-media-embed" controls preload="metadata" src="${escapeHtml(url)}"></audio></figure>`,
    };
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return {
      type: 'html',
      value: `<figure class="obsidian-media-embed-card obsidian-video-card"><video class="obsidian-video-embed obsidian-media-embed" controls preload="metadata" src="${escapeHtml(url)}"></video></figure>`,
    };
  }

  return null;
}

export default function remarkWikiLink() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      const value = node.value;
      if (!value.includes('[[')) return;

      const regex = /(!)?\[\[([^[\]]+?)\]\]/g;
      let match;
      let lastIndex = 0;
      const nodes = [];

      while ((match = regex.exec(value)) !== null) {
        if (match.index > lastIndex) {
          nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) });
        }

        const isEmbed = Boolean(match[1]);
        const content = match[2];
        const { target, label, width, height } = splitTargetAndLabel(content);

        if (isEmbed) {
          const mediaNode = createMediaEmbedNode(target, label, width, height);
          if (mediaNode) {
            nodes.push(mediaNode);
          } else {
            const rawSlug = target.split('/').pop().trim();
            const slug = slugifyNoteTarget(rawSlug);
            const url = '/' + slug;
            nodes.push({ type: 'link', url, children: [{ type: 'text', value: label || target }] });
          }
        } else {
          const rawSlug = target.split('/').pop().trim();
          const slug = slugifyNoteTarget(rawSlug);
          const url = '/' + slug;
          nodes.push({ type: 'link', url, children: [{ type: 'text', value: label || target }] });
        }

        lastIndex = regex.lastIndex;
      }

      if (nodes.length > 0) {
        if (lastIndex < value.length) nodes.push({ type: 'text', value: value.slice(lastIndex) });
        parent.children.splice(index, 1, ...nodes);
        return index + nodes.length;
      }
    });
  };
}
