import { getCollection, getEntry } from 'astro:content';
import { getPublicContentStaticPaths, type PublicContentRouteProps } from '../lib/public-content-routes';
import {
  buildCourseHref,
  buildCourseLessonHref,
  buildCourseLessonPathIndex,
  getCourseEntryCourseId,
  isCourseIndexEntry,
  isCourseLessonEntryForCourse,
} from '../lib/course-routing';

export const prerender = true;

function cleanMarkdown(md: string): string {
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

export async function GET() {
  const [allPublicPaths, rawCursos] = await Promise.all([
    getPublicContentStaticPaths(),
    getCollection('cursos'),
  ]);
  
  const items = await Promise.all(allPublicPaths.map(async (routeMatch) => {
    if (routeMatch.props.kind !== 'content') return null;
    
    const route = routeMatch.props as PublicContentRouteProps;
    const item = await getEntry(route.collection, route.entryId);
    if (!item) return null;

    const filename = item.id.split('/').pop()?.replace(/\.[^/.]+$/, '');
    const title = item.data.title || filename || 'Untitled';
    const slug = routeMatch.params.slug;
    
    // Determine category
    const itemType = String(item.data.type || '').trim().toLowerCase();
    let category = 'Contenido';
    if (itemType === 'concept') category = 'Concepto';
    else if (itemType === 'glossary') category = 'Glosario';
    else if (itemType === 'public-note' || itemType === 'notes') category = 'Nota';
    else if (route.collection === 'content') {
      const parts = item.id.split('/');
      const subfolder = parts.length >= 3 ? parts[1] : null;
      if (subfolder) {
        category = subfolder.charAt(0).toUpperCase() + subfolder.slice(1);
      }
    }

    return {
      title,
      slug: '/' + slug,
      content: cleanMarkdown(item.body || ''),
      type: category,
      def: item.data.def || item.data.definition || '',
      sinopsis: item.data.sinopsis || item.data.synopsis || item.data.description || '',
    };
  }));

  const publicCourseIds = new Set(rawCursos.filter((item) => {
    const status = String(item.data?.status || '').trim().toLowerCase();
    return isCourseIndexEntry(item)
      && (status === 'public' || status === 'published' || item.data?.public === true || item.data?.public === 'true');
  }).map((item) => getCourseEntryCourseId(item)).filter(Boolean));
  const publicCursos = rawCursos.filter((item) => {
    const status = String(item.data?.status || '').trim().toLowerCase();
    return status === 'public'
      || status === 'published'
      || item.data?.public === true
      || item.data?.public === 'true'
      || publicCourseIds.has(getCourseEntryCourseId(item));
  });
  const courseIndexById = new Map<string, any>();
  publicCursos.forEach((item) => {
    if (!isCourseIndexEntry(item)) return;
    const courseId = getCourseEntryCourseId(item);
    if (courseId) courseIndexById.set(courseId, item);
  });
  const lessonPathIndexByCourseId = new Map<string, any>();
  courseIndexById.forEach((courseEntry, courseId) => {
    const lessons = publicCursos
      .filter((item) => isCourseLessonEntryForCourse(item, courseId))
      .sort((left, right) => Number(left.data?.order || 0) - Number(right.data?.order || 0));
    lessonPathIndexByCourseId.set(courseId, buildCourseLessonPathIndex(courseId, courseEntry.data || {}, lessons));
  });
  const courseItems = publicCursos.map((item) => {
    const isCourseIndex = isCourseIndexEntry(item);
    const courseId = getCourseEntryCourseId(item);
    const filename = item.id.split('/').pop()?.replace(/\.[^/.]+$/, '');
    const itemType = String(item.data?.type || '').trim().toLowerCase();
    const slug = isCourseIndex
      ? buildCourseHref(courseId, item.data || {})
      : buildCourseLessonHref(courseId, courseIndexById.get(courseId)?.data || {}, item, lessonPathIndexByCourseId.get(courseId));
    const type = itemType === 'concept'
      ? 'Concepto'
      : itemType === 'glossary'
        ? 'Glosario'
        : isCourseIndex
          ? 'Curso'
          : 'Clase';
    return {
      title: item.data?.title || filename || 'Untitled',
      slug,
      content: cleanMarkdown(item.body || ''),
      type,
      def: item.data?.def || item.data?.definition || '',
      sinopsis: item.data?.sinopsis || item.data?.synopsis || item.data?.description || '',
    };
  });

  const dedupe = new Map<string, any>();
  [...items.filter(Boolean), ...courseItems].forEach((item: any) => {
    const key = `${item.slug}::${item.title}`;
    if (!dedupe.has(key)) dedupe.set(key, item);
  });
  const filteredItems = Array.from(dedupe.values());

  return new Response(JSON.stringify(filteredItems), {
    headers: { 'Content-Type': 'application/json' },
  });
}
