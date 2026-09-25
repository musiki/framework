import type { APIRoute } from 'astro';
import { ensureDbUserFromSession, json, cleanString } from '../../../../lib/forum-server';
import { query } from '../../../../lib/db/pool';
import { getNoteAccess } from '../../../../lib/writing/notes/access';

export { getNoteAccess };

// GET /api/live/notes/annotations?noteId=... — retrieve inline highlights and replies
export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const noteId = cleanString(url.searchParams.get('noteId') ?? '', 36);
  if (!noteId) return json({ error: 'noteId required' }, 400);

  const access = await getNoteAccess(noteId, user.id, { tenantId: (locals as any).tenant?.id ?? 'musiki' });
  if (!access) return json({ error: 'Forbidden' }, 403);

  // 1. Get annotations
  const { data: annotations, error: aError } = await query(
    `SELECT a.id, a."noteId", a."authorId", a.quote, a."anchorJson", a.body, a."isResolved", a."createdAt", a."updatedAt",
            u.name as "authorName", u.email as "authorEmail"
     FROM "LiveClassNoteAnnotation" a
     JOIN "User" u ON a."authorId" = u.id
     WHERE a."noteId" = $1::uuid
     ORDER BY a."createdAt" ASC`,
    [noteId]
  );

  if (aError) return json({ error: aError.message }, 500);
  if (!annotations?.length) return json({ annotations: [] });

  // 2. Get comment replies
  const annotationIds = annotations.map(a => a.id);
  const { data: comments, error: cError } = await query(
    `SELECT c.id, c."annotationId", c."authorId", c.body, c."createdAt", c."updatedAt",
            u.name as "authorName", u.email as "authorEmail"
     FROM "LiveClassNoteComment" c
     JOIN "User" u ON c."authorId" = u.id
     WHERE c."annotationId" = ANY($1::uuid[])
     ORDER BY c."createdAt" ASC`,
    [annotationIds]
  );

  if (cError) return json({ error: cError.message }, 500);

  // Assemble replies into annotations
  const commentsMap = new Map<string, any[]>();
  for (const c of comments ?? []) {
    const aId = c.annotationId;
    if (!commentsMap.has(aId)) commentsMap.set(aId, []);
    commentsMap.get(aId)!.push(c);
  }

  const result = annotations.map(a => ({
    ...a,
    replies: commentsMap.get(a.id) ?? []
  }));

  return json({ annotations: result });
};

// POST /api/live/notes/annotations — add/update annotations or threaded comments
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => ({}));
  const id = cleanString(body?.id ?? '', 36) || null;
  const noteId = cleanString(body?.noteId ?? '', 36);
  const annotationId = cleanString(body?.annotationId ?? '', 36) || null; // present if it's a comment reply
  const commentBody = cleanString(body?.body ?? '', 4000);

  if (!commentBody) return json({ error: 'Body required' }, 400);

  // Case A: Saving a comment reply
  if (annotationId) {
    const { data: parent } = await query(
      `SELECT "noteId" FROM "LiveClassNoteAnnotation" WHERE id = $1::uuid LIMIT 1`,
      [annotationId]
    );
    if (!parent?.length) return json({ error: 'Parent annotation not found' }, 404);

    const access = await getNoteAccess(parent[0].noteId, user.id, { tenantId: (locals as any).tenant?.id ?? 'musiki' });
    if (access !== 'comment' && access !== 'edit') return json({ error: 'Forbidden' }, 403);

    let result;
    if (id) {
      // Update existing reply
      const { data: existing } = await query(
        `SELECT "authorId" FROM "LiveClassNoteComment" WHERE id = $1::uuid LIMIT 1`,
        [id]
      );
      if (!existing?.length) return json({ error: 'Reply not found' }, 404);
      if (existing[0].authorId !== user.id) return json({ error: 'Forbidden' }, 403);

      result = await query(
        `UPDATE "LiveClassNoteComment" SET body = $1, "updatedAt" = now() WHERE id = $2::uuid RETURNING *`,
        [commentBody, id]
      );
    } else {
      // Create new reply
      result = await query(
        `INSERT INTO "LiveClassNoteComment" ("annotationId", "authorId", body)
         VALUES ($1::uuid, $2::uuid, $3) RETURNING *`,
        [annotationId, user.id, commentBody]
      );
    }

    if (result.error) return json({ error: result.error.message }, 500);
    return json({ comment: result.data?.[0] });
  }

  // Case B: Saving a root annotation
  if (!noteId) return json({ error: 'noteId required' }, 400);
  const access = await getNoteAccess(noteId, user.id, { tenantId: (locals as any).tenant?.id ?? 'musiki' });
  if (access !== 'comment' && access !== 'edit') return json({ error: 'Forbidden' }, 403);

  const quote = cleanString(body?.quote ?? '', 1000);
  const anchorJson = body?.anchorJson || {};
  const isResolved = Boolean(body?.isResolved);

  let result;
  if (id) {
    // Update existing annotation
    const { data: existing } = await query(
      `SELECT "authorId", "noteId" FROM "LiveClassNoteAnnotation" WHERE id = $1::uuid LIMIT 1`,
      [id]
    );
    if (!existing?.length) return json({ error: 'Annotation not found' }, 404);

    // Verify ownership OR if resolver is note owner (note owner can resolve any comment)
    const { data: noteOwner } = await query(
      `SELECT "userId" FROM "LiveClassNote" WHERE id = $1::uuid LIMIT 1`,
      [existing[0].noteId]
    );

    const isAuthor = existing[0].authorId === user.id;
    const isOwner = noteOwner?.length && noteOwner[0].userId === user.id;

    if (!isAuthor && !isOwner) return json({ error: 'Forbidden' }, 403);

    result = await query(
      `UPDATE "LiveClassNoteAnnotation" 
       SET body = $1, "isResolved" = $2, "updatedAt" = now() 
       WHERE id = $3::uuid RETURNING *`,
      [commentBody, isResolved, id]
    );
  } else {
    // Create new annotation
    result = await query(
      `INSERT INTO "LiveClassNoteAnnotation" ("noteId", "authorId", quote, "anchorJson", body, "isResolved")
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6) RETURNING *`,
      [noteId, user.id, quote, anchorJson, commentBody, isResolved]
    );
  }

  if (result.error) return json({ error: result.error.message }, 500);
  return json({ annotation: result.data?.[0] });
};

// DELETE /api/live/notes/annotations?id=... OR ?commentId=... — delete an annotation or reply
export const DELETE: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 36) || null;
  const commentId = cleanString(url.searchParams.get('commentId') ?? '', 36) || null;

  if (commentId) {
    // Delete comment reply
    const { data: commentRows } = await query(
      `SELECT c."authorId", a."noteId", n."userId" as "noteOwnerId"
       FROM "LiveClassNoteComment" c
       JOIN "LiveClassNoteAnnotation" a ON c."annotationId" = a.id
       JOIN "LiveClassNote" n ON a."noteId" = n.id
       WHERE c.id = $1::uuid LIMIT 1`,
      [commentId]
    );
    if (!commentRows?.length) return json({ error: 'Reply not found' }, 404);
    if (commentRows[0].authorId !== user.id && commentRows[0].noteOwnerId !== user.id) {
      return json({ error: 'Forbidden' }, 403);
    }

    const { error } = await query(`DELETE FROM "LiveClassNoteComment" WHERE id = $1::uuid`, [commentId]);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (id) {
    // Delete root annotation
    const { data: annotationRows } = await query(
      `SELECT a."authorId", a."noteId", n."userId" as "noteOwnerId"
       FROM "LiveClassNoteAnnotation" a
       JOIN "LiveClassNote" n ON a."noteId" = n.id
       WHERE a.id = $1::uuid LIMIT 1`,
      [id]
    );
    if (!annotationRows?.length) return json({ error: 'Annotation not found' }, 404);
    if (annotationRows[0].authorId !== user.id && annotationRows[0].noteOwnerId !== user.id) {
      return json({ error: 'Forbidden' }, 403);
    }

    const { error } = await query(`DELETE FROM "LiveClassNoteAnnotation" WHERE id = $1::uuid`, [id]);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'id or commentId required' }, 400);
};
