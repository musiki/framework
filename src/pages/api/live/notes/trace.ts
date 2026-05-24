import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../../lib/forum-server';
import { query } from '../../../../lib/db/pool';

const LABEL_MAX = 120;
const VALID_DIMENSIONS = new Set(['thematic', 'rhetorical', 'emergent', 'manual']);

export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const noteId = cleanString(url.searchParams.get('noteId') ?? '', 36);
  if (!noteId) return json({ error: 'noteId required' }, 400);

  const { data: noteCheck } = await query(
    `SELECT id FROM "LiveClassNote" WHERE id = $1 AND "userId" = $2`,
    [noteId, user.id],
  );
  if (!noteCheck?.length) return json({ error: 'Not found' }, 403);

  const { data, error } = await query(
    `SELECT id, note_id AS "noteId", para_index AS "paraIndex", label,
            dimension, source, confidence, created_at AS "createdAt"
     FROM "LiveClassNoteCode"
     WHERE note_id = $1
     ORDER BY para_index ASC, created_at ASC`,
    [noteId],
  );
  if (error) return json({ error: error.message }, 500);
  return json({ codes: data ?? [] });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body      = await request.json().catch(() => ({}));
  const noteId    = cleanString(body?.noteId ?? '', 36);
  const paraIndex = parseInt(String(body?.paraIndex ?? '-1'), 10);
  const label     = cleanString(String(body?.label ?? '').trim(), LABEL_MAX);
  const dimension = VALID_DIMENSIONS.has(body?.dimension) ? String(body.dimension) : 'manual';

  if (!noteId || !label || paraIndex < 0) return json({ error: 'noteId, paraIndex ≥ 0, label required' }, 400);

  const { data: noteCheck } = await query(
    `SELECT id FROM "LiveClassNote" WHERE id = $1 AND "userId" = $2`,
    [noteId, user.id],
  );
  if (!noteCheck?.length) return json({ error: 'Not found' }, 403);

  const { data, error } = await query(
    `INSERT INTO "LiveClassNoteCode" (id, note_id, para_index, label, dimension, source, confidence)
     VALUES ($1, $2, $3, $4, $5, 'manual', 1.0)
     ON CONFLICT (note_id, para_index, label) DO UPDATE SET created_at = now()
     RETURNING id, note_id AS "noteId", para_index AS "paraIndex",
               label, dimension, source, confidence`,
    [crypto.randomUUID(), noteId, paraIndex, label, dimension],
  );
  if (error) return json({ error: error.message }, 500);
  return json({ code: data?.[0] });
};

export const DELETE: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 36);
  if (!id) return json({ error: 'id required' }, 400);

  const { error } = await query(
    `DELETE FROM "LiveClassNoteCode" nc
     USING "LiveClassNote" n
     WHERE nc.id = $1 AND nc.note_id = n.id AND n."userId" = $2`,
    [id, user.id],
  );
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
