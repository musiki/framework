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

export const listRoomPresentationOptions = async ({
  activeCourseId = '',
  session,
  role = 'student',
  supabaseKey,
  supabaseUrl,
}: {
  activeCourseId?: string;
  session: Session | null;
  role?: 'teacher' | 'student';
  supabaseKey?: string;
  supabaseUrl?: string;
}): Promise<RoomPresentationOption[]> => {
  const entries = await getCollection('cursos');
  const courseMetaById = new Map<string, { public: boolean; title: string }>();
  const courseDataById = new Map<string, Record<string, unknown>>();

  for (const entry of entries) {
    if (!entry.id.endsWith('/_index') && !entry.id.endsWith('_index')) continue;

    const courseId = normalizeText(entry.id.replace(/\/_index$/, ''));
    if (!courseId) continue;

    courseMetaById.set(courseId, {
      public: Boolean(entry.data.public),
      title: String(entry.data.title || courseId),
    });
    courseDataById.set(courseId, (entry.data || {}) as Record<string, unknown>);
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
            const courseId = await canonicalizeCourseId(
              normalizeText((enrollment as { courseId?: string | null }).courseId),
            );
            if (courseId) accessibleCourseIds.add(courseId);
          }
        }
      }
    } catch (error) {
      console.error('Room presentation options lookup failed:', error);
    }
  }

  const normalizedActiveCourseId = normalizeText(activeCourseId);
  const lessonPathIndexByCourseId = new Map<string, ReturnType<typeof buildCourseLessonPathIndex>>();

  courseDataById.forEach((courseData, courseId) => {
    const lessons = entries
      .filter((entry) => entry.id.startsWith(`${courseId}/`) && !entry.id.endsWith('/_index') && !entry.id.endsWith('_index'))
      .sort((a, b) => (Number(a.data?.order || 0) - Number(b.data?.order || 0)));

    lessonPathIndexByCourseId.set(
      courseId,
      buildCourseLessonPathIndex(courseId, courseData, lessons),
    );
  });

  const isTeacher = role === 'teacher';

  return entries
    .filter((entry) => !entry.id.endsWith('/_index') && !entry.id.endsWith('_index'))
    .filter((entry) => {
      const data = entry.data as Record<string, unknown>;
      const theme = normalizeText(data.theme);
      if (!theme) return false;

      const courseId = normalizeText(entry.id.split('/')[0]);
      if (!courseId) return false;

      // Relaxed: Show all accessible lessons with a theme, not just active course
      // if (normalizedActiveCourseId && courseId !== normalizedActiveCourseId) return false;

      if (!accessibleCourseIds.has(courseId)) return false;

      if (!session) {
        const visibility = normalizeText(data.visibility).toLowerCase();
        if (visibility === 'enrolled-only') return false;
      }

      // Students cannot see draft or private lessons
      if (!isTeacher) {
        const status = normalizeText(data.status).toLowerCase();
        if (status === 'draft' || status === 'private') return false;
      }

      return true;
    })
    .map((entry) => {
      const courseId = normalizeText(entry.id.split('/')[0]);
      const theme = normalizeText((entry.data as Record<string, unknown>).theme);
      const courseTitle = courseMetaById.get(courseId)?.title || courseId;

      return {
        courseId,
        label: `${courseTitle} 〉${entry.data.title} (${theme})`,
        lessonId: entry.id,
        theme,
        value: buildCourseSlideLessonHref(
          courseId,
          courseDataById.get(courseId) || {},
          entry,
          lessonPathIndexByCourseId.get(courseId),
        ),
      } satisfies RoomPresentationOption;
    })
    .sort((left, right) => left.label.localeCompare(right.label, 'es'));
};
