import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../../lib/forum-server';
import { query } from '../../../../lib/db/pool';
import { persistRecursosMarkdownProjection } from '../../../../lib/live/recursos-markdown';
import { resolveLiveManageAccess } from '../../../../lib/live/access';
import { typeFromUrl } from '../../../../scripts/room/recursos/metadata';
import { normalizeDbResourceSource, normalizeDbResourceType } from '../../../../lib/live/resource-db-enums';

const normalizeText = (value: unknown) => String(value || '').trim();

const selectColumns = `
  id, "claseId", "sessionId", "roomName", url, name, type, folder, source,
  "createdBy", "sortOrder", "createdAt"
`;

const sessionSelectColumns = `id, "roomName", name, "courseId", "claseId", "createdAt"`;

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

async function listEditorSessions(courseId: string, roomName: string) {
  const result = await query(
    `SELECT ${sessionSelectColumns}
       FROM "ResourceSession"
      WHERE "roomName" = $1
         OR "courseId" = $2
         OR "claseId" = $2
         OR "claseId" LIKE $3
      ORDER BY "createdAt" DESC
      LIMIT 100`,
    [roomName, courseId, `${courseId}/%`],
  );
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function resolveSessionIdForCourse(options: {
  courseId: string;
  roomName: string;
  sessionId?: string | null;
}) {
  const sessionId = cleanString(String(options.sessionId ?? ''), 80);
  if (!sessionId) return null;
  const result = await query<any>(
    `SELECT ${sessionSelectColumns}
       FROM "ResourceSession"
      WHERE id = $1
        AND (
          "roomName" = $2
          OR "courseId" = $3
          OR "claseId" = $3
          OR "claseId" LIKE $4
        )
      LIMIT 1`,
    [sessionId, options.roomName, options.courseId, `${options.courseId}/%`],
  );
  if (result.error) throw result.error;
  return result.data?.[0]?.id ? String(result.data[0].id) : null;
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
  const sessions = await listEditorSessions(courseId, stageRoomName).catch((error) => {
    console.error('[recursos-editor] sessions failed', error);
    return [];
  });
  return json({ items: result.data ?? [], sessions, stageRoomName });
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
  const sessionId = await resolveSessionIdForCourse({
    courseId,
    roomName,
    sessionId: body?.sessionId,
  }).catch((error) => {
    console.error('[recursos-editor] session validation failed', error);
    return undefined;
  });
  if (sessionId === undefined) return json({ error: 'Could not validate session' }, 500);

  const maxOrder = await query<{ nextOrder: number }>(
    `SELECT COALESCE(MAX("sortOrder") + 1, 0) AS "nextOrder"
       FROM "LiveClassResource"
      WHERE "roomName" = $1 AND ${claseId ? `"claseId" = $2` : `"claseId" IS NULL`}`,
    claseId ? [roomName, claseId] : [roomName],
  );
  if (maxOrder.error) return json({ error: maxOrder.error.message }, 500);

  const resourceType = await normalizeDbResourceType(typeFromUrl(url));
  const resourceSource = await normalizeDbResourceSource('upload');

  const item = {
    id: crypto.randomUUID(),
    claseId,
    sessionId,
    roomName,
    url,
    name: cleanString(String(body?.name ?? ''), 500) || url.split('/').pop() || 'recurso',
    type: resourceType,
    folder: cleanString(String(body?.folder ?? ''), 120),
    source: resourceSource,
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

  const roomName = normalizeText(current.roomName) || `${courseId}-stage`;
  const rawClaseId = normalizeText(body?.claseId);
  const claseId = rawClaseId ? cleanString(rawClaseId, 240) : null;
  if (claseId && !(claseId === courseId || claseId.startsWith(`${courseId}/`))) {
    return json({ error: 'claseId is outside this course' }, 403);
  }
  const sessionId = await resolveSessionIdForCourse({
    courseId,
    roomName,
    sessionId: body?.sessionId,
  }).catch((error) => {
    console.error('[recursos-editor] session validation failed', error);
    return undefined;
  });
  if (sessionId === undefined) return json({ error: 'Could not validate session' }, 500);

  const name = cleanString(String(body?.name ?? current.name ?? ''), 500) || 'recurso';
  const folder = cleanString(String(body?.folder ?? current.folder ?? ''), 120);
  const update = await query(
    `UPDATE "LiveClassResource"
        SET name = $1, folder = $2, "claseId" = $3, "sessionId" = $4
      WHERE id = $5
      RETURNING ${selectColumns}`,
    [name, folder, claseId, sessionId, id],
  );
  if (update.error) return json({ error: update.error.message }, 500);

  const updated = update.data?.[0] ?? current;
  const oldRoomName = normalizeText(current.roomName);
  const oldClaseId = normalizeText(current.claseId) || null;
  const newRoomName = normalizeText(updated.roomName);
  const newClaseId = normalizeText(updated.claseId) || null;
  if (oldRoomName && (oldRoomName !== newRoomName || oldClaseId !== newClaseId)) {
    await persistGroupProjection(courseId, oldRoomName, oldClaseId).catch((error) => {
      console.error('[recursos-editor] previous projection failed', error);
      return null;
    });
  }
  const projection = await persistGroupProjection(
    courseId,
    newRoomName,
    newClaseId,
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
