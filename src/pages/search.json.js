import { getCollection } from 'astro:content';
import {
  buildCourseHref,
  buildCourseLessonHref,
  buildCourseLessonPathIndex,
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
    if (!item.id.endsWith('/_index') && !item.id.endsWith('_index')) return;
    courseIndexById.set(item.id.replace(/\/_index$/, ''), item);
  });

  const lessonPathIndexByCourseId = new Map();
  courseIndexById.forEach((courseEntry, courseId) => {
    const lessons = cursos
      .filter((item) => item.id.startsWith(`${courseId}/`) && !item.id.endsWith('/_index') && !item.id.endsWith('_index'))
      .sort((a, b) => (Number(a.data?.order || 0) - Number(b.data?.order || 0)));

    lessonPathIndexByCourseId.set(
      courseId,
      buildCourseLessonPathIndex(courseId, courseEntry.data || {}, lessons),
    );
  });

  const courseItems = cursos.map((item) => {
    const isCourseIndex = item.id.endsWith('/_index') || item.id.endsWith('_index');
    const courseId = isCourseIndex ? item.id.replace(/\/_index$/, '') : '';
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
