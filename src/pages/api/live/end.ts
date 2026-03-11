import type { APIRoute } from 'astro';
import { endLiveInteraction, getLiveSnapshotBySession } from '../../../lib/live/server-store.mjs';
import { resolveLiveManageAccess } from '../../../lib/live/access';

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
  const sessionId = String(body?.sessionId || '').trim();
  if (!sessionId) {
    return json({ error: 'sessionId required' }, 400);
  }

  const snapshot = getLiveSnapshotBySession(sessionId);
  const courseId = String(snapshot?.courseId || '').trim();
  if (!courseId) {
    return json({ error: 'interaction not found' }, 404);
  }

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) {
    return json(
      {
        error: 'Only teachers can end live interactions',
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

  const payload = endLiveInteraction({
    sessionId,
    reason: body?.reason,
  });

  if (!payload) {
    return json({ error: 'interaction not found' }, 404);
  }

  return json(payload, 200);
};
