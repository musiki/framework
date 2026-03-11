import fs from 'node:fs';
import path from 'node:path';

type SourceManifestSource = {
  id: string;
  enabled?: boolean;
  repo?: string;
  branch?: string;
  contentRoot?: string;
  localPath?: string;
};

type SourceManifest = {
  version?: number;
  sources?: SourceManifestSource[];
};

const manifestPath = path.join(process.cwd(), 'config', 'sources.manifest.json');

let cachedManifestMtimeMs = -1;
let cachedManifest: SourceManifest | null = null;

const normalizeText = (value: unknown) => String(value || '').trim();
const normalizePath = (value: unknown) => normalizeText(value).replace(/\\/g, '/');

function readManifest(): SourceManifest {
  const stat = fs.statSync(manifestPath);
  if (cachedManifest && cachedManifestMtimeMs === stat.mtimeMs) {
    return cachedManifest;
  }

  cachedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  cachedManifestMtimeMs = stat.mtimeMs;
  return cachedManifest || {};
}

export function resolveCourseSource(courseId: string): SourceManifestSource | null {
  const normalizedCourseId = normalizeText(courseId);
  if (!normalizedCourseId) return null;

  const manifest = readManifest();
  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  return sources.find((source) => normalizeText(source?.id) === normalizedCourseId) || null;
}

export function sourcePathFromFrameworkFilePath(filePath: unknown): string {
  const normalized = normalizePath(filePath);
  if (!normalized) return '';
  if (normalized.startsWith('src/content/')) {
    return normalized.slice('src/content/'.length);
  }
  const nestedMatch = normalized.match(/(?:^|\/)src\/content\/(.+)$/);
  if (nestedMatch?.[1]) {
    return nestedMatch[1];
  }
  return '';
}

export function sanitizeRepoMarkdownPath(value: unknown): string {
  const normalized = normalizePath(value).replace(/^\/+/, '');
  if (!normalized) return '';
  if (path.posix.isAbsolute(normalized)) return '';

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return '';
  if (segments.some((segment) => segment === '.' || segment === '..')) return '';

  const rebuilt = segments.join('/');
  if (!/\.(md|mdx)$/i.test(rebuilt)) return '';
  return rebuilt;
}

export function sanitizeRepoDirectoryPath(value: unknown): string {
  const normalized = normalizePath(value).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized) return '';
  if (path.posix.isAbsolute(normalized)) return '';

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return '';
  if (segments.some((segment) => segment === '.' || segment === '..')) return '';

  return segments.join('/');
}

export function isEditableCourseRepoPath(courseId: string, repoPath: string): boolean {
  const normalizedCourseId = normalizeText(courseId);
  const normalizedRepoPath = sanitizeRepoMarkdownPath(repoPath);
  if (!normalizedCourseId || !normalizedRepoPath) return false;

  return (
    normalizedRepoPath.startsWith(`cursos/${normalizedCourseId}/`) ||
    normalizedRepoPath.startsWith('draft/') ||
    normalizedRepoPath.startsWith('public/')
  );
}

export function buildDefaultCreatePath(courseId: string, preferredDir = ''): string {
  const normalizedCourseId = normalizeText(courseId);
  const normalizedDir = sanitizeRepoDirectoryPath(preferredDir);

  if (normalizedDir && isEditableCourseRepoPath(normalizedCourseId, `${normalizedDir}/nueva-nota.md`)) {
    return `${normalizedDir}/nueva-nota.md`;
  }

  return `cursos/${normalizedCourseId}/nueva-nota.md`;
}

export function buildEditorHref(options: {
  courseId: string;
  mode: 'create' | 'edit';
  path?: string;
  dir?: string;
  returnTo?: string;
}): string {
  const params = new URLSearchParams();
  params.set('course', normalizeText(options.courseId));
  params.set('mode', options.mode);

  const pathValue = sanitizeRepoMarkdownPath(options.path);
  if (pathValue) params.set('path', pathValue);

  const dirValue = sanitizeRepoDirectoryPath(options.dir);
  if (dirValue) params.set('dir', dirValue);

  const returnTo = normalizeText(options.returnTo);
  if (returnTo) params.set('returnTo', returnTo);

  return `/cursos/editor?${params.toString()}`;
}
