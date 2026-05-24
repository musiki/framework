import type { APIRoute } from 'astro';
import { getCollection, getEntry } from 'astro:content';
import { getContentCanonicalSlug, normalizeContentSlug } from '../../lib/content-slug';
import { getEditableLocalRepoFile, resolveCourseSource, sourcePathFromFrameworkFilePath } from '../../lib/content-admin';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  const courseId = url.searchParams.get('courseId') || '';

  if (!path) {
    return new Response('Missing path', { status: 400 });
  }

  let lesson = await getEntry('cursos', path);

  if (!lesson) {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const normalizedTarget = normalizeContentSlug(cleanPath.split('/').pop());
    const cursos = await getCollection('cursos');
    lesson = cursos.find((item) => {
      if (courseId && !item.id.startsWith(`${courseId}/`)) return false;

      const canonical = getContentCanonicalSlug(item);
      if (canonical === cleanPath) return true;
      if (item.id.toLowerCase() === cleanPath.toLowerCase()) return true;
      if (item.id.toLowerCase() === `${cleanPath}.md`.toLowerCase()) return true;

      const canonicalTail = canonical.split('/').pop();
      if (canonicalTail === normalizedTarget) return true;

      const filenameNormalized = normalizeContentSlug(item.id.split('/').pop()?.replace(/\.md$/, ''));
      return filenameNormalized === normalizedTarget;
    });
  }

  if (!lesson) {
    return new Response('Lesson not found', { status: 404 });
  }

  // Try to read the raw file (with frontmatter intact) from the local repo.
  // Fall back to lesson.body if the raw file isn't available (e.g. remote-only).
  const source = resolveCourseSource(courseId);
  const repoPath = sourcePathFromFrameworkFilePath((lesson as { filePath?: string }).filePath);
  const raw = source ? getEditableLocalRepoFile(source, repoPath) : null;

  const content = raw?.content ?? lesson.body ?? '';

  return new Response(content, {
    headers: { 'Content-Type': 'text/plain' },
  });
};
