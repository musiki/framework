import { getCollection } from 'astro:content';
import {
  buildCourseHref,
  buildCourseLessonHref,
  buildCourseLessonPathIndex,
  getCourseEntryCourseId,
  isCourseIndexEntry,
  isCourseLessonEntryForCourse,
} from '../lib/course-routing';
import { getContentCanonicalSlug } from '../lib/content-slug';

export async function GET() {
  const [content, cursos] = await Promise.all([
    getCollection('content'),
    getCollection('cursos'),
  ]);

  const contentItems = content.map((item) => {
    const filename = item.id.split('/').pop()?.replace(/\.[^/.]+$/, '');
    const title = item.data.title || filename || 'Untitled';
    const slug = getContentCanonicalSlug(item);
    const hasDataview =
      item.body && (item.body.includes('```dataview') || item.body.includes('```dataviewjs'));

    return {
      title,
      slug: '/' + slug,
      content: item.body || '',
      type: 'Note',
      hasDataview,
    };
  });

  const courseIndexById = new Map();
  cursos.forEach((item) => {
    if (!isCourseIndexEntry(item)) return;
    const courseId = getCourseEntryCourseId(item);
    if (!courseId) return;
    courseIndexById.set(courseId, item);
  });

  const lessonPathIndexByCourseId = new Map();
  courseIndexById.forEach((courseEntry, courseId) => {
    const lessons = cursos
      .filter((item) => isCourseLessonEntryForCourse(item, courseId))
      .sort((a, b) => (Number(a.data?.order || 0) - Number(b.data?.order || 0)));

    lessonPathIndexByCourseId.set(
      courseId,
      buildCourseLessonPathIndex(courseId, courseEntry.data || {}, lessons),
    );
  });

  const courseItems = cursos.map((item) => {
    const isCourseIndex = isCourseIndexEntry(item);
    const courseId = getCourseEntryCourseId(item);
    const filename = item.id.split('/').pop()?.replace(/\.[^/.]+$/, '');
    const title = item.data.title || filename || 'Untitled';
    const itemType = String(item.data.type || '').trim().toLowerCase();
    const slug = isCourseIndex
      ? buildCourseHref(courseId, item.data || {})
      : buildCourseLessonHref(
          courseId,
          courseIndexById.get(courseId)?.data || {},
          item,
          lessonPathIndexByCourseId.get(courseId),
        );
    const type =
      (itemType === 'assignment' && 'Assignment')
      || (itemType === 'eval' && 'Evaluation')
      || (itemType === 'lesson-presentation' && 'Presentation')
      || (itemType === 'app-dataviewjs' && 'Interactive App')
      || (itemType === 'course' && 'Course')
      || (isCourseIndex ? 'Course' : 'Lesson');

    return {
      title,
      slug,
      content: item.body || '',
      type,
      hasDataview: false,
    };
  });

  const dedupe = new Map();
  for (const item of [...contentItems, ...courseItems]) {
    const key = `${item.slug}::${item.title}`;
    if (!dedupe.has(key)) dedupe.set(key, item);
  }
  const items = Array.from(dedupe.values());

  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json' }
  });
}
