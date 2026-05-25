import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../lib/forum-server';
import { query } from '../../lib/db/pool';

async function validateOwnedParent(
  parentId: string | null,
  userId: string,
  courseId: string | null,
): Promise<string | null> {
  if (!parentId) return null;
  const { data, error } = await query(
    `SELECT id FROM "LiveClassNoteFolder"
     WHERE id = $1 AND "userId" = $2 AND "courseId" IS NOT DISTINCT FROM $3
     LIMIT 1`,
    [parentId, userId, courseId],
  );
  if (error) return error.message;
  return data?.length ? null : 'Parent folder does not belong to this scope';
}

export const GET: APIRoute = async ({ locals, url }) => {
  const user = await ensureDbUserFromSession((locals as any).session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const courseId = cleanString(url.searchParams.get('courseId') ?? '', 120) || null;

  const params: any[] = [user.id];
  let sql = `SELECT id, name, "parentId", "courseId", "createdAt"
             FROM "LiveClassNoteFolder" WHERE "userId" = $1`;
  if (courseId) { params.push(courseId); sql += ` AND "courseId" = $${params.length}`; }
  sql += ' ORDER BY name ASC';

  const { data, error } = await query(sql, params);
  if (error) return json({ error: error.message }, 500);
  return json({ folders: data ?? [] });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = await ensureDbUserFromSession((locals as any).session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => null);
  const name     = cleanString(String(body?.name ?? ''), 200);
  const parentId = cleanString(String(body?.parentId ?? ''), 36) || null;
  const courseId = cleanString(String(body?.courseId ?? ''), 120) || null;

  if (!name) return json({ error: 'name required' }, 400);
  const parentError = await validateOwnedParent(parentId, user.id, courseId);
  if (parentError) return json({ error: parentError }, 400);

  const { data, error } = await query(
    `INSERT INTO "LiveClassNoteFolder" (name, "parentId", "userId", "courseId")
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, parentId, user.id, courseId],
  );
  if (error) return json({ error: error.message }, 500);
  return json({ folder: data?.[0] ?? null });
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const user = await ensureDbUserFromSession((locals as any).session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => null);
  const id       = cleanString(String(body?.id ?? ''), 36);
  const name     = body?.name != null ? cleanString(String(body.name), 200) : undefined;
  const parentId = body?.parentId !== undefined
    ? (cleanString(String(body.parentId), 36) || null)
    : undefined;

  if (!id) return json({ error: 'id required' }, 400);

  if (parentId !== undefined) {
    if (parentId === id) return json({ error: 'A folder cannot contain itself' }, 400);
    const { data: ownFolder, error: ownFolderError } = await query(
      `SELECT "courseId" FROM "LiveClassNoteFolder" WHERE id = $1 AND "userId" = $2 LIMIT 1`,
      [id, user.id],
    );
    if (ownFolderError) return json({ error: ownFolderError.message }, 500);
    if (!ownFolder?.length) return json({ error: 'Not found' }, 404);
    const parentError = await validateOwnedParent(parentId, user.id, ownFolder[0].courseId ?? null);
    if (parentError) return json({ error: parentError }, 400);
  }

  const sets: string[] = [];
  const params: any[] = [];
  if (name !== undefined)     { params.push(name);     sets.push(`"name" = $${params.length}`); }
  if (parentId !== undefined) { params.push(parentId); sets.push(`"parentId" = $${params.length}`); }
  if (!sets.length) return json({ error: 'nothing to update' }, 400);

  params.push(id, user.id);
  const { data, error } = await query(
    `UPDATE "LiveClassNoteFolder" SET ${sets.join(', ')}
     WHERE "id" = $${params.length - 1} AND "userId" = $${params.length} RETURNING *`,
    params,
  );
  if (error) return json({ error: error.message }, 500);
  return json({ folder: data?.[0] ?? null });
};

export const DELETE: APIRoute = async ({ locals, url }) => {
  const user = await ensureDbUserFromSession((locals as any).session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 36);
  if (!id) return json({ error: 'id required' }, 400);

  // Deleting a parent cascades its folders; lift notes from every descendant first.
  await query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM "LiveClassNoteFolder" WHERE id = $1 AND "userId" = $2
       UNION ALL
       SELECT f.id FROM "LiveClassNoteFolder" f
       JOIN descendants d ON f."parentId" = d.id
       WHERE f."userId" = $2
     )
     UPDATE "LiveClassNote" SET "folderId" = NULL
     WHERE "folderId" IN (SELECT id FROM descendants) AND "userId" = $2`,
    [id, user.id],
  );
  const { error } = await query(`DELETE FROM "LiveClassNoteFolder" WHERE "id" = $1 AND "userId" = $2`, [id, user.id]);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
