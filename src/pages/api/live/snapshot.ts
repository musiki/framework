import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';

// GET /api/live/snapshot?roomName=... → { snapshots: [...] }
export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const roomName = cleanString(url.searchParams.get('roomName') ?? '', 120);
  if (!roomName) return json({ error: 'roomName required' }, 400);

  const result = await query(
    `SELECT id, "roomName", name, layout, "createdBy", "createdAt"
     FROM "RoomSnapshot" WHERE "roomName" = $1
     ORDER BY "createdAt" DESC LIMIT 50`,
    [roomName],
  );
  if (result.error) return json({ error: result.error.message }, 500);
  return json({ snapshots: result.data ?? [] });
};

// POST /api/live/snapshot body: { roomName, name, layout, createdBy, courseId?, claseId? }
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let body: any = null;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const roomName = cleanString(String(body?.roomName ?? ''), 120);
  const name     = cleanString(String(body?.name ?? ''), 200) || new Date().toLocaleString();
  const layout   = body?.layout;
  const createdBy = cleanString(String(body?.createdBy ?? ''), 120);
  
  if (!roomName || !layout || !createdBy) {
    return json({ error: 'roomName, layout, and createdBy are required' }, 400);
  }

  const courseId = body?.courseId == null ? null : cleanString(String(body.courseId), 240);
  const claseId  = body?.claseId  == null ? null : cleanString(String(body.claseId),  240);

  const result = await query(
    `INSERT INTO "RoomSnapshot" ("roomName", "name", "layout", "createdBy", "courseId", "claseId")
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, "createdAt"`,
    [roomName, name, JSON.stringify(layout), createdBy, courseId, claseId],
  );
  if (result.error) return json({ error: result.error.message }, 500);
  return json({ ok: true, snapshot: result.data![0] });
};

// DELETE /api/live/snapshot?id=...
export const DELETE: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 40);
  if (!id) return json({ error: 'id required' }, 400);

  const result = await query(`DELETE FROM "RoomSnapshot" WHERE id = $1`, [id]);
  if (result.error) return json({ error: result.error.message }, 500);
  return json({ ok: true });
};
