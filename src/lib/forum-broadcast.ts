/**
 * Forum realtime — server-side broadcast via Supabase Realtime REST API.
 * Fire-and-forget: no persistent WebSocket from the server.
 * Clients subscribe to `forum-thread:{threadId}` channels.
 */

const SUPABASE_URL  = (import.meta as any).env?.SUPABASE_URL  ?? process.env.SUPABASE_URL  ?? '';
const SERVICE_KEY   = (import.meta as any).env?.SUPABASE_KEY  ?? process.env.SUPABASE_KEY  ?? '';

export type ForumBroadcastEvent =
  | 'forum_post_created'
  | 'forum_post_updated'
  | 'forum_post_deleted'
  | 'forum_reaction_updated';

/**
 * Broadcast a forum event to all clients subscribed to this thread.
 * Non-throwing — realtime is best-effort and never blocks the write path.
 */
export async function broadcastForumEvent(
  threadId: string,
  event: ForumBroadcastEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    // Realtime disabled after Supabase migration, pending LiveKit implementation
    return;
  }
  if (!threadId) return;

  const url = `${SUPABASE_URL}/realtime/v1/api/broadcast`;
  try {
    await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${SERVICE_KEY}`,
        apikey:         SERVICE_KEY,
      },
      body: JSON.stringify({
        messages: [
          { topic: `forum-thread:${threadId}`, event, payload },
        ],
      }),
    });
  } catch {
    // intentionally swallowed — realtime is decorative, not load-bearing
  }
}
