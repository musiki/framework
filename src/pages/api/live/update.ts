import type { APIRoute } from 'astro';
import { updateLiveInteraction } from '../../../lib/live/server-store.mjs';

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

  const payload = updateLiveInteraction({
    sessionId,
    prompt: body?.prompt,
    options: body?.options,
    showResults: body?.showResults,
    timerSeconds: body?.timerSeconds,
    endsAt: body?.endsAt,
  });

  if (!payload) {
    return json({ error: 'interaction not found' }, 404);
  }

  return json(payload, 200);
};
