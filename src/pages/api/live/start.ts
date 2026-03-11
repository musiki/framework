import type { APIRoute } from 'astro';
import { startLiveInteraction } from '../../../lib/live/server-store.mjs';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { canonicalizeCourseId, canonicalizeCourseSlugPath } from '../../../lib/course-alias';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const courseId = await canonicalizeCourseId(String(body?.courseId || '').trim());
  const interactionId = String(body?.interactionId || '').trim();
  const pageSlug = await canonicalizeCourseSlugPath(body?.pageSlug, courseId);

  if (!courseId || !interactionId) {
    return json({ error: 'courseId and interactionId are required' }, 400);
  }

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) {
    return json(
      {
        error: 'Only teachers can start live interactions',
        debug: {
          courseId,
          userId: access.userId,
          userRole: access.userRole,
          enrollmentRole: access.enrollmentRole,
        },
      },
      403,
    );
  }

  const payload = startLiveInteraction({
    courseId,
    pageSlug,
    sessionId: body?.sessionId,
    interactionId,
    type: body?.type || 'poll',
    prompt: body?.prompt || '',
    options: Array.isArray(body?.options) ? body.options : [],
    anonymous: body?.anonymous,
    allowMultiple: body?.allowMultiple,
    showResults: body?.showResults,
    timerSeconds: body?.timerSeconds,
    endsAt: body?.endsAt,
  });

  return json(payload, 200);
};
