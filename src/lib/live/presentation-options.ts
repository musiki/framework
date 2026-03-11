import type { Session } from '@auth/core/types';
import { getCollection } from 'astro:content';
import { createClient } from '@supabase/supabase-js';
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
  supabaseKey,
  supabaseUrl,
}: {
  activeCourseId?: string;
  session: Session | null;
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

  if (session?.user?.email && supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const email = normalizeText(session.user.email);

      if (email) {
        const { data: resolvedUser } = await supabase
          .from('User')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        const userId = normalizeText(resolvedUser?.id);
        if (userId) {
          const { data: enrollments } = await supabase
            .from('Enrollment')
            .select('courseId')
            .eq('userId', userId);

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

  return entries
    .filter((entry) => !entry.id.endsWith('/_index') && !entry.id.endsWith('_index'))
    .filter((entry) => {
      const theme = normalizeText((entry.data as Record<string, unknown>).theme);
      if (!theme) return false;

      const courseId = normalizeText(entry.id.split('/')[0]);
      if (!courseId || !accessibleCourseIds.has(courseId)) return false;

      if (!session) {
        const visibility = normalizeText((entry.data as Record<string, unknown>).visibility).toLowerCase();
        if (visibility === 'enrolled-only') return false;
      }

      return true;
    })
    .map((entry) => {
      const courseId = normalizeText(entry.id.split('/')[0]);
      const theme = normalizeText((entry.data as Record<string, unknown>).theme);
      const courseTitle = courseMetaById.get(courseId)?.title || courseId;

      return {
        courseId,
        label: `${courseTitle} / ${entry.data.title} (${theme})`,
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
    .sort((left, right) => {
      const leftActive = left.courseId === normalizedActiveCourseId ? -1 : 0;
      const rightActive = right.courseId === normalizedActiveCourseId ? -1 : 0;
      if (leftActive !== rightActive) return leftActive - rightActive;
      if (left.courseId !== right.courseId) return left.courseId.localeCompare(right.courseId, 'es');
      return left.label.localeCompare(right.label, 'es');
    });
};
