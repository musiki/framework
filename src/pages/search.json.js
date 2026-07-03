import { getCollection } from 'astro:content';
import { safeGetCollection } from '../lib/safe-content-collection';
import {
  buildCourseHref,
  buildCourseLessonHref,
  buildCourseLessonPathIndex,
  getCourseEntryCourseId,
  isCourseIndexEntry,
  isCourseLessonEntryForCourse,
} from '../lib/course-routing';
import { getContentCanonicalSlug } from '../lib/content-slug';

export const prerender = false;

function cleanMarkdown(md) {
  if (!md) return '';
  return md
    .replace(/^---[\s\S]*?---/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^\)]+\)/g, '$1')
    .replace(/[\*_]{1,3}([^*_]+)[\*_]{1,3}/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const hasPublicStatus = (item) => String(item?.data?.status || '').trim().toLowerCase() === 'public';

export async function GET({ locals }) {
  const hasSession = Boolean(locals?.session?.user);
  const [content, cursos] = await Promise.all([
    safeGetCollection('content'),
    getCollection('cursos'),
  ]);

  const visibleContent = hasSession ? content : content.filter(hasPublicStatus);
  const visibleCursos = hasSession ? cursos : cursos.filter(hasPublicStatus);

  const contentItems = visibleContent.map((item) => {
    const filename = item.id.split('/').pop()?.replace(/\.[^/.]+$/, '');
    const title = item.data.title || filename || 'Untitled';
    const slug = getContentCanonicalSlug(item);
    const hasDataview =
      item.body && (item.body.includes('```dataview') || item.body.includes('```dataviewjs'));
    const itemType = String(item.data.type || '').trim().toLowerCase();
    const type =
      (itemType === 'concept' && 'Concept')
      || (itemType === 'glossary' && 'Glossary')
      || (itemType === 'notes' && 'Note')
      || (itemType === 'public-note' && 'Note')
      || 'Note';
      
    const reveal = Boolean(item.data.reveal === true || item.data.reveal === 'true' || item.data.theme || item.data.slideTheme || item.data.revealTheme);

    return {
      title,
      slug: '/' + slug,
      content: cleanMarkdown(item.body || ''),
      type,
      hasDataview,
      reveal,
      isPublic: true,
      def: item.data.def || item.data.definition || '',
      sinopsis: item.data.sinopsis || item.data.synopsis || item.data.description || '',
    };
  });

  const courseIndexById = new Map();
  visibleCursos.forEach((item) => {
    if (!isCourseIndexEntry(item)) return;
    const courseId = getCourseEntryCourseId(item);
    if (!courseId) return;
    courseIndexById.set(courseId, item);
  });

  const lessonPathIndexByCourseId = new Map();
  courseIndexById.forEach((courseEntry, courseId) => {
    const lessons = visibleCursos
      .filter((item) => isCourseLessonEntryForCourse(item, courseId))
      .sort((a, b) => (Number(a.data?.order || 0) - Number(b.data?.order || 0)));

    lessonPathIndexByCourseId.set(
      courseId,
      buildCourseLessonPathIndex(courseId, courseEntry.data || {}, lessons),
    );
  });

  const courseItems = visibleCursos.map((item) => {
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
      || (itemType === 'concept' && 'Concept')
      || (itemType === 'glossary' && 'Glossary')
      || (itemType === 'notes' && 'Note')
      || (itemType === 'public-note' && 'Note')
      || (isCourseIndex ? 'Course' : 'Lesson');
      
    const reveal = Boolean(item.data.reveal === true || item.data.reveal === 'true' || item.data.theme || item.data.slideTheme || item.data.revealTheme);
    const isPublic = itemType === 'public-note' || !courseId;

    return {
      title,
      slug,
      content: cleanMarkdown(item.body || ''),
      type,
      hasDataview: false,
      reveal,
      courseId,
      isPublic,
      def: item.data.def || item.data.definition || '',
      sinopsis: item.data.sinopsis || item.data.synopsis || item.data.description || '',
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
