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

const LATEX_TEMPLATE_NOTES = [
  {
    slug: 'latex-templates/asignacion-seminario',
    title: 'asignación-seminario',
    order: 9001,
    templateId: 'asignacion-seminario',
    body: [
      '# asignación-seminario',
      '',
      'Plantilla base para trabajos breves del seminario.',
      '',
      '```latex',
      '\\documentclass[sigconf]{acmart}',
      '\\settopmatter{printacmref=false}',
      '\\renewcommand\\footnotetextcopyrightpermission[1]{}',
      '\\usepackage[utf8]{inputenc}',
      '\\usepackage[T1]{fontenc}',
      '\\usepackage{hyperref}',
      '\\usepackage{graphicx}',
      '\\usepackage[most]{tcolorbox}',
      '',
      '\\title{{{title}}}',
      '\\author{{{author}}}',
      '\\date{}',
      '',
      '\\begin{document}',
      '\\maketitle',
      '',
      '{{{body}}}',
      '',
      '\\end{document}',
      '```',
    ].join('\n'),
  },
  {
    slug: 'latex-templates/tesina-seminario',
    title: 'tesina-seminario',
    order: 9002,
    templateId: 'tesina-seminario',
    body: [
      '# tesina-seminario',
      '',
      'Plantilla base para tesina de grado con estructura moderna.',
      '',
      '```latex',
      '\\documentclass[12pt,a4paper]{report}',
      '\\usepackage[utf8]{inputenc}',
      '\\usepackage[T1]{fontenc}',
      '\\usepackage[spanish]{babel}',
      '\\usepackage{hyperref}',
      '\\usepackage{graphicx}',
      '\\usepackage{geometry}',
      '\\usepackage{setspace}',
      '\\usepackage{titlesec}',
      '\\usepackage{fancyhdr}',
      '\\usepackage[most]{tcolorbox}',
      '\\geometry{top=2.8cm,bottom=2.8cm,left=3.2cm,right=2.6cm}',
      '\\onehalfspacing',
      '',
      '\\title{{{title}}}',
      '\\author{{{author}}}',
      '\\date{\\today}',
      '',
      '\\begin{document}',
      '\\maketitle',
      '\\tableofcontents',
      '\\clearpage',
      '',
      '{{{body}}}',
      '',
      '\\end{document}',
      '```',
    ].join('\n'),
  },
] as const;

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

export function ensureCourseLatexTemplateNotes(courseId: string): void {
  const source = resolveCourseSource(courseId);
  if (!source) throw new Error(`Course not found: ${courseId}`);

  for (const template of LATEX_TEMPLATE_NOTES) {
    const repoPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${template.slug}.md`);
    if (!repoPath) continue;
    if (getEditableLocalRepoFile(source, repoPath)) continue;

    const content = matter.stringify(`${template.body}\n`, {
      title: template.title,
      type: 'latex-template',
      templateId: template.templateId,
      chapter: '90 NOTAS',
      status: 'draft',
      order: template.order,
    });
    writeEditableLocalRepoFile(source, repoPath, content);
  }
}

function slugifyFilename(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const legacyCourseSlugAliases: Record<string, Record<string, string>> = {
  s123: {
    'introduccion-a-seminario-i': 'clase-inaugural-seminarios',
    'materiales-de-seminario': 'materiales',
  },
};

function findNoteBySlug(courseId: string, bareSlug: string): string | null {
  const baseDir = resolveCourseScanDir(courseId);
  if (!baseDir) return null;
  const targetSlug = slugifyFilename(bareSlug.replace(/\.md$/i, ''));
  const aliasSlug = legacyCourseSlugAliases[courseId]?.[targetSlug] || '';
  const targetSlugs = new Set([targetSlug, aliasSlug].filter(Boolean));

  const walk = (dir: string): string | null => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (e.isDirectory()) {
        const found = walk(path.join(dir, e.name));
        if (found) return found;
      } else if (e.isFile() && e.name.endsWith('.md')) {
        const absPath = path.join(dir, e.name);
        const relWithinCourse = path.relative(baseDir, absPath).replace(/\\/g, '/');
        const fileSlug = slugifyFilename(e.name.replace(/\.md$/i, ''));
        const pathSlug = slugifyFilename(relWithinCourse.replace(/\.md$/i, ''));
        let data: Record<string, unknown> = {};
        try {
          data = matter(fs.readFileSync(absPath, 'utf8')).data || {};
        } catch {
          data = {};
        }
        const candidates = [
          fileSlug,
          pathSlug,
          slugifyFilename(String(data.slug || '')),
          slugifyFilename(String(data.shortSlug || '')),
          slugifyFilename(String(data.title || '')),
        ].filter(Boolean);
        if (candidates.some((candidate) => targetSlugs.has(candidate))) {
          return `cursos/${courseId}/${relWithinCourse.replace(/\\/g, '/')}`;
        }
      }
    }
    return null;
  };
  return walk(baseDir);
}

function normalizeCourseSlugOrPath(courseId: string, slugOrPath: string): { repoPath: string | null; bareSlug: string } {
  let value = String(slugOrPath || '').trim().replace(/^\/+/, '');
  const repoPrefix = `cursos/${courseId}/`;

  if (value.startsWith(repoPrefix)) {
    return {
      repoPath: value,
      bareSlug: value.slice(repoPrefix.length),
    };
  }

  if (value.startsWith(`${courseId}/`)) {
    value = value.slice(courseId.length + 1);
  }

  const bareSlug = value.replace(/\.md$/i, '');
  return {
    repoPath: sanitizeRepoMarkdownPath(`cursos/${courseId}/${bareSlug}.md`),
    bareSlug,
  };
}

export function getCourseNote(courseId: string, slugOrPath: string): { content: string; filePath: string } | null {
  const source = resolveCourseSource(courseId);
  if (!source) return null;

  // Accept full repoPath (cursos/s123/chapter/file.md) or bare slug
  const { repoPath, bareSlug } = normalizeCourseSlugOrPath(courseId, slugOrPath);
  if (!repoPath) return null;

  const file = getEditableLocalRepoFile(source, repoPath);
  if (file) return { content: file.content, filePath: repoPath };

  // Exact path not found — Obsidian filenames use spaces/accents; try fuzzy slug match
  const fuzzyRepoPath = findNoteBySlug(courseId, bareSlug);
  if (!fuzzyRepoPath) return null;

  const fuzzyFile = getEditableLocalRepoFile(source, fuzzyRepoPath);
  if (!fuzzyFile) return null;

  return { content: fuzzyFile.content, filePath: fuzzyRepoPath };
}

export function saveCourseNote(courseId: string, slugOrPath: string, content: string): { filePath: string } {
  const source = resolveCourseSource(courseId);
  if (!source) throw new Error(`Course not found: ${courseId}`);

  let { repoPath, bareSlug } = normalizeCourseSlugOrPath(courseId, slugOrPath);
  if (!repoPath) throw new Error('Invalid slug');

  if (!getEditableLocalRepoFile(source, repoPath)) {
    const fuzzyRepoPath = findNoteBySlug(courseId, bareSlug);
    if (!fuzzyRepoPath || !getEditableLocalRepoFile(source, fuzzyRepoPath)) {
      throw new Error(`Note not found: ${slugOrPath}`);
    }
    repoPath = fuzzyRepoPath;
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
