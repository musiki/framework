import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, getForumCourseAccess, json } from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';
import { normalizeResourceProjectionItems } from '../../../lib/live/recursos-markdown';
import { normalizeDbResourceSource, normalizeDbResourceType } from '../../../lib/live/resource-db-enums';
import { isElevatedGlobalRole } from '../../../lib/roles';

// GET /api/live/recursos?roomName=...&claseId=...
export const GET: APIRoute = async ({ request, locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const roomName = cleanString(url.searchParams.get('roomName') ?? '', 120);
  const claseId  = cleanString(url.searchParams.get('claseId')  ?? '', 240) || null;
  const sessionIds = (url.searchParams.get('sessionIds') ?? '')
    .split(',')
    .map((value) => cleanString(value, 80))
    .filter(Boolean);
  if (!roomName) return json({ error: 'roomName required' }, 400);

  const params: any[] = [roomName];
  let sql = `SELECT id, "claseId", "sessionId", "roomName", url, name, type, folder, source, "createdBy", "sortOrder", "createdAt"
             FROM "LiveClassResource" WHERE "roomName" = $1`;
  if (sessionIds.length > 0) {
    params.push(sessionIds);
    sql += ` AND "sessionId" = ANY($${params.length})`;
  } else if (claseId !== null) {
    params.push(claseId);
    sql += ` AND "claseId" = $${params.length}`;
  } else {
    sql += ` AND "claseId" IS NULL`;
  }
  sql += ` ORDER BY "sortOrder" ASC, "createdAt" ASC`;

  const result = await query(sql, params);
  if (result.error) return json({ error: result.error.message }, 500);
  return json({ items: result.data ?? [] });
};

// POST /api/live/recursos  body: { roomName, claseId, courseRootId, items: ResourceItem[] }
// Full replace: deletes all current items for (roomName, claseId), inserts new list.
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let body: any = null;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const roomName = cleanString(String(body?.roomName ?? ''), 120);
  const claseId  = body?.claseId == null ? null : cleanString(String(body.claseId), 240) || null;
  const courseRootId = cleanString(String(body?.courseRootId ?? ''), 240) || null;
  const items = normalizeResourceProjectionItems(Array.isArray(body?.items) ? body.items : []);

  if (!roomName) return json({ error: 'roomName required' }, 400);

  const canReplace = courseRootId
    ? (await getForumCourseAccess(user, courseRootId)).isTeacher
    : isElevatedGlobalRole(user.role);
  if (!canReplace) {
    return json({ error: 'Only teachers can replace or remove room resources' }, 403);
  }

  const incomingIds = items.map(i => String(i.id)).filter(Boolean);

  // Coherence: we want the DB to match the pod's state for this specific scope (room + clase).
  // We delete items that are NOT in the incoming list, but ONLY for this room/clase.
  // This avoids wiping out other sessions or classes.
  const cleanupWhere = claseId === null
    ? `"roomName" = $1 AND "claseId" IS NULL`
    : `"roomName" = $1 AND "claseId" = $2`;
  const cleanupParams: any[] = [roomName];
  if (claseId !== null) cleanupParams.push(claseId);
  
  const idPlaceholder = claseId === null ? '$2' : '$3';
  const deleteSql = `DELETE FROM "LiveClassResource" 
                     WHERE ${cleanupWhere} 
                     ${incomingIds.length > 0 ? `AND id NOT IN (${incomingIds.map((_, i) => `$${(claseId === null ? 2 : 3) + i}`).join(', ')})` : ''}`;
  
  if (incomingIds.length > 0) {
    cleanupParams.push(...incomingIds);
  }

  const delResult = await query(deleteSql, cleanupParams);
  if (delResult.error) return json({ error: delResult.error.message }, 500);

  if (items.length === 0) {
    return json({ ok: true, count: 0 });
  }

  const rows = await Promise.all(items.map(async (item: any, i: number) => ({
    id:          String(item.id || crypto.randomUUID()),
    claseId:     claseId,
    sessionId:   item.sessionId == null ? null : String(item.sessionId),
    roomName:    roomName,
    url:         cleanString(String(item.url ?? ''), 2000),
    name:        cleanString(String(item.name ?? ''), 500) || 'recurso',
    type:        await normalizeDbResourceType(String(item.type ?? '')),
    folder:      cleanString(String(item.folder ?? ''), 120),
    source:      await normalizeDbResourceSource(String(item.source ?? '')),
    createdBy:   cleanString(String(item.createdBy ?? ''), 120),
    sortOrder:   typeof item.sortOrder === 'number' ? item.sortOrder : i,
    createdAt:   item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
  })));

  const cols = Object.keys(rows[0]);
  const colSql = cols.map(c => `"${c}"`).join(', ');
  let placeholderIdx = 1;
  const rowPlaceholders = rows.map(row => {
    const ph = cols.map(() => `$${placeholderIdx++}`).join(', ');
    return `(${ph})`;
  }).join(', ');
  const vals = rows.flatMap(row => Object.values(row));

  // Upsert: update existing IDs, insert new ones.
  const updateSql = cols.filter(c => c !== 'id').map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

  const insertResult = await query(
    `INSERT INTO "LiveClassResource" (${colSql}) 
     VALUES ${rowPlaceholders}
     ON CONFLICT (id) DO UPDATE SET ${updateSql}`,
    vals,
  );
  if (insertResult.error) return json({ error: insertResult.error.message }, 500);

  // Coherence: only auto-persist to Markdown in production.
  // In development, the teacher must use the "Save to Repo" button to avoid reload loops.
  if (process.env.NODE_ENV === 'production' || body?.persist === true) {
    await persistProjection({ courseRootId, claseId, roomName, items: rows }).catch(err => {
      console.error('[recursos] background markdown sync failed', err);
    });
  }

  return json({ ok: true, count: rows.length });
};

async function persistProjection(options: {
  courseRootId: string | null;
  claseId: string | null;
  roomName: string;
  items: any[];
}) {
  try {
    const { persistRecursosMarkdownProjection } = await import('../../../lib/live/recursos-markdown');
    return await persistRecursosMarkdownProjection(options);
  } catch (error) {
    console.error('[recursos] markdown projection failed', error);
    return null;
  }
}
