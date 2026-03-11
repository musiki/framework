import type { APIRoute } from 'astro';
import { getLiveSnapshot, getLiveSnapshotBySession } from '../../../lib/live/server-store.mjs';
import { canonicalizeCourseId } from '../../../lib/course-alias';

export const GET: APIRoute = async ({ url }) => {
  const requestedCourseId = String(url.searchParams.get('courseId') || '').trim();
  const courseId = await canonicalizeCourseId(requestedCourseId);
  const sessionId = String(url.searchParams.get('sessionId') || '').trim();

  const payload = sessionId
    ? getLiveSnapshotBySession(sessionId)
    : getLiveSnapshot(courseId);

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};
