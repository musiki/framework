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
  const source = resolveCourseSource(courseId);
  if (!source) return [];

  const baseDir = resolveCourseScanDir(courseId);
  if (!baseDir) return [];

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const notes: NoteListItem[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === '_index.md') continue;

    const slug = entry.name.slice(0, -3);
    const repoPath = `cursos/${courseId}/${entry.name}`;
    const file = getEditableLocalRepoFile(source, repoPath);
    if (!file) continue;

    const { data } = matter(file.content);
    notes.push({
      slug,
      title: String(data.title || slug),
      type: String(data.type || 'lesson'),
      chapter: String(data.chapter || ''),
      status: String(data.status || 'draft'),
      order: Number(data.order) || 0,
      theme: data.theme ? String(data.theme) : undefined,
      filePath: repoPath,
    });
  }

  return notes.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function getCourseNote(courseId: string, slug: string): { content: string; filePath: string } | null {
  const source = resolveCourseSource(courseId);
  if (!source) return null;

  const repoPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${slug}.md`);
  if (!repoPath) return null;

  const file = getEditableLocalRepoFile(source, repoPath);
  if (!file) return null;

  return { content: file.content, filePath: repoPath };
}

export function saveCourseNote(courseId: string, slug: string, content: string): { filePath: string } {
  const source = resolveCourseSource(courseId);
  if (!source) throw new Error(`Course not found: ${courseId}`);

  const repoPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${slug}.md`);
  if (!repoPath) throw new Error('Invalid slug');

  if (!getEditableLocalRepoFile(source, repoPath)) {
    throw new Error(`Note not found: ${slug}`);
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

  const content = [
    '---',
    `title: "${opts.title}"`,
    `type: ${opts.type}`,
    `chapter: "${opts.chapter}"`,
    `status: ${opts.status}`,
    `order: ${opts.order}`,
    '---',
    '',
    '',
  ].join('\n');

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
