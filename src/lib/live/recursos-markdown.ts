import {
  deleteEditableLocalRepoFile,
  resolveCourseSource,
  sanitizeRepoMarkdownPath,
  writeEditableLocalRepoFile,
} from '../content-admin';
import { normalizeContentSlug } from '../content-slug';

export type LiveResourceProjectionItem = {
  id?: string;
  url: string;
  name: string;
  type: string;
  folder: string;
  source: string;
  createdAt?: string;
  sortOrder?: number;
};

const normalizeText = (value: unknown) => String(value || '').trim();
const PINNED_FOLDERS = ['DOC', 'media', 'compartidos'];

function escapeYamlString(value: unknown): string {
  return JSON.stringify(normalizeText(value));
}

function escapeMarkdownLinkText(value: unknown): string {
  return normalizeText(value).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function titleFromSlug(value: string): string {
  return normalizeText(value)
    .replace(/\.(md|mdx)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    || 'recursos';
}

export function normalizeResourceProjectionItems(items: LiveResourceProjectionItem[]): LiveResourceProjectionItem[] {
  const seen = new Set<string>();
  const result: LiveResourceProjectionItem[] = [];

  for (const item of items) {
    const url = normalizeText(item.url);
    if (!url) continue;

    const folder = normalizeText(item.folder);
    const key = `${folder}\n${url}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      ...item,
      url,
      folder,
      name: normalizeText(item.name) || url,
      type: normalizeText(item.type) || 'other',
      source: normalizeText(item.source) || 'upload',
    });
  }

  return result.map((item, index) => ({
    ...item,
    sortOrder: Number.isFinite(item.sortOrder) ? Number(item.sortOrder) : index,
  }));
}

export function resolveRecursosCourseRoot(courseRootId: unknown, claseId: unknown): string {
  const explicit = normalizeText(courseRootId);
  if (explicit) return explicit.split('/')[0] || explicit;

  const clase = normalizeText(claseId);
  return clase.split('/')[0] || '';
}

export function buildRecursosMarkdownPath(options: {
  courseRootId?: string | null;
  claseId?: string | null;
  roomName?: string | null;
}): string {
  const courseRootId = resolveRecursosCourseRoot(options.courseRootId, options.claseId);
  if (!courseRootId) return '';

  const claseId = normalizeText(options.claseId);
  const roomName = normalizeText(options.roomName);
  const lastClaseSegment = claseId.split('/').filter(Boolean).pop() || roomName || 'general';
  const slug = normalizeContentSlug(lastClaseSegment) || 'general';

  return sanitizeRepoMarkdownPath(`cursos/${courseRootId}/80 RECURSOS/recursos-${slug}.md`);
}

export function buildRecursosMarkdown(options: {
  courseRootId: string;
  claseId?: string | null;
  roomName?: string | null;
  targetPath: string;
  items: LiveResourceProjectionItem[];
}): string {
  const items = normalizeResourceProjectionItems(options.items)
    .slice()
    .sort((a, b) => {
      const folderDiff = a.folder.localeCompare(b.folder, 'es', { sensitivity: 'base' });
      if (folderDiff !== 0) return folderDiff;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
        || normalizeText(a.createdAt).localeCompare(normalizeText(b.createdAt));
    });

  const folderSet = new Set(items.map(item => item.folder).filter(Boolean));
  const folders = [
    ...PINNED_FOLDERS.filter(folder => folderSet.delete(folder)),
    ...Array.from(folderSet).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
  ];
  const rootItems = items.filter(item => !item.folder);
  const titleSeed = normalizeText(options.claseId).split('/').filter(Boolean).pop()
    || normalizeText(options.roomName)
    || 'recursos';
  const title = `Recursos - ${titleFromSlug(titleSeed)}`;

  const lines: string[] = [
    '---',
    `type: "info"`,
    `title: ${escapeYamlString(title)}`,
    `chapter: "80 RECURSOS"`,
    `status: "public"`,
    `order: 8000`,
    `resourceProjection: true`,
    `resourceSource: "postgres"`,
    options.claseId ? `claseId: ${escapeYamlString(options.claseId)}` : '',
    options.roomName ? `roomName: ${escapeYamlString(options.roomName)}` : '',
    `updatedAt: ${escapeYamlString(new Date().toISOString())}`,
    '---',
    '',
    `# ${title}`,
    '',
    '> Proyeccion automatica del pod RECURSOS. La fuente de verdad es Postgres; este archivo existe para navegacion, lectura y archivo del curso.',
    '',
  ].filter(Boolean);

  if (items.length === 0) {
    lines.push('_Sin recursos registrados._', '');
    return `${lines.join('\n')}\n`;
  }

  lines.push('```text', 'recursos/');
  folders.forEach((folder) => {
    lines.push(`  ${folder}/`);
    items
      .filter(item => item.folder === folder)
      .forEach((item) => lines.push(`    [${item.type}] ${item.name}`));
  });
  rootItems.forEach((item) => lines.push(`  [${item.type}] ${item.name}`));
  lines.push('```', '');

  for (const folder of folders) {
    lines.push(`## ${folder}`, '');
    items
      .filter(item => item.folder === folder)
      .forEach((item) => {
        lines.push(`- [${escapeMarkdownLinkText(item.name)}](${item.url}) - ${item.type} / ${item.source}`);
      });
    lines.push('');
  }

  if (rootItems.length > 0) {
    lines.push('## raiz', '');
    rootItems.forEach((item) => {
      lines.push(`- [${escapeMarkdownLinkText(item.name)}](${item.url}) - ${item.type} / ${item.source}`);
    });
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

export async function persistRecursosMarkdownProjection(options: {
  courseRootId?: string | null;
  claseId?: string | null;
  roomName?: string | null;
  items: LiveResourceProjectionItem[];
}): Promise<{ path: string; writtenPaths?: string[]; deletedPaths?: string[] } | null> {
  const courseRootId = resolveRecursosCourseRoot(options.courseRootId, options.claseId);
  if (!courseRootId) return null;

  const source = resolveCourseSource(courseRootId);
  if (!source?.id) return null;

  const targetPath = buildRecursosMarkdownPath({
    courseRootId,
    claseId: options.claseId,
    roomName: options.roomName,
  });
  if (!targetPath) return null;

  if (normalizeResourceProjectionItems(options.items).length === 0) {
    const result = deleteEditableLocalRepoFile(source, targetPath);
    return { path: result.path, deletedPaths: result.deletedPaths };
  }

  const content = buildRecursosMarkdown({
    courseRootId,
    claseId: options.claseId,
    roomName: options.roomName,
    targetPath,
    items: options.items,
  });

  const result = writeEditableLocalRepoFile(source, targetPath, content);
  return { path: result.path, writtenPaths: result.writtenPaths };
}
