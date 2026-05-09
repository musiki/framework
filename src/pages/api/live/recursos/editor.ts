import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../../lib/forum-server';
import { query } from '../../../../lib/db/pool';
import { persistRecursosMarkdownProjection } from '../../../../lib/live/recursos-markdown';
import { resolveLiveManageAccess } from '../../../../lib/live/access';
import { typeFromUrl } from '../../../../scripts/room/recursos/metadata';

const normalizeText = (value: unknown) => String(value || '').trim();

const selectColumns = `
  id, "claseId", "sessionId", "roomName", url, name, type, folder, source,
  "createdBy", "sortOrder", "createdAt"
`;

async function requireCourseManager(session: any, courseId: string) {
  if (!courseId) return false;
  const access = await resolveLiveManageAccess(session, courseId);
  return Boolean(access.canManage);
}

function resourceBelongsToCourse(row: any, courseId: string): boolean {
  const claseId = normalizeText(row?.claseId);
  const roomName = normalizeText(row?.roomName);
  return (
    claseId === courseId ||
    claseId.startsWith(`${courseId}/`) ||
    roomName === `${courseId}-stage` ||
    roomName.startsWith(`${courseId}-`)
  );
}

async function persistGroupProjection(courseId: string, roomName: string, claseId: string | null) {
  const params: any[] = [roomName];
  let sql = `SELECT ${selectColumns} FROM "LiveClassResource" WHERE "roomName" = $1`;
  if (claseId) {
    params.push(claseId);
    sql += ` AND "claseId" = $${params.length}`;
  } else {
    sql += ` AND "claseId" IS NULL`;
  }
  sql += ` ORDER BY "sortOrder" ASC, "createdAt" ASC`;

  const result = await query(sql, params);
  if (result.error) throw result.error;
  return persistRecursosMarkdownProjection({
    courseRootId: courseId,
    claseId,
    roomName,
    items: result.data ?? [],
  });
}

export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const courseId = cleanString(url.searchParams.get('courseId') ?? '', 120);
  if (!(await requireCourseManager(session, courseId))) return json({ error: 'Forbidden' }, 403);

  const stageRoomName = `${courseId}-stage`;
  const result = await query(
    `SELECT ${selectColumns}
       FROM "LiveClassResource"
      WHERE "claseId" = $1
         OR "claseId" LIKE $2
         OR "roomName" = $3
      ORDER BY "roomName" ASC, "claseId" ASC NULLS FIRST, folder ASC, "sortOrder" ASC, "createdAt" ASC`,
    [courseId, `${courseId}/%`, stageRoomName],
  );

  if (result.error) return json({ error: result.error.message }, 500);
  return json({ items: result.data ?? [] });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let body: any = null;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const courseId = cleanString(String(body?.courseId ?? ''), 120);
  if (!(await requireCourseManager(session, courseId))) return json({ error: 'Forbidden' }, 403);

  const url = cleanString(String(body?.url ?? ''), 2000);
  if (!/^https?:\/\//i.test(url)) return json({ error: 'Valid URL required' }, 400);

  const roomName = cleanString(String(body?.roomName ?? `${courseId}-stage`), 120) || `${courseId}-stage`;
  const rawClaseId = normalizeText(body?.claseId);
  const claseId = rawClaseId ? cleanString(rawClaseId, 240) : null;
  if (claseId && !(claseId === courseId || claseId.startsWith(`${courseId}/`))) {
    return json({ error: 'claseId is outside this course' }, 403);
  }

  const maxOrder = await query<{ nextOrder: number }>(
    `SELECT COALESCE(MAX("sortOrder") + 1, 0) AS "nextOrder"
       FROM "LiveClassResource"
      WHERE "roomName" = $1 AND ${claseId ? `"claseId" = $2` : `"claseId" IS NULL`}`,
    claseId ? [roomName, claseId] : [roomName],
  );
  if (maxOrder.error) return json({ error: maxOrder.error.message }, 500);

  const item = {
    id: crypto.randomUUID(),
    claseId,
    sessionId: null,
    roomName,
    url,
    name: cleanString(String(body?.name ?? ''), 500) || url.split('/').pop() || 'recurso',
    type: typeFromUrl(url),
    folder: cleanString(String(body?.folder ?? ''), 120),
    source: 'upload',
    createdBy: cleanString(String(user.email || session?.user?.email || ''), 120),
    sortOrder: Number(maxOrder.data?.[0]?.nextOrder ?? 0),
    createdAt: new Date().toISOString(),
  };

  const cols = Object.keys(item);
  const colSql = cols.map(c => `"${c}"`).join(', ');
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const insert = await query(
    `INSERT INTO "LiveClassResource" (${colSql}) VALUES (${placeholders}) RETURNING ${selectColumns}`,
    Object.values(item),
  );
  if (insert.error) return json({ error: insert.error.message }, 500);

  const projection = await persistGroupProjection(courseId, roomName, claseId).catch((error) => {
    console.error('[recursos-editor] projection failed', error);
    return null;
  });
  return json({ item: insert.data?.[0] ?? item, projection });
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let body: any = null;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const courseId = cleanString(String(body?.courseId ?? ''), 120);
  if (!(await requireCourseManager(session, courseId))) return json({ error: 'Forbidden' }, 403);

  const id = cleanString(String(body?.id ?? ''), 80);
  if (!id) return json({ error: 'id required' }, 400);

  const existing = await query<any>(
    `SELECT ${selectColumns} FROM "LiveClassResource" WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (existing.error) return json({ error: existing.error.message }, 500);
  const current = existing.data?.[0];
  if (!current) return json({ error: 'Not found' }, 404);

  if (!resourceBelongsToCourse(current, courseId)) {
    return json({ error: 'Resource is outside this course' }, 403);
  }

  const name = cleanString(String(body?.name ?? current.name ?? ''), 500) || 'recurso';
  const folder = cleanString(String(body?.folder ?? current.folder ?? ''), 120);
  const update = await query(
    `UPDATE "LiveClassResource"
        SET name = $1, folder = $2
      WHERE id = $3
      RETURNING ${selectColumns}`,
    [name, folder, id],
  );
  if (update.error) return json({ error: update.error.message }, 500);

  const updated = update.data?.[0] ?? current;
  const projection = await persistGroupProjection(
    courseId,
    normalizeText(updated.roomName),
    normalizeText(updated.claseId) || null,
  ).catch((error) => {
    console.error('[recursos-editor] projection failed', error);
    return null;
  });

  return json({ item: updated, projection });
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const courseId = cleanString(url.searchParams.get('courseId') ?? '', 120);
  if (!(await requireCourseManager(session, courseId))) return json({ error: 'Forbidden' }, 403);

  const id = cleanString(url.searchParams.get('id') ?? '', 80);
  if (!id) return json({ error: 'id required' }, 400);

  const existing = await query<any>(
    `SELECT ${selectColumns} FROM "LiveClassResource" WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (existing.error) return json({ error: existing.error.message }, 500);
  const current = existing.data?.[0];
  if (!current) return json({ error: 'Not found' }, 404);
  if (!resourceBelongsToCourse(current, courseId)) {
    return json({ error: 'Resource is outside this course' }, 403);
  }

  const del = await query<any>(
    `DELETE FROM "LiveClassResource" WHERE id = $1 RETURNING ${selectColumns}`,
    [id],
  );
  if (del.error) return json({ error: del.error.message }, 500);
  const deleted = del.data?.[0];
  if (!deleted) return json({ error: 'Not found' }, 404);

  const deletedClaseId = normalizeText(deleted.claseId);
  const projection = await persistGroupProjection(
    courseId,
    normalizeText(deleted.roomName),
    deletedClaseId || null,
  ).catch((error) => {
    console.error('[recursos-editor] projection failed', error);
    return null;
  });

  return json({ deleted, projection });
};
