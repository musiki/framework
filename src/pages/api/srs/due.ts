import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const cleanString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

// GET /api/srs/due?deck=<deck>&limit=<n>
// Returns the authenticated user's spaced-repetition items due now (dueAt <= now),
// ordered by dueAt ascending. Optionally filtered by deck.
export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;
  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  try {
    const url = new URL(request.url);
    const deck = cleanString(url.searchParams.get('deck'));
    const limitRaw = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.round(limitRaw), 200) : 50;

    const { data: users, error: userError } = await query(
      'SELECT "id" FROM "User" WHERE "email" = $1',
      [currentUser.email],
    );
    if (userError) throw userError;
    const userId = users?.[0]?.id;
    if (!userId) return json({ items: [], total: 0 });

    const params: unknown[] = [userId];
    let whereDeck = '';
    if (deck) {
      params.push(deck);
      whereDeck = ` AND "deck" = $${params.length}`;
    }
    params.push(limit);

    const { data: rows, error } = await query(
      `SELECT "evalId", "deck", "reps", "easeFactor", "intervalDays", "dueAt", "lastQuality", "lastReviewedAt"
       FROM "SrsState"
       WHERE "userId" = $1${whereDeck} AND "dueAt" <= now()
       ORDER BY "dueAt" ASC
       LIMIT $${params.length}`,
      params,
    );
    if (error) throw error;

    const items = (rows || []).map((row: Record<string, unknown>) => ({
      evalId: row.evalId,
      deck: row.deck,
      reps: Number(row.reps) || 0,
      easeFactor: Number(row.easeFactor) || 0,
      intervalDays: Number(row.intervalDays) || 0,
      dueAt: row.dueAt,
      lastQuality: row.lastQuality === null || row.lastQuality === undefined ? null : Number(row.lastQuality),
      lastReviewedAt: row.lastReviewedAt ?? null,
    }));

    return json({ items, total: items.length, deck: deck || null });
  } catch (error: any) {
    console.error('[SRS] due error:', error?.message || error);
    return json({ error: error?.message || 'SRS due error' }, 500);
  }
};
