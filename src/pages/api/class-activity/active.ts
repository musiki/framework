import type { APIRoute } from 'astro';
import { canonicalizeCourseId } from '../../../lib/course-alias';
import { getLiveSnapshot } from '../../../lib/live/server-store.mjs';
import { buildClassActivitySnapshot } from '../../../lib/class-activity/model.mjs';

export const GET: APIRoute = async ({ url }) => {
  const requestedCourseId = String(url.searchParams.get('courseId') || '').trim();
  const courseId = await canonicalizeCourseId(requestedCourseId);
  const payload = buildClassActivitySnapshot(getLiveSnapshot(courseId));

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};
