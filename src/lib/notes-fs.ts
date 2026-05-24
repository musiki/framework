// src/lib/notes-fs.ts
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  resolveCourseSource,
  getEditableLocalRepoFile,
  writeEditableLocalRepoFile,
  deleteEditableLocalRepoFile,
  sanitizeRepoMarkdownPath,
  isLocalContentAdminEnabled,
} from './content-admin';

export type NoteListItem = {
  slug: string;
  title: string;
  type: string;
  chapter: string;
  status: string;
  order: number;
  theme?: string;
  filePath: string;
};

export function notesPreflightError(courseId: string): string | null {
  if (!isLocalContentAdminEnabled()) {
    return 'Local content admin not enabled. Set CONTENT_ADMIN_LOCAL_WRITE=true.';
  }
  const source = resolveCourseSource(courseId);
  if (!source) return `Course not found in sources.manifest.json: ${courseId}`;
  return null;
}

function resolveCourseScanDir(courseId: string): string | null {
  const source = resolveCourseSource(courseId);
  if (!source) return null;

  const candidates: string[] = [];

  if (source.localPath) {
    const resolved = path.resolve(process.cwd(), source.localPath);
    if (fs.existsSync(resolved)) {
      candidates.push(path.join(resolved, 'cursos', courseId));
    }
  }
  candidates.push(
    path.join(process.cwd(), '.content-sources', source.id, 'cursos', courseId),
    path.join(process.cwd(), 'src', 'content', 'cursos', courseId),
  );

  return candidates.find(p => fs.existsSync(p) && fs.statSync(p).isDirectory()) ?? null;
}

export function listCourseNotes(courseId: string): NoteListItem[] {
  const baseDir = resolveCourseScanDir(courseId);
  if (!baseDir) return [];

  const source = resolveCourseSource(courseId);
  if (!source) return [];

  const notes: NoteListItem[] = [];

  const scanDir = (dir: string, relDir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), relDir ? `${relDir}/${entry.name}` : entry.name);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === '_index.md') continue;

      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const repoPath = `cursos/${courseId}/${relPath}`;
      const file = getEditableLocalRepoFile(source, repoPath);
      if (!file) continue;

      const { data } = matter(file.content);
      const chapter = String(data.chapter || relDir || '');
      notes.push({
        slug: repoPath,
        title: String(data.title || entry.name.slice(0, -3)),
        type: String(data.type || 'lesson'),
        chapter,
        status: String(data.status || 'draft'),
        order: Number(data.order) || 0,
        theme: data.theme ? String(data.theme) : undefined,
        filePath: repoPath,
      });
    }
  };

  scanDir(baseDir, '');
  return notes.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

function slugifyFilename(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findNoteBySlug(courseId: string, bareSlug: string): string | null {
  const baseDir = resolveCourseScanDir(courseId);
  if (!baseDir) return null;
  const targetSlug = slugifyFilename(bareSlug.replace(/\.md$/i, ''));

  const walk = (dir: string): string | null => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (e.isDirectory()) {
        const found = walk(path.join(dir, e.name));
        if (found) return found;
      } else if (e.isFile() && e.name.endsWith('.md')) {
        const fileSlug = slugifyFilename(e.name.replace(/\.md$/i, ''));
        if (fileSlug === targetSlug) {
          const rel = path.relative(path.dirname(baseDir), path.join(dir, e.name));
          return rel.replace(/\\/g, '/');
        }
      }
    }
    return null;
  };
  return walk(baseDir);
}

export function getCourseNote(courseId: string, slugOrPath: string): { content: string; filePath: string } | null {
  const source = resolveCourseSource(courseId);
  if (!source) return null;

  // Accept full repoPath (cursos/s123/chapter/file.md) or bare slug
  const repoPath = slugOrPath.startsWith(`cursos/${courseId}/`)
    ? slugOrPath
    : sanitizeRepoMarkdownPath(`cursos/${courseId}/${slugOrPath}.md`);
  if (!repoPath) return null;

  const file = getEditableLocalRepoFile(source, repoPath);
  if (file) return { content: file.content, filePath: repoPath };

  // Exact path not found — Obsidian filenames use spaces/accents; try fuzzy slug match
  const bareSlug = slugOrPath.startsWith(`cursos/${courseId}/`)
    ? slugOrPath.slice(`cursos/${courseId}/`.length)
    : slugOrPath;
  const fuzzyRepoPath = findNoteBySlug(courseId, bareSlug);
  if (!fuzzyRepoPath) return null;

  const fuzzyFile = getEditableLocalRepoFile(source, fuzzyRepoPath);
  if (!fuzzyFile) return null;

  return { content: fuzzyFile.content, filePath: fuzzyRepoPath };
}

export function saveCourseNote(courseId: string, slugOrPath: string, content: string): { filePath: string } {
  const source = resolveCourseSource(courseId);
  if (!source) throw new Error(`Course not found: ${courseId}`);

  const repoPath = slugOrPath.startsWith(`cursos/${courseId}/`)
    ? slugOrPath
    : sanitizeRepoMarkdownPath(`cursos/${courseId}/${slugOrPath}.md`);
  if (!repoPath) throw new Error('Invalid slug');

  if (!getEditableLocalRepoFile(source, repoPath)) {
    throw new Error(`Note not found: ${slugOrPath}`);
  }

  writeEditableLocalRepoFile(source, repoPath, content);
  return { filePath: repoPath };
}

export function createCourseNote(courseId: string, opts: {
  slug: string;
  title: string;
  type: string;
  chapter: string;
  status: string;
  order: number;
}): { slug: string; content: string; filePath: string } {
  const source = resolveCourseSource(courseId);
  if (!source) throw new Error(`Course not found: ${courseId}`);

  const repoPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${opts.slug}.md`);
  if (!repoPath) throw new Error('Invalid slug');

  if (getEditableLocalRepoFile(source, repoPath)) {
    throw new Error(`Note already exists: ${opts.slug}`);
  }

  const content = matter.stringify('\n', {
    title: opts.title,
    type: opts.type,
    chapter: opts.chapter,
    status: opts.status,
    order: opts.order,
  });

  writeEditableLocalRepoFile(source, repoPath, content);
  return { slug: opts.slug, content, filePath: repoPath };
}

export function deleteCourseNote(courseId: string, slug: string): void {
  const source = resolveCourseSource(courseId);
  if (!source) throw new Error(`Course not found: ${courseId}`);

  const repoPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${slug}.md`);
  if (!repoPath) throw new Error('Invalid slug');

  deleteEditableLocalRepoFile(source, repoPath);
}

export function moveCourseNote(courseId: string, slug: string, newSlug: string): void {
  const source = resolveCourseSource(courseId);
  if (!source) throw new Error(`Course not found: ${courseId}`);

  const oldPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${slug}.md`);
  const newPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${newSlug}.md`);
  if (!oldPath || !newPath) throw new Error('Invalid slug');

  const file = getEditableLocalRepoFile(source, oldPath);
  if (!file) throw new Error(`Note not found: ${slug}`);

  if (getEditableLocalRepoFile(source, newPath)) {
    throw new Error(`Target already exists: ${newSlug}`);
  }

  writeEditableLocalRepoFile(source, newPath, file.content);
  deleteEditableLocalRepoFile(source, oldPath);
}
