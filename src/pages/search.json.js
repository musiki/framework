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
import { ensureDbUserFromSession } from '../lib/forum-server';
import { isElevatedGlobalRole } from '../lib/roles';
import { query } from '../lib/db/pool';

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

const hasPublicStatus = (item) => {
  const status = String(item?.data?.status || '').trim().toLowerCase();
  return status === 'public'
    || status === 'published'
    || item?.data?.public === true
    || item?.data?.public === 'true';
};

export async function GET({ locals }) {
  const session = locals?.session;
  const hasSession = Boolean(session?.user);
  const [content, cursos] = await Promise.all([
    safeGetCollection('content'),
    getCollection('cursos'),
  ]);

  const enrolledCourseIds = new Set();
  let canSearchAllCourses = false;
  if (hasSession) {
    const dbUser = await ensureDbUserFromSession(session);
    canSearchAllCourses = Boolean(dbUser && isElevatedGlobalRole(dbUser.role));
    if (dbUser && !canSearchAllCourses) {
      const { data: enrollments } = await query(
        `SELECT "courseId" FROM "Enrollment" WHERE "userId" = $1`,
        [dbUser.id],
      );
      (enrollments || []).forEach((enrollment) => {
        const courseId = String(enrollment?.courseId || '').trim();
        if (courseId) enrolledCourseIds.add(courseId);
      });
    }
  }

  const publicCourseIds = new Set(
    cursos
      .filter((item) => isCourseIndexEntry(item) && hasPublicStatus(item))
      .map((item) => getCourseEntryCourseId(item))
      .filter(Boolean),
  );
  const visibleContent = hasSession ? content : content.filter(hasPublicStatus);
  const visibleCursos = cursos.filter((item) => {
    const courseId = getCourseEntryCourseId(item);
    return hasPublicStatus(item)
      || publicCourseIds.has(courseId)
      || canSearchAllCourses
      || enrolledCourseIds.has(courseId);
  });

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
    const isPublic = itemType === 'public-note' || !courseId || hasPublicStatus(item) || publicCourseIds.has(courseId);

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
