import fs from 'node:fs';
import path from 'node:path';
import type { CollectionEntry } from 'astro:content';
import matter from 'gray-matter';
import { getCourseFrontmatterId } from './course-metadata';

type CourseEntry = CollectionEntry<'cursos'>;

const normalizeText = (value: unknown) => String(value || '').trim();
const normalizeFilePath = (value: unknown) => normalizeText(value).replace(/\\/g, '/');
const stripMarkdownExtension = (value: string) => String(value || '').replace(/\.(md|mdx)$/i, '');
const cachedExplicitSlugByFilePath = new Map<string, string>();

export const toCoursePathSlug = (value: unknown) =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const encodePathSegments = (value: string) =>
  String(value || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const getEntryIdBasename = (entryId: string) => {
  const parts = String(entryId || '').split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
};

const getEntryFilePath = (entry: { filePath?: string } | null | undefined) =>
  normalizeFilePath(entry?.filePath);

const getEntryExplicitRouteSlug = (entry: CourseEntry) => {
  const filePath = getEntryFilePath(entry);
  if (!filePath) return '';

  if (cachedExplicitSlugByFilePath.has(filePath)) {
    return cachedExplicitSlugByFilePath.get(filePath) || '';
  }

  let explicitSlug = '';
  try {
    const source = fs.readFileSync(path.resolve(filePath), 'utf8');
    const parsed = matter(source).data || {};
    explicitSlug = normalizeText(parsed.slug || parsed.shortSlug);
  } catch {
    explicitSlug = '';
  }

  cachedExplicitSlugByFilePath.set(filePath, explicitSlug);
  return explicitSlug;
};

const getEntrySourceBasename = (entry: CourseEntry) => {
  const filePath = getEntryFilePath(entry);
  if (filePath) {
    return stripMarkdownExtension(filePath.split('/').filter(Boolean).pop() || '');
  }
  return getEntryIdBasename(entry.id);
};

export const isCourseIndexEntry = (
  entry: Pick<CourseEntry, 'id'> & { filePath?: string },
) => {
  const filePath = getEntryFilePath(entry);
  if (filePath) return /\/_index\.mdx?$/i.test(filePath);

  const entryId = normalizeText(entry.id);
  return entryId.endsWith('/_index') || entryId.endsWith('_index');
};

export const getCourseEntryCourseId = (
  entry: Pick<CourseEntry, 'id'> & { filePath?: string },
) => {
  const filePath = getEntryFilePath(entry);
  const filePathMatch = filePath.match(/(?:^|\/)src\/content\/cursos\/([^/]+)\//);
  if (filePathMatch?.[1]) return filePathMatch[1];

  const entryId = normalizeText(entry.id);
  if (!entryId) return '';
  if (entryId.endsWith('/_index')) return entryId.replace(/\/_index$/, '');
  if (entryId.endsWith('_index')) return entryId.replace(/_index$/, '');
  return entryId.split('/').filter(Boolean)[0] || '';
};

export const isCourseLessonEntryForCourse = (
  entry: CourseEntry,
  canonicalCourseId: string,
) => {
  if (!canonicalCourseId || isCourseIndexEntry(entry)) return false;

  const filePath = getEntryFilePath(entry);
  if (filePath) return filePath.startsWith(`src/content/cursos/${canonicalCourseId}/`);

  return entry.id.startsWith(`${canonicalCourseId}/`);
};

export const getCourseEntryLegacyPath = (
  entry: CourseEntry,
  canonicalCourseId: string,
) => {
  const filePath = getEntryFilePath(entry);
  const filePathPrefix = `src/content/cursos/${canonicalCourseId}/`;
  if (filePath.startsWith(filePathPrefix)) {
    return stripMarkdownExtension(filePath.slice(filePathPrefix.length));
  }

  return canonicalCourseId
    ? entry.id.replace(`${canonicalCourseId}/`, '')
    : normalizeText(entry.id);
};

export const getPreferredCoursePathSegment = (
  canonicalCourseId: string,
  courseData: Record<string, unknown> = {},
) => {
  const preferred = getCourseFrontmatterId(courseData, canonicalCourseId);
  return toCoursePathSlug(preferred) || toCoursePathSlug(canonicalCourseId) || normalizeText(canonicalCourseId);
};

const getLessonBaseSlug = (entry: CourseEntry) => {
  const data = (entry.data || {}) as Record<string, unknown>;
  const sourceBasename = getEntrySourceBasename(entry);
  const explicitSlug = getEntryExplicitRouteSlug(entry);
  const preferred = normalizeText(explicitSlug || data.slug || data.shortSlug || data.title || sourceBasename);
  return toCoursePathSlug(preferred) || toCoursePathSlug(sourceBasename) || sourceBasename;
};

const getLessonAliasSlugs = (entry: CourseEntry) => {
  const data = (entry.data || {}) as Record<string, unknown>;
  const explicitSlug = normalizeText(getEntryExplicitRouteSlug(entry) || data.slug || data.shortSlug);
  if (!explicitSlug) return [];

  return Array.from(
    new Set(
      [
        toCoursePathSlug(data.title),
        toCoursePathSlug(getEntrySourceBasename(entry)),
      ].filter(Boolean),
    ),
  );
};

export type CourseLessonPathIndex = {
  coursePathSegment: string;
  entryByLegacyPath: Map<string, CourseEntry>;
  entryByShortPath: Map<string, CourseEntry>;
  entryByAliasPath: Map<string, CourseEntry>;
  pathByEntryId: Map<string, string>;
};

export const buildCourseLessonPathIndex = (
  canonicalCourseId: string,
  courseData: Record<string, unknown>,
  lessons: CourseEntry[],
): CourseLessonPathIndex => {
  const coursePathSegment = getPreferredCoursePathSegment(canonicalCourseId, courseData);
  const entryByLegacyPath = new Map<string, CourseEntry>();
  const entryByShortPath = new Map<string, CourseEntry>();
  const entryByAliasPath = new Map<string, CourseEntry>();
  const pathByEntryId = new Map<string, string>();

  const baseSlugCounts = new Map<string, number>();
  const baseSlugByEntryId = new Map<string, string>();
  const aliasSlugCounts = new Map<string, number>();
  const aliasSlugsByEntryId = new Map<string, string[]>();

  for (const lesson of lessons) {
    const baseSlug = getLessonBaseSlug(lesson);
    baseSlugByEntryId.set(lesson.id, baseSlug);
    baseSlugCounts.set(baseSlug, (baseSlugCounts.get(baseSlug) || 0) + 1);

    const aliasSlugs = getLessonAliasSlugs(lesson);
    aliasSlugsByEntryId.set(lesson.id, aliasSlugs);
    for (const aliasSlug of aliasSlugs) {
      aliasSlugCounts.set(aliasSlug, (aliasSlugCounts.get(aliasSlug) || 0) + 1);
    }
  }

  const usedShortPaths = new Set<string>();

  for (const lesson of lessons) {
    const legacyPath = getCourseEntryLegacyPath(lesson, canonicalCourseId);
    if (legacyPath) {
      entryByLegacyPath.set(legacyPath, lesson);
    }

    const baseSlug = baseSlugByEntryId.get(lesson.id) || getLessonBaseSlug(lesson);
    let nextShortPath = baseSlug;

    if (usedShortPaths.has(nextShortPath) || (baseSlugCounts.get(baseSlug) || 0) > 1) {
      const filenameSlug = toCoursePathSlug(getEntrySourceBasename(lesson));
      if (filenameSlug && !usedShortPaths.has(filenameSlug)) {
        nextShortPath = filenameSlug;
      } else {
        let suffix = 2;
        while (usedShortPaths.has(`${baseSlug}-${suffix}`)) {
          suffix += 1;
        }
        nextShortPath = `${baseSlug}-${suffix}`;
      }
    }

    usedShortPaths.add(nextShortPath);
    entryByShortPath.set(nextShortPath, lesson);
    pathByEntryId.set(lesson.id, nextShortPath);

    const aliasSlugs = aliasSlugsByEntryId.get(lesson.id) || [];
    for (const aliasSlug of aliasSlugs) {
      if (!aliasSlug) continue;
      if (aliasSlug === nextShortPath) continue;
      if (entryByLegacyPath.has(aliasSlug)) continue;
      if (entryByShortPath.has(aliasSlug)) continue;
      if ((aliasSlugCounts.get(aliasSlug) || 0) > 1) continue;
      entryByAliasPath.set(aliasSlug, lesson);
    }
  }

  return {
    coursePathSegment,
    entryByLegacyPath,
    entryByShortPath,
    entryByAliasPath,
    pathByEntryId,
  };
};

export const findLessonByCoursePath = (
  requestedPath: string,
  pathIndex: CourseLessonPathIndex,
) => {
  const normalizedRequestedPath = normalizeText(requestedPath).replace(/^\/+|\/+$/g, '');
  if (!normalizedRequestedPath) return null;

  const byLegacy = pathIndex.entryByLegacyPath.get(normalizedRequestedPath);
  if (byLegacy) {
    return {
      entry: byLegacy,
      shortPath: pathIndex.pathByEntryId.get(byLegacy.id) || normalizedRequestedPath,
      isLegacyPath: true,
    };
  }

  const byShort = pathIndex.entryByShortPath.get(normalizedRequestedPath);
  if (byShort) {
    return {
      entry: byShort,
      shortPath: pathIndex.pathByEntryId.get(byShort.id) || normalizedRequestedPath,
      isLegacyPath: false,
    };
  }

  const byAlias = pathIndex.entryByAliasPath.get(normalizedRequestedPath);
  if (byAlias) {
    return {
      entry: byAlias,
      shortPath: pathIndex.pathByEntryId.get(byAlias.id) || normalizedRequestedPath,
      isLegacyPath: true,
    };
  }

  return null;
};

export const buildCourseHref = (
  canonicalCourseId: string,
  courseData: Record<string, unknown> = {},
) => `/cursos/${encodePathSegments(getPreferredCoursePathSegment(canonicalCourseId, courseData))}`;

export const buildCourseLessonHref = (
  canonicalCourseId: string,
  courseData: Record<string, unknown>,
  lessonEntry: CourseEntry,
  pathIndex?: CourseLessonPathIndex,
) => {
  const resolvedIndex = pathIndex || buildCourseLessonPathIndex(canonicalCourseId, courseData, [lessonEntry]);
  const lessonPath = resolvedIndex.pathByEntryId.get(lessonEntry.id) || getLessonBaseSlug(lessonEntry);
  return `${buildCourseHref(canonicalCourseId, courseData)}/${encodePathSegments(lessonPath)}`;
};

export const buildCourseSlideLessonHref = (
  canonicalCourseId: string,
  courseData: Record<string, unknown>,
  lessonEntry: CourseEntry,
  pathIndex?: CourseLessonPathIndex,
) => {
  const resolvedIndex = pathIndex || buildCourseLessonPathIndex(canonicalCourseId, courseData, [lessonEntry]);
  const lessonPath = resolvedIndex.pathByEntryId.get(lessonEntry.id) || getLessonBaseSlug(lessonEntry);
  return `/cursos/slides/${encodePathSegments(getPreferredCoursePathSegment(canonicalCourseId, courseData))}/${encodePathSegments(lessonPath)}`;
};
