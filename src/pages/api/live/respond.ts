import type { APIRoute } from 'astro';
import { getLiveSnapshotBySession, submitLiveResponse } from '../../../lib/live/server-store.mjs';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const sessionId = String(body?.sessionId || '').trim();
  if (!sessionId) {
    return json({ error: 'sessionId required' }, 400);
  }

  const snapshot = getLiveSnapshotBySession(sessionId);
  if (!snapshot?.active) {
    return json({ error: 'interaction not active' }, 404);
  }

  const session = (locals as any).session;
  const userEmail = String(session?.user?.email || '').trim().toLowerCase();
  const clientId = String(body?.clientId || '').trim();
  const isAnonymousMode = Boolean(snapshot.anonymous);

  if (!isAnonymousMode && !userEmail) {
    return json({ error: 'Authentication required for identified interaction' }, 401);
  }

  const participantKey = userEmail
    ? `user:${userEmail}`
    : clientId
      ? `anon:${clientId}`
      : '';

  if (!participantKey) {
    return json({ error: 'clientId required for anonymous responses' }, 400);
  }

  const answer = body?.answer;
  const result = submitLiveResponse({
    sessionId,
    answer,
    participantKey,
    anonymous: !userEmail,
    studentId: userEmail || null,
  });

  if (!result.ok) {
    return json({ error: result.error || 'could not submit response' }, result.status || 400);
  }

  return json({
    ok: true,
    snapshot: result.snapshot,
  });
};
