import { createHash } from 'node:crypto';
import { parseEvalBlock } from './eval/parse-eval-block.mjs';
import { safeGetCollection } from './safe-content-collection';

export type EvalNoteType = 'course' | 'lesson' | 'assignment' | 'project' | 'unknown';

export const EVAL_NOTE_TYPE_ORDER: Record<EvalNoteType, number> = {
  course: 1,
  lesson: 2,
  assignment: 3,
  project: 4,
  unknown: 99,
};

export const EVAL_NOTE_TYPE_LABEL: Record<EvalNoteType, string> = {
  course: 'Curso',
  lesson: 'Clases',
  assignment: 'Trabajos',
  project: 'Proyectos',
  unknown: 'Sin tipo',
};

const asText = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    const cleaned = value.trim();
    return cleaned || fallback;
  }
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
};

const decodeUriSafe = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizePath = (value: string): string =>
  decodeUriSafe(value)
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();

const sanitizeFallbackId = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>)
    .sort((left, right) => left.localeCompare(right, 'en'))
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortValue((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
};

const stableStringify = (value: unknown): string => JSON.stringify(sortValue(value));

const hashSnapshot = (value: unknown): string =>
  createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');

const extractEvalBlocks = (markdown: string): string[] => {
  const blocks: string[] = [];
  const pattern = /```eval\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(markdown)) !== null) {
    if (match[1]) blocks.push(match[1]);
  }

  return blocks;
};

export const normalizeEvalNoteType = (rawType: unknown): EvalNoteType => {
  const normalized = asText(rawType).toLowerCase();
  if (!normalized) return 'unknown';

  if (['course', 'curso'].includes(normalized)) return 'course';
  if (['lesson', 'class', 'clase', 'module', 'modulo', 'módulo'].includes(normalized)) return 'lesson';
  if (['assignment', 'task', 'trabajo', 'exercise', 'ejercicio'].includes(normalized)) return 'assignment';
  if (['project', 'proyecto'].includes(normalized)) return 'project';
  return 'unknown';
};

export const inferEvalNoteTypeFromSlug = (assignmentSlug: string, fallbackCourseId = ''): EvalNoteType => {
  const normalizedSlug = normalizePath(assignmentSlug);
  const normalizedCourseId = normalizePath(fallbackCourseId);

  if (!normalizedSlug) return 'unknown';
  if (normalizedSlug.endsWith('/_index') || normalizedSlug === normalizedCourseId) return 'course';
  if (normalizedSlug.includes('/assignment/') || normalizedSlug.includes('/trabajos/')) return 'assignment';
  if (normalizedSlug.includes('/project/') || normalizedSlug.includes('/proyectos/')) return 'project';
  if (normalizedSlug.includes('/lesson/') || normalizedSlug.includes('/class/') || normalizedSlug.includes('/clases/')) {
    return 'lesson';
  }
  return 'unknown';
};

export type EvalCatalogEntry = {
  evalId: string;
  evalType: string;
  mode: string;
  points: number;
  prompt: string;
  group: string;
  options: string[];
  contentHash: string;
  contentVersion: string;
  evalSnapshot: Record<string, unknown>;
  noteType: EvalNoteType;
  noteTypeOrder: number;
  noteTypeLabel: string;
  sourceCollection: 'cursos' | 'content';
  entryId: string;
  entryTitle: string;
  courseId: string;
  sourcePath: string;
};

export type EvalCatalogMap = Map<string, EvalCatalogEntry[]>;

const toOptionTextList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((option) => {
      if (typeof option === 'string') return option.trim();
      if (option && typeof option === 'object') {
        const objectOption = option as Record<string, unknown>;
        return asText(
          objectOption.text
            || objectOption.label
            || objectOption.value
            || objectOption.id
            || '',
          '',
        );
      }
      return '';
    })
    .filter(Boolean);
};

const buildEvalSnapshot = (parsed: Record<string, unknown>): Record<string, unknown> => {
  const options = toOptionTextList((parsed as Record<string, unknown>).options);
  const checks = toOptionTextList(
    (parsed as Record<string, unknown>).checks
      || (parsed as Record<string, unknown>).criteriaPrompts
      || [],
  );
  const referencePatch = asText((parsed as Record<string, unknown>).referencePatch);
  return sortValue({
    id: asText((parsed as Record<string, unknown>).id),
    type: asText((parsed as Record<string, unknown>).type, 'unknown'),
    mode: asText((parsed as Record<string, unknown>).mode, 'self'),
    title: asText((parsed as Record<string, unknown>).title),
    prompt: asText((parsed as Record<string, unknown>).prompt),
    group: asText((parsed as Record<string, unknown>).group),
    points: Number((parsed as Record<string, unknown>).points || 0) || 0,
    options,
    allowEdit: Boolean((parsed as Record<string, unknown>).allowEdit),
    allowMultiple: Boolean((parsed as Record<string, unknown>).allowMultiple),
    anonymous: Boolean((parsed as Record<string, unknown>).anonymous),
    showResults: Boolean((parsed as Record<string, unknown>).showResults),
    timed: Boolean((parsed as Record<string, unknown>).timed),
    timerSeconds: Number((parsed as Record<string, unknown>).timerSeconds || 0) || 0,
    referencePatchHash: referencePatch ? hashSnapshot(referencePatch) : '',
    referencePatchChars: referencePatch.length,
    evaluationPrompt: asText((parsed as Record<string, unknown>).evaluationPrompt),
    checks,
    provider: asText((parsed as Record<string, unknown>).provider),
    model: asText((parsed as Record<string, unknown>).model),
    passScore: Number((parsed as Record<string, unknown>).passScore || 0) || 0,
    minChars: Number((parsed as Record<string, unknown>).minChars || 0) || 0,
  }) as Record<string, unknown>;
};

const resolveEntryNoteType = (
  sourceCollection: 'cursos' | 'content',
  entryId: string,
  entryData: Record<string, unknown>,
): EvalNoteType => {
  const explicit = normalizeEvalNoteType(entryData.type);
  if (explicit !== 'unknown') return explicit;

  if (sourceCollection === 'cursos') {
    if (entryId.endsWith('/_index')) return 'course';
    return 'lesson';
  }

  const normalizedId = normalizePath(entryId);
  if (normalizedId.includes('/proyectos/')) return 'project';
  if (normalizedId.includes('/trabajos/')) return 'assignment';
  if (normalizedId.includes('/clases/')) return 'lesson';

  return 'unknown';
};

const buildCollectionCatalog = async (
  sourceCollection: 'cursos' | 'content',
): Promise<EvalCatalogMap> => {
  const entries = await safeGetCollection(sourceCollection);
  const catalog: EvalCatalogMap = new Map();

  entries.forEach((entry: any) => {
    const markdown = typeof entry.body === 'string' ? entry.body : '';
    if (!markdown) return;

    const blocks = extractEvalBlocks(markdown);
    if (blocks.length === 0) return;

    const entryId = String(entry.id || '');
    const entryTitle = asText(entry?.data?.title, entryId.split('/').pop() || entryId);
    const courseId = sourceCollection === 'cursos'
      ? asText(entryId.split('/')[0])
      : asText((entry?.data as Record<string, unknown>)?.courseId || (entry?.data as Record<string, unknown>)?.course);
    const noteType = resolveEntryNoteType(sourceCollection, entryId, (entry?.data || {}) as Record<string, unknown>);
    const noteTypeOrder = EVAL_NOTE_TYPE_ORDER[noteType];
    const noteTypeLabel = EVAL_NOTE_TYPE_LABEL[noteType];

    blocks.forEach((block, index) => {
      try {
        const fallbackIdBase = sanitizeFallbackId(entryId) || `${sourceCollection}-entry`;
        const parsed = parseEvalBlock(block, {
          fallbackId: `${fallbackIdBase}-eval-${index + 1}`,
        }) as Record<string, unknown> | null;

        if (!parsed) return;

        const evalId = asText(parsed.id);
        if (!evalId) return;

        const evalSnapshot = buildEvalSnapshot(parsed);
        const contentHash = hashSnapshot(evalSnapshot);
        const explicitVersion = asText(
          (parsed as Record<string, unknown>).contentVersion
            || (parsed as Record<string, unknown>).version
            || (parsed as Record<string, unknown>).revision
            || '',
        );
        const contentVersion = explicitVersion || contentHash.slice(0, 12);

        const metadata: EvalCatalogEntry = {
          evalId,
          evalType: asText(parsed.type, 'unknown'),
          mode: asText(parsed.mode, 'self'),
          points: Number(parsed.points || 0) || 0,
          prompt: asText(parsed.prompt || parsed.title || ''),
          group: asText(parsed.group),
          options: toOptionTextList((parsed as Record<string, unknown>).options),
          contentHash,
          contentVersion,
          evalSnapshot,
          noteType,
          noteTypeOrder,
          noteTypeLabel,
          sourceCollection,
          entryId,
          entryTitle,
          courseId,
          sourcePath: `${sourceCollection}/${entryId}`,
        };

        const existing = catalog.get(evalId) || [];
        existing.push(metadata);
        catalog.set(evalId, existing);
      } catch {
        // Skip malformed eval blocks and continue catalog construction.
      }
    });
  });

  return catalog;
};

export async function buildEvalCatalog(): Promise<EvalCatalogMap> {
  const [courseCatalog, contentCatalog] = await Promise.all([
    buildCollectionCatalog('cursos'),
    buildCollectionCatalog('content'),
  ]);

  const merged: EvalCatalogMap = new Map();
  const mergeFrom = (source: EvalCatalogMap) => {
    source.forEach((entries, evalId) => {
      const current = merged.get(evalId) || [];
      merged.set(evalId, current.concat(entries));
    });
  };

  mergeFrom(courseCatalog);
  mergeFrom(contentCatalog);
  return merged;
}

export function resolveEvalCatalogEntry(
  entries: EvalCatalogEntry[] = [],
  assignmentSlug = '',
): EvalCatalogEntry | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (entries.length === 1) return entries[0];

  const normalizedSlug = normalizePath(assignmentSlug);
  if (!normalizedSlug) return entries[0];

  const byExactPath = entries.find((entry) => {
    const normalizedEntryId = normalizePath(entry.entryId);
    return normalizedEntryId && normalizedSlug.endsWith(normalizedEntryId);
  });
  if (byExactPath) return byExactPath;

  const byContains = entries.find((entry) => {
    const normalizedEntryId = normalizePath(entry.entryId);
    return normalizedEntryId && normalizedSlug.includes(normalizedEntryId);
  });
  if (byContains) return byContains;

  const byCourse = entries.find((entry) => {
    const normalizedCourseId = normalizePath(entry.courseId);
    return normalizedCourseId && normalizedSlug.startsWith(`${normalizedCourseId}/`);
  });
  if (byCourse) return byCourse;

  return entries[0];
}
