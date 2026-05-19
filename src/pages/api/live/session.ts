import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, getForumCourseAccess, json } from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';

// GET /api/live/session?roomName=...         → { session: {...} | null }
// GET /api/live/session?roomName=...&list=1  → { sessions: [...] }
export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const roomName = cleanString(url.searchParams.get('roomName') ?? '', 120);
  if (!roomName) return json({ error: 'roomName required' }, 400);

  if (url.searchParams.get('list')) {
    const result = await query(
      `SELECT id, "roomName", name, "courseId", "claseId", "createdAt"
       FROM "ResourceSession" WHERE "roomName" = $1
       ORDER BY "createdAt" DESC LIMIT 10`,
      [roomName],
    );
    if (result.error) return json({ error: result.error.message }, 500);
    return json({ sessions: result.data ?? [] });
  }

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
// Only teachers (enrolled in the course or elevated global role) may create sessions.
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

  // Teacher check: require teacher enrollment or elevated global role.
  if (courseId) {
    const access = await getForumCourseAccess(user, courseId);
    if (!access.isTeacher) return json({ error: 'Only teachers can create sessions' }, 403);
  } else {
    const { isElevatedGlobalRole } = await import('../../../lib/roles');
    if (!isElevatedGlobalRole(user.role)) return json({ error: 'Only teachers can create sessions' }, 403);
  }

  // Upsert: return existing session with same name+room to prevent duplicates.
  const existing = await query(
    `SELECT id, "roomName", name, "courseId", "claseId", "createdAt"
     FROM "ResourceSession" WHERE "roomName" = $1 AND name = $2 LIMIT 1`,
    [roomName, name],
  );
  if (existing.error) return json({ error: existing.error.message }, 500);
  if (existing.data?.[0]) return json({ session: existing.data[0] });

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

  // Fetch the session to get its courseId for role check.
  const sessionRow = await query(
    `SELECT "courseId" FROM "ResourceSession" WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (sessionRow.error) return json({ error: sessionRow.error.message }, 500);
  const sessionCourseId = sessionRow.data?.[0]?.courseId ?? null;

  if (sessionCourseId) {
    const access = await getForumCourseAccess(user, sessionCourseId);
    if (!access.isTeacher) return json({ error: 'Only teachers can rename sessions' }, 403);
  } else {
    const { isElevatedGlobalRole } = await import('../../../lib/roles');
    if (!isElevatedGlobalRole(user.role)) return json({ error: 'Only teachers can rename sessions' }, 403);
  }

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

  // Fetch the session to get its courseId for role check.
  const sessionRow = await query(
    `SELECT "courseId" FROM "ResourceSession" WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (sessionRow.error) return json({ error: sessionRow.error.message }, 500);
  const sessionCourseId = sessionRow.data?.[0]?.courseId ?? null;

  if (sessionCourseId) {
    const access = await getForumCourseAccess(user, sessionCourseId);
    if (!access.isTeacher) return json({ error: 'Only teachers can delete sessions' }, 403);
  } else {
    const { isElevatedGlobalRole } = await import('../../../lib/roles');
    if (!isElevatedGlobalRole(user.role)) return json({ error: 'Only teachers can delete sessions' }, 403);
  }

  const result = await query(`DELETE FROM "ResourceSession" WHERE id = $1`, [id]);
  if (result.error) return json({ error: result.error.message }, 500);
  return json({ ok: true });
};
