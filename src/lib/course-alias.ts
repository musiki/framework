import { getCollection } from 'astro:content';
import { getCourseFrontmatterId, getCourseLegacyCode } from './course-metadata';

type CourseAliasCache = {
  loadedAt: number;
  aliasToCanonical: Map<string, string>;
  canonicalToAliases: Map<string, string[]>;
};

const CACHE_TTL_MS = 60_000;

let cache: CourseAliasCache | null = null;

const normalizeText = (value: unknown) => String(value || '').trim();
const normalizeKey = (value: unknown) => normalizeText(value).toLowerCase();
const toAliasSlug = (value: unknown) =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const appendAlias = (
  canonicalToAliases: Map<string, string[]>,
  canonicalId: string,
  alias: unknown,
) => {
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return;

  const aliases = canonicalToAliases.get(canonicalId) || [];
  const pushIfMissing = (value: string) => {
    if (!value) return;
    if (!aliases.includes(value)) aliases.push(value);
  };

  pushIfMissing(normalizedAlias);
  pushIfMissing(toAliasSlug(normalizedAlias));
  canonicalToAliases.set(canonicalId, aliases);
};

const ensureAliasCache = async () => {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache;
  }

  const aliasToCanonical = new Map<string, string>();
  const canonicalToAliases = new Map<string, string[]>();
  const courses = await getCollection('cursos');

  for (const course of courses) {
    if (!course.id.endsWith('/_index') && !course.id.endsWith('_index')) continue;
    const canonicalId = normalizeText(course.id.replace(/\/_index$/, ''));
    if (!canonicalId) continue;

    const courseData = (course.data || {}) as Record<string, unknown>;
    const frontmatterId = getCourseFrontmatterId(courseData, canonicalId);
    const legacyCode = getCourseLegacyCode(courseData);
    const title = normalizeText(courseData.title || '');

    const aliases = [
      canonicalId,
      toAliasSlug(canonicalId),
      frontmatterId,
      legacyCode,
      title,
      toAliasSlug(title),
    ];
    for (const alias of aliases) {
      const normalizedAlias = normalizeText(alias);
      if (!normalizedAlias) continue;
      aliasToCanonical.set(normalizeKey(normalizedAlias), canonicalId);
      const slugAlias = toAliasSlug(normalizedAlias);
      if (slugAlias) aliasToCanonical.set(slugAlias, canonicalId);
      appendAlias(canonicalToAliases, canonicalId, normalizedAlias);
    }
  }

  cache = {
    loadedAt: now,
    aliasToCanonical,
    canonicalToAliases,
  };

  return cache;
};

export async function canonicalizeCourseId(value: unknown): Promise<string> {
  const raw = normalizeText(value);
  if (!raw) return '';

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }

  const { aliasToCanonical } = await ensureAliasCache();
  return (
    aliasToCanonical.get(normalizeKey(decoded))
    || aliasToCanonical.get(toAliasSlug(decoded))
    || decoded
  );
}

export async function getCourseAliases(value: unknown): Promise<string[]> {
  const raw = normalizeText(value);
  if (!raw) return [];

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }

  const { aliasToCanonical, canonicalToAliases } = await ensureAliasCache();
  const canonicalId =
    aliasToCanonical.get(normalizeKey(decoded))
    || aliasToCanonical.get(toAliasSlug(decoded))
    || decoded;

  const aliases = canonicalToAliases.get(canonicalId) || [canonicalId];
  return Array.from(new Set([decoded, canonicalId, ...aliases].filter(Boolean)));
}

export async function canonicalizeCourseSlugPath(
  value: unknown,
  fallbackCourseId = '',
): Promise<string> {
  const raw = normalizeText(value).replace(/^\/+|\/+$/g, '');
  if (!raw) return '';

  const parts = raw.split('/').filter(Boolean);
  if (parts.length === 0) return '';

  const fallback = normalizeText(fallbackCourseId);
  const firstCoursePart = await canonicalizeCourseId(parts[0] || fallback || '');
  if (!firstCoursePart) return raw;

  return [firstCoursePart, ...parts.slice(1)].join('/');
}

export function clearCourseAliasCache(): void {
  cache = null;
}
