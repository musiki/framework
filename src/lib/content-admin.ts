import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeContentSlug } from './content-slug';

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
const isTruthy = (value: unknown) => /^(1|true|yes|on)$/i.test(normalizeText(value));

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

function resolveCreateTargetDirectory(courseId: string, preferredPath = ''): string {
  const normalizedCourseId = normalizeText(courseId);
  const normalizedPreferredPath = sanitizeRepoMarkdownPath(preferredPath);
  const normalizedDir = sanitizeRepoDirectoryPath(
    normalizedPreferredPath
      ? path.posix.dirname(normalizedPreferredPath)
      : preferredPath,
  );

  if (normalizedDir && isEditableCourseRepoPath(normalizedCourseId, `${normalizedDir}/placeholder.md`)) {
    return normalizedDir;
  }

  return `cursos/${normalizedCourseId}`;
}

function resolveCreateTargetStem(title: unknown, preferredPath = ''): string {
  const titleSlug = normalizeContentSlug(title);
  if (titleSlug) return titleSlug;

  const normalizedPreferredPath = sanitizeRepoMarkdownPath(preferredPath);
  if (normalizedPreferredPath) {
    const preferredBase = path.posix.basename(
      normalizedPreferredPath,
      path.posix.extname(normalizedPreferredPath),
    );
    const preferredSlug = normalizeContentSlug(preferredBase);
    if (preferredSlug) return preferredSlug;
  }

  return 'nueva-nota';
}

export function buildCreateCandidatePath(options: {
  courseId: string;
  preferredPath?: string;
  title?: unknown;
  attempt?: number;
}): string {
  const directory = resolveCreateTargetDirectory(options.courseId, options.preferredPath || '');
  const stem = resolveCreateTargetStem(options.title, options.preferredPath || '');
  const attempt = Number.isFinite(options.attempt) ? Math.max(0, Number(options.attempt) || 0) : 0;
  const suffix = attempt > 0 ? `-${attempt + 1}` : '';
  return `${directory}/${stem}${suffix}.md`;
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

export function isLocalContentAdminEnabled(): boolean {
  return isTruthy(
    process.env.CONTENT_ADMIN_LOCAL_WRITE ||
    import.meta.env.CONTENT_ADMIN_LOCAL_WRITE,
  );
}

function resolveSourceLocalRoot(source: SourceManifestSource | null): string {
  const localPath = normalizeText(source?.localPath);
  if (!localPath) return '';
  const resolved = path.resolve(process.cwd(), localPath);
  if (!fs.existsSync(resolved)) return '';
  if (!fs.statSync(resolved).isDirectory()) return '';
  return resolved;
}

function buildLocalEditableCandidatePaths(source: SourceManifestSource | null, repoPath: string): string[] {
  const normalizedRepoPath = sanitizeRepoMarkdownPath(repoPath);
  if (!normalizedRepoPath || !source?.id) return [];

  const candidates = [
    path.join(process.cwd(), '.content-sources', source.id, normalizedRepoPath),
    path.join(process.cwd(), 'src/content', normalizedRepoPath),
  ];

  const sourceLocalRoot = resolveSourceLocalRoot(source);
  if (sourceLocalRoot) {
    candidates.unshift(path.join(sourceLocalRoot, normalizedRepoPath));
  }

  return Array.from(new Set(candidates));
}

export function getEditableLocalRepoFile(source: SourceManifestSource | null, repoPath: string): {
  path: string;
  content: string;
  sha: string;
  absolutePath: string;
} | null {
  const normalizedRepoPath = sanitizeRepoMarkdownPath(repoPath);
  if (!normalizedRepoPath) return null;

  const existingPath = buildLocalEditableCandidatePaths(source, normalizedRepoPath)
    .find((candidatePath) => fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile());

  if (!existingPath) return null;

  const content = fs.readFileSync(existingPath, 'utf8');
  return {
    path: normalizedRepoPath,
    content,
    sha: createHash('sha1').update(content, 'utf8').digest('hex'),
    absolutePath: existingPath,
  };
}

export function writeEditableLocalRepoFile(source: SourceManifestSource | null, repoPath: string, content: string): {
  path: string;
  fileSha: string;
  writtenPaths: string[];
} {
  const normalizedRepoPath = sanitizeRepoMarkdownPath(repoPath);
  if (!normalizedRepoPath) {
    throw new Error('A valid markdown target path is required.');
  }
  if (!source?.id) {
    throw new Error('No source repository is configured for this course.');
  }

  const candidatePaths = buildLocalEditableCandidatePaths(source, normalizedRepoPath);
  const writtenPaths: string[] = [];

  for (const candidatePath of candidatePaths) {
    fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
    fs.writeFileSync(candidatePath, content, 'utf8');
    writtenPaths.push(candidatePath);
  }

  return {
    path: normalizedRepoPath,
    fileSha: createHash('sha1').update(content, 'utf8').digest('hex'),
    writtenPaths,
  };
}
