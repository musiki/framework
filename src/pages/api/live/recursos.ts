import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';
import {
  normalizeResourceProjectionItems,
  persistRecursosMarkdownProjection,
} from '../../../lib/live/recursos-markdown';

// GET /api/live/recursos?roomName=...&claseId=...
export const GET: APIRoute = async ({ request, locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const roomName = cleanString(url.searchParams.get('roomName') ?? '', 120);
  const claseId  = cleanString(url.searchParams.get('claseId')  ?? '', 240) || null;
  if (!roomName) return json({ error: 'roomName required' }, 400);

  const params: any[] = [roomName];
  let sql = `SELECT id, "claseId", "sessionId", "roomName", url, name, type, folder, source, "createdBy", "sortOrder", "createdAt"
             FROM "LiveClassResource" WHERE "roomName" = $1`;
  if (claseId !== null) {
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
  const courseRootId = cleanString(String(body?.courseRootId ?? ''), 120) || null;
  const items = normalizeResourceProjectionItems(Array.isArray(body?.items) ? body.items : []);

  if (!roomName) return json({ error: 'roomName required' }, 400);

  const deleteParams: any[] = [roomName];
  const deleteWhere = claseId === null
    ? `"roomName" = $1 AND "claseId" IS NULL`
    : `"roomName" = $1 AND "claseId" = $2`;
  if (claseId !== null) deleteParams.push(claseId);

  const delResult = await query(`DELETE FROM "LiveClassResource" WHERE ${deleteWhere}`, deleteParams);
  if (delResult.error) return json({ error: delResult.error.message }, 500);

  if (items.length === 0) {
    const projection = await persistProjection({ courseRootId, claseId, roomName, items });
    return json({ ok: true, count: 0, projection });
  }

  const VALID_TYPES   = ['pdf','img','md','tex','ly','audio','link','other'];
  const VALID_SOURCES = ['upload','chat','external-media','sa','sv','paste'];

  const rows = items.map((item: any, i: number) => ({
    id:          String(item.id || crypto.randomUUID()),
    claseId:     claseId,
    sessionId:   item.sessionId == null ? null : String(item.sessionId),
    roomName:    roomName,
    url:         cleanString(String(item.url ?? ''), 2000),
    name:        cleanString(String(item.name ?? ''), 500) || 'recurso',
    type:        VALID_TYPES.includes(item.type) ? item.type : 'other',
    folder:      cleanString(String(item.folder ?? ''), 120),
    source:      VALID_SOURCES.includes(item.source) ? item.source : 'upload',
    createdBy:   cleanString(String(item.createdBy ?? ''), 120),
    sortOrder:   typeof item.sortOrder === 'number' ? item.sortOrder : i,
    createdAt:   item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
  }));

  const cols = Object.keys(rows[0]);
  const colSql = cols.map(c => `"${c}"`).join(', ');
  let placeholderIdx = 1;
  const rowPlaceholders = rows.map(row => {
    const ph = cols.map(() => `$${placeholderIdx++}`).join(', ');
    return `(${ph})`;
  }).join(', ');
  const vals = rows.flatMap(row => Object.values(row));

  const insertResult = await query(
    `INSERT INTO "LiveClassResource" (${colSql}) VALUES ${rowPlaceholders}`,
    vals,
  );
  if (insertResult.error) return json({ error: insertResult.error.message }, 500);

  const projection = await persistProjection({ courseRootId, claseId, roomName, items: rows });
  return json({ ok: true, count: rows.length, projection });
};

async function persistProjection(options: {
  courseRootId: string | null;
  claseId: string | null;
  roomName: string;
  items: any[];
}) {
  try {
    return await persistRecursosMarkdownProjection(options);
  } catch (error) {
    console.error('[recursos] markdown projection failed', error);
    return null;
  }
}
