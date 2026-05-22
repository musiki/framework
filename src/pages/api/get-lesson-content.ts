import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';
import { getEditableLocalRepoFile, resolveCourseSource, sourcePathFromFrameworkFilePath } from '../../lib/content-admin';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  const courseId = url.searchParams.get('courseId') || '';

  if (!path) {
    return new Response('Missing path', { status: 400 });
  }

  const lesson = await getEntry('cursos', path);

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
