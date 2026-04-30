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
  const validLessons: any[] = [];

  for (const entry of entries) {
    const isIndex = entry.id.endsWith('/_index') || entry.id.endsWith('_index');
    const courseId = normalizeText(entry.id.split('/')[0]);
    if (!courseId) continue;

    if (isIndex) {
      courseMetaById.set(courseId, {
        public: Boolean(entry.data.public),
        title: String(entry.data.title || courseId),
      });
      courseDataById.set(courseId, (entry.data || {}) as Record<string, unknown>);
    } else {
      const data = entry.data as Record<string, unknown>;
      if (normalizeText(data.theme)) {
        if (!lessonsByCourseId.has(courseId)) {
          lessonsByCourseId.set(courseId, []);
        }
        lessonsByCourseId.get(courseId)!.push(entry);
        validLessons.push(entry);
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

  const lessonPathIndexByCourseId = new Map<string, ReturnType<typeof buildCourseLessonPathIndex>>();
  const isTeacher = role === 'teacher';

  return validLessons
    .filter((entry) => {
      const courseId = normalizeText(entry.id.split('/')[0]);
      if (!accessibleCourseIds.has(courseId)) return false;

      const data = entry.data as Record<string, unknown>;
      if (!session) {
        const visibility = normalizeText(data.visibility).toLowerCase();
        if (visibility === 'enrolled-only') return false;
      }

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
      
      if (!lessonPathIndexByCourseId.has(courseId)) {
        const lessons = (lessonsByCourseId.get(courseId) || [])
          .sort((a, b) => (Number(a.data?.order || 0) - Number(b.data?.order || 0)));
        lessonPathIndexByCourseId.set(
          courseId,
          buildCourseLessonPathIndex(courseId, courseDataById.get(courseId) || {}, lessons),
        );
      }

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
