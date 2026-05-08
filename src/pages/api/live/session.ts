import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';

// GET /api/live/session?roomName=... → { session: {...} | null }
export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const roomName = cleanString(url.searchParams.get('roomName') ?? '', 120);
  if (!roomName) return json({ error: 'roomName required' }, 400);

  const result = await query(
    `SELECT id, "roomName", name, "courseId", "claseId", "createdAt"
     FROM "ResourceSession" WHERE "roomName" = $1
     ORDER BY "createdAt" DESC LIMIT 1`,
    [roomName],
  );
  if (result.error) return json({ error: result.error.message }, 500);
  return json({ session: result.data?.[0] ?? null });
};

// POST /api/live/session body: { roomName, name?, claseId?, courseId? } → { session: {...} }
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let body: any = null;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const roomName = cleanString(String(body?.roomName ?? ''), 120);
  if (!roomName) return json({ error: 'roomName required' }, 400);

  const name     = cleanString(String(body?.name ?? ''), 200) || new Date().toISOString().slice(0, 10) + '-sesión';
  const claseId  = body?.claseId  == null ? null : cleanString(String(body.claseId),  240) || null;
  const courseId = body?.courseId == null ? null : cleanString(String(body.courseId), 240) || null;

  const result = await query(
    `INSERT INTO "ResourceSession" ("roomName", "name", "courseId", "claseId")
     VALUES ($1, $2, $3, $4)
     RETURNING id, "roomName", name, "courseId", "claseId", "createdAt"`,
    [roomName, name, courseId, claseId],
  );
  if (result.error) return json({ error: result.error.message }, 500);
  return json({ session: result.data![0] });
};

// PATCH /api/live/session body: { id, name } → { ok: true }
export const PATCH: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let body: any = null;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const id   = cleanString(String(body?.id   ?? ''), 40);
  const name = cleanString(String(body?.name ?? ''), 200);
  if (!id || !name) return json({ error: 'id and name required' }, 400);

  const result = await query(
    `UPDATE "ResourceSession" SET name = $1 WHERE id = $2`,
    [name, id],
  );
  if (result.error) return json({ error: result.error.message }, 500);
  return json({ ok: true });
};

// DELETE /api/live/session?id=... → { ok: true }
export const DELETE: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 40);
  if (!id) return json({ error: 'id required' }, 400);

  const result = await query(`DELETE FROM "ResourceSession" WHERE id = $1`, [id]);
  if (result.error) return json({ error: result.error.message }, 500);
  return json({ ok: true });
};
