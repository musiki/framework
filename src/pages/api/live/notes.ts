import type { APIRoute } from 'astro';
import {
  cleanBody,
  cleanString,
  ensureDbUserFromSession,
  json,
} from '../../../lib/forum-server';
import { renderForumMarkdown } from '../../../lib/forum-markdown';
import { query } from '../../../lib/db/pool';

const TITLE_MAX = 160;
const BODY_MAX  = 8_000;

const deriveLiveNoteTitle = (body: string, fallbackTitle = '') => {
  const firstLine = String(body || '')
    .split(/\r?\n/)
    .map((line) => cleanString(String(line || '').replace(/^#{1,6}\s*/, ''), TITLE_MAX))
    .find(Boolean);

  const source = firstLine || cleanString(String(fallbackTitle || '').replace(/^#{1,6}\s*/, ''), TITLE_MAX);
  const words = String(source || '').split(/\s+/).filter(Boolean).slice(0, 3);
  return cleanString(words.join(' '), TITLE_MAX) || 'nota';
};

// GET  /api/live/notes?courseId=...&roomName=...&limit=40
export const GET: APIRoute = async ({ request, locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const noteId   = cleanString(url.searchParams.get('id') ?? '', 36) || null;
  const courseId = cleanString(url.searchParams.get('courseId') ?? '', 120) || null;
  const roomName = cleanString(url.searchParams.get('roomName') ?? '', 120) || null;
  const folderId = cleanString(url.searchParams.get('folderId') ?? '', 36) || null;
  const limit    = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '40')));

  const params: any[] = [user.id];
  let sql = `SELECT id, title, body, "renderedHtml", "noteDate", "courseId", "folderId", "createdAt", "updatedAt"
             FROM "LiveClassNote" WHERE "userId" = $1`;

  if (noteId) {
    params.push(noteId);
    sql += ` AND "id" = $${params.length}`;
  }
  if (courseId) {
    params.push(courseId);
    sql += ` AND "courseId" = $${params.length}`;
  }
  if (roomName) {
    params.push(roomName);
    sql += ` AND "roomName" = $${params.length}`;
  }
  if (folderId) {
    params.push(folderId);
    sql += ` AND "folderId" = $${params.length}`;
  }

  sql += ` ORDER BY "noteDate" DESC, "updatedAt" DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { data, error } = await query(sql, params);
  if (error) return json({ error: error.message }, 500);

  return json({ notes: data ?? [] });
};

// POST /api/live/notes  — upsert by id (create if no id, update if id provided)
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body   = await request.json().catch(() => ({}));
  const id       = cleanString(body?.id ?? '', 36) || null;
  const noteBody = cleanBody(body?.body ?? '', BODY_MAX);
  const title    = cleanString(body?.title ?? '', TITLE_MAX) || deriveLiveNoteTitle(noteBody);
  const courseId = cleanString(body?.courseId ?? '', 120) || null;
  const roomName = cleanString(body?.roomName ?? '', 120) || null;
  const folderId = cleanString(String(body?.folderId ?? ''), 36) || null;
  const noteDate = cleanString(body?.noteDate ?? '', 10) || new Date().toISOString().slice(0, 10);

  const row = {
    userId: user.id,
    title,
    body: noteBody,
    renderedHtml: null as string | null,
    courseId,
    folderId,
    roomName,
    noteDate,
    updatedAt: new Date().toISOString()
  };

  // Insert/update first (fast) — render markdown in background so response is immediate
  let result;
  if (id) {
    const cols = Object.keys(row);
    const vals = Object.values(row);
    const setSql = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    result = await query(
      `UPDATE "LiveClassNote" SET ${setSql} WHERE "id" = $${cols.length + 1} AND "userId" = $${cols.length + 2} 
       RETURNING id, title, "noteDate", "updatedAt"`,
      [...vals, id, user.id]
    );
  } else {
    const insertRow = { ...row, id: crypto.randomUUID(), createdAt: row.updatedAt };
    const cols = Object.keys(insertRow);
    const vals = Object.values(insertRow);
    const colSql = cols.map(c => `"${c}"`).join(', ');
    const placeholderSql = cols.map((_, i) => `$${i + 1}`).join(', ');
    result = await query(
      `INSERT INTO "LiveClassNote" (${colSql}) VALUES (${placeholderSql}) 
       RETURNING id, title, "noteDate", "createdAt"`,
      vals
    );
  }

  if (result.error) return json({ error: result.error.message }, 500);
  const savedNote = result.data?.[0];
  if (!savedNote) return json({ error: 'Failed to save note' }, 500);

  // Background render: fire-and-forget; updates renderedHtml once complete
  const savedId = savedNote.id;
  (async () => {
    try {
      const renderedHtml = await renderForumMarkdown(noteBody, { remoteLilypond: true });
      await query(
        `UPDATE "LiveClassNote" SET "renderedHtml" = $1 WHERE "id" = $2 AND "userId" = $3`,
        [renderedHtml, savedId, user.id]
      );
    } catch {
      // non-fatal: rendered HTML stays null
    }
  })();

  return json({ note: savedNote });
};

// DELETE /api/live/notes?id=...
export const DELETE: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 36);
  if (!id) return json({ error: 'id required' }, 400);

  const { error } = await query(
    `DELETE FROM "LiveClassNote" WHERE "id" = $1 AND "userId" = $2`,
    [id, user.id]
  );

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
