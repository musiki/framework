import type { APIRoute } from 'astro';
import fs from 'node:fs';
import nodePath from 'node:path';

const CONTENT_ROOT = nodePath.resolve(process.cwd(), 'src', 'content');
const MEDIA_INDEX_TTL_MS = process.env.NODE_ENV === 'development' ? 1200 : 60000;

const ALLOWED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'aac',
  'flac',
  'mp4',
  'webm',
  'mov',
  'm4v',
  'ogv',
]);

let cachedByBasename: Map<string, string[]> | null = null;
let cachedAt = 0;

function toPosixPath(value: string): string {
  return value.split(nodePath.sep).join('/');
}

function detectExtension(fileName: string): string {
  const clean = String(fileName || '').trim();
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return '';
  return clean
    .slice(dot + 1)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+$/g, '');
}

function buildBasenameIndex(): Map<string, string[]> {
  const byBasename = new Map<string, string[]>();
  if (!fs.existsSync(CONTENT_ROOT)) return byBasename;

  const stack = [CONTENT_ROOT];
  const discovered: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.forEach((entry) => {
      const absolute = nodePath.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        return;
      }
      if (!entry.isFile()) return;

      const ext = detectExtension(entry.name);
      if (!ALLOWED_EXTENSIONS.has(ext)) return;

      const relative = toPosixPath(nodePath.relative(CONTENT_ROOT, absolute));
      if (!relative) return;
      discovered.push(relative);
    });
  }

  discovered.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  discovered.forEach((relative) => {
    const basename = nodePath.posix.basename(relative).toLowerCase();
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

  return byBasename;
}

function getBasenameIndex(): Map<string, string[]> {
  const now = Date.now();
  if (cachedByBasename && now - cachedAt < MEDIA_INDEX_TTL_MS) {
    return cachedByBasename;
  }

  cachedByBasename = buildBasenameIndex();
  cachedAt = now;
  return cachedByBasename;
}

function normalizeRequestedName(raw: string): string {
  const decoded = String(raw || '').trim();
  const basename = nodePath.posix.basename(decoded.replaceAll('\\', '/')).trim();
  if (!basename) return '';
  if (basename.includes('\0')) return '';

  const extension = detectExtension(basename);
  if (!ALLOWED_EXTENSIONS.has(extension)) return '';

  return basename;
}

function toContentMediaUrl(relativePath: string): string {
  const encoded = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return encoded ? `/content-media/${encoded}` : '';
}

export const GET: APIRoute = async ({ url }) => {
  const requested = normalizeRequestedName(url.searchParams.get('name') || '');
  if (!requested) {
    return new Response(JSON.stringify({ error: 'Invalid media name' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const index = getBasenameIndex();
  const matches = index.get(requested.toLowerCase()) || [];
  if (matches.length === 0) {
    return new Response(JSON.stringify({ error: 'Media not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const selected = matches[0];
  return new Response(
    JSON.stringify({
      success: true,
      name: requested,
      relativePath: selected,
      url: toContentMediaUrl(selected),
      ambiguous: matches.length > 1,
      alternatives: matches,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
};

