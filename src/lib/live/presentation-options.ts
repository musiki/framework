import type { Session } from '@auth/core/types';
import { getCollection } from 'astro:content';
import { canonicalizeCourseId } from '../course-alias';
import { buildCourseLessonPathIndex, buildCourseSlideLessonHref } from '../course-routing';

export type RoomPresentationOption = {
  courseId: string;
  label: string;
  lessonId: string;
  theme: string;
  value: string;
};

const normalizeText = (value: unknown) => String(value ?? '').trim();

let cachedCollection: any[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

export const listRoomPresentationOptions = async ({
  activeCourseId = '',
  session,
  role = 'student',
}: {
  activeCourseId?: string;
  session: Session | null;
  role?: 'teacher' | 'student';
}): Promise<RoomPresentationOption[]> => {
  const now = Date.now();
  if (!cachedCollection || now - lastCacheTime > CACHE_TTL) {
    cachedCollection = await getCollection('cursos');
    lastCacheTime = now;
  }
  const entries = cachedCollection!;
  
  const courseMetaById = new Map<string, { public: boolean; title: string }>();
  const courseDataById = new Map<string, Record<string, unknown>>();
  const lessonsByCourseId = new Map<string, any[]>();

  // Single pass to group and meta
  for (const entry of entries) {
    const segments = entry.id.split('/');
    const courseId = normalizeText(segments[0]);
    if (!courseId) continue;

    const isIndex = entry.id.endsWith('/_index') || entry.id.endsWith('_index');

    if (isIndex) {
      courseMetaById.set(courseId, {
        public: Boolean(entry.data.public),
        title: String(entry.data.title || courseId),
      });
      courseDataById.set(courseId, (entry.data || {}) as Record<string, unknown>);
    } else {
      const data = entry.data as Record<string, unknown>;
      if (normalizeText(data.theme)) {
        if (!lessonsByCourseId.has(courseId)) lessonsByCourseId.set(courseId, []);
        lessonsByCourseId.get(courseId)!.push(entry);
      }
    }
  }

  const accessibleCourseIds = new Set<string>();
  courseMetaById.forEach((meta, courseId) => {
    if (meta.public) accessibleCourseIds.add(courseId);
  });

  if (session?.user?.email) {
    try {
      const { query } = await import('../db/pool');
      const email = normalizeText(session.user.email);

      if (email) {
        const { data: dbUserRows } = await query(
          `SELECT id FROM "User" WHERE "email" = $1`,
          [email]
        );

        const userId = normalizeText(dbUserRows?.[0]?.id);
        if (userId) {
          const { data: enrollments } = await query(
            `SELECT "courseId" FROM "Enrollment" WHERE "userId" = $1`,
            [userId]
          );

          for (const enrollment of Array.isArray(enrollments) ? enrollments : []) {
            const cId = await canonicalizeCourseId(
              normalizeText((enrollment as { courseId?: string | null }).courseId),
            );
            if (cId) accessibleCourseIds.add(cId);
          }
        }
      }
    } catch (error) {
      console.error('Room presentation options lookup failed:', error);
    }
  }

  const isTeacher = role === 'teacher';
  const result: RoomPresentationOption[] = [];

  // Grouped iteration is O(N) total across all courses
  for (const [courseId, lessons] of lessonsByCourseId.entries()) {
    if (!accessibleCourseIds.has(courseId)) continue;

    const courseData = courseDataById.get(courseId) || {};
    const courseTitle = courseMetaById.get(courseId)?.title || courseId;

    // Pre-sort lessons for this course once
    const sortedLessons = [...lessons].sort((a, b) => (Number(a.data?.order || 0) - Number(b.data?.order || 0)));
    const pathIndex = buildCourseLessonPathIndex(courseId, courseData, sortedLessons);

    for (const entry of sortedLessons) {
      const data = entry.data as Record<string, unknown>;
      
      // Visibility checks
      if (!session) {
        const visibility = normalizeText(data.visibility).toLowerCase();
        if (visibility === 'enrolled-only') continue;
      }
      if (!isTeacher) {
        const status = normalizeText(data.status).toLowerCase();
        if (status === 'draft' || status === 'private') continue;
      }

      result.push({
        courseId,
        label: `${courseTitle} 〉${entry.data.title} (${normalizeText(data.theme)})`,
        lessonId: entry.id,
        theme: normalizeText(data.theme),
        value: buildCourseSlideLessonHref(courseId, courseData, entry, pathIndex),
      });
    }
  }

  return result.sort((left, right) => left.label.localeCompare(right.label, 'es'));
};
