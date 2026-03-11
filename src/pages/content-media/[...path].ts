import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import nodePath from 'node:path';

const CONTENT_ROOT = nodePath.resolve(process.cwd(), 'src', 'content');

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  ogv: 'video/ogg',
};

function decodeRoutePath(rawPath: string): string {
  const segments = String(rawPath || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  return segments.join('/');
}

function normalizeRelativePath(decodedPath: string): string {
  const normalized = nodePath.posix
    .normalize(String(decodedPath || '').replaceAll('\\', '/'))
    .replace(/^\/+/, '');

  if (!normalized || normalized === '.' || normalized === '..') return '';
  if (normalized.includes('\0')) return '';
  if (normalized.startsWith('../')) return '';

  return normalized;
}

function resolveAbsolutePath(relativePath: string): string {
  const absolutePath = nodePath.resolve(CONTENT_ROOT, relativePath);
  const contentRootWithSep = CONTENT_ROOT.endsWith(nodePath.sep) ? CONTENT_ROOT : `${CONTENT_ROOT}${nodePath.sep}`;
  if (absolutePath !== CONTENT_ROOT && !absolutePath.startsWith(contentRootWithSep)) {
    return '';
  }
  return absolutePath;
}

export const GET: APIRoute = async ({ params }) => {
  const rawPath = typeof params.path === 'string' ? params.path : '';
  if (!rawPath) {
    return new Response('Missing media path', { status: 400 });
  }

  const decodedPath = decodeRoutePath(rawPath);
  const relativePath = normalizeRelativePath(decodedPath);
  if (!relativePath) {
    return new Response('Invalid media path', { status: 400 });
  }

  const absolutePath = resolveAbsolutePath(relativePath);
  if (!absolutePath) {
    return new Response('Forbidden media path', { status: 403 });
  }

  const extension = nodePath.extname(absolutePath).slice(1).toLowerCase();
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension];
  if (!contentType) {
    return new Response('Unsupported media type', { status: 415 });
  }

  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      return new Response('Media not found', { status: 404 });
    }

    const body = await fs.readFile(absolutePath);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return new Response('Media not found', { status: 404 });
    }

    console.error('Content media server error:', error?.message || error);
    return new Response('Failed to load media', { status: 500 });
  }
};

