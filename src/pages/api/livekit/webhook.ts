import type { APIRoute } from 'astro';
import { persistLiveKitWebhook, receiveLiveKitWebhook } from '../../../lib/live/livekit-webhook';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();
  const authHeader =
    request.headers.get('Authorization') ||
    request.headers.get('Authorize') ||
    '';

  try {
    const event = await receiveLiveKitWebhook(rawBody, authHeader);
    const result = await persistLiveKitWebhook(event, rawBody);
    return json({ ok: true, ...result });
  } catch (error) {
    console.error('LiveKit webhook failed:', error);
    return json(
      {
        error: error instanceof Error ? error.message : 'Invalid LiveKit webhook request.',
      },
      400,
    );
  }
};
