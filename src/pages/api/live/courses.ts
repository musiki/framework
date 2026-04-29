import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getCourseFrontmatterId, getCourseLegacyCode } from '../../../lib/course-metadata';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

const dedupeCourseIds = (rows: Array<{ courseId?: string | null }> | null | undefined) => {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const row of rows) {
    const value = String(row?.courseId || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
};

const normalizeText = (value: unknown) => String(value || '').trim();
const normalizeKey = (value: unknown) => normalizeText(value).toLowerCase();
const toAliasSlug = (value: unknown) =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const GET: APIRoute = async ({ locals }) => {
  const session = (locals as any).session;
  const email = String(session?.user?.email || '').trim();
  if (!email) return json({ courseIds: [] });

  try {
    const { query } = await import('../../../lib/db/pool');

    const { data: dbUserRows, error: userError } = await query(
      `SELECT id FROM "User" WHERE "email" = $1`,
      [email]
    );

    if (userError) {
      console.error('live/courses user lookup error:', userError);
      return json({ courseIds: [] });
    }

    const userId = String(dbUserRows?.[0]?.id || '').trim();
    if (!userId) return json({ courseIds: [] });

    const { data: enrollments, error: enrollmentsError } = await query(
      `SELECT "courseId" FROM "Enrollment" WHERE "userId" = $1`,
      [userId]
    );

    if (enrollmentsError) {
      console.error('live/courses enrollment lookup error:', enrollmentsError);
      return json({ courseIds: [] });
    }

    const rawCourseIds = dedupeCourseIds(enrollments as Array<{ courseId?: string | null }>);

    const courses = await getCollection('cursos');
    const canonicalByAlias = new Map<string, string>();
    for (const course of courses) {
      if (!course.id.endsWith('/_index') && !course.id.endsWith('_index')) continue;
      const canonicalId = normalizeText(course.id.replace(/\/_index$/, ''));
      if (!canonicalId) continue;
      const courseData = (course.data || {}) as Record<string, unknown>;

      canonicalByAlias.set(normalizeKey(canonicalId), canonicalId);
      const slugAlias = toAliasSlug(canonicalId);
      if (slugAlias) canonicalByAlias.set(slugAlias, canonicalId);

      const frontmatterId = getCourseFrontmatterId(courseData);
      if (frontmatterId) {
        canonicalByAlias.set(normalizeKey(frontmatterId), canonicalId);
        canonicalByAlias.set(toAliasSlug(frontmatterId), canonicalId);
      }

      const legacyCode = getCourseLegacyCode(courseData);
      if (legacyCode) {
        canonicalByAlias.set(normalizeKey(legacyCode), canonicalId);
        canonicalByAlias.set(toAliasSlug(legacyCode), canonicalId);
      }

      const titleAlias = toAliasSlug(courseData.title || '');
      if (titleAlias) canonicalByAlias.set(titleAlias, canonicalId);
    }

    const canonicalCourseIds = Array.from(
      new Set(
        rawCourseIds
          .map((courseId) => {
            const normalized = normalizeText(courseId);
            if (!normalized) return '';
            return canonicalByAlias.get(normalizeKey(normalized))
              || canonicalByAlias.get(toAliasSlug(normalized))
              || normalized;
          })
          .filter(Boolean),
      ),
    );

    return json({
      courseIds: canonicalCourseIds,
    });
  } catch (error) {
    console.error('live/courses unexpected error:', error);
    return json({ courseIds: [] });
  }
};
