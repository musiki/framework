import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const path = url.searchParams.get('path');

  if (!path) {
    return new Response('Missing path', { status: 400 });
  }

  const lesson = await getEntry('cursos', path);

  if (!lesson) {
    return new Response('Lesson not found', { status: 404 });
  }

  return new Response(lesson.body, {
    headers: { 'Content-Type': 'text/plain' },
  });
};