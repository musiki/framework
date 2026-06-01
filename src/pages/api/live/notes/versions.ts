import type { APIRoute } from 'astro';
import { ensureDbUserFromSession, json, cleanString } from '../../../../lib/forum-server';
import { query } from '../../../../lib/db/pool';
import { getNoteAccess } from './annotations';
import { renderForumMarkdown } from '../../../../lib/forum-markdown';

// GET /api/live/notes/versions?noteId=... — retrieve version history
export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const noteId = cleanString(url.searchParams.get('noteId') ?? '', 36);
  if (!noteId) return json({ error: 'noteId required' }, 400);

  const access = await getNoteAccess(noteId, user.id);
  if (access !== 'edit') return json({ error: 'Forbidden' }, 403);

  const { data: versions, error } = await query(
    `SELECT v.id, v."noteId", v.title, v."versionName", v."createdById", v."createdAt",
            u.name as "createdByUserName"
     FROM "LiveClassNoteVersion" v
     JOIN "User" u ON v."createdById" = u.id
     WHERE v."noteId" = $1::uuid
     ORDER BY v."createdAt" DESC`,
    [noteId]
  );

  if (error) return json({ error: error.message }, 500);
  return json({ versions: versions ?? [] });
};

// POST /api/live/notes/versions — save a named version or restore to a version
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => ({}));
  const noteId = cleanString(body?.noteId ?? '', 36);
  const versionId = cleanString(body?.versionId ?? '', 36) || null; // present for restore
  const versionName = cleanString(body?.versionName ?? '', 200) || null; // present for save

  if (!noteId) return json({ error: 'noteId required' }, 400);

  const access = await getNoteAccess(noteId, user.id);
  if (access !== 'edit') return json({ error: 'Forbidden' }, 403);

  // Case A: Restore a version
  if (versionId) {
    const { data: versionRows } = await query(
      `SELECT title, body FROM "LiveClassNoteVersion" WHERE id = $1::uuid AND "noteId" = $2::uuid LIMIT 1`,
      [versionId, noteId]
    );
    if (!versionRows?.length) return json({ error: 'Version not found' }, 404);

    const { title, body: vBody } = versionRows[0];

    const { error: updateError } = await query(
      `UPDATE "LiveClassNote" SET title = $1, body = $2, "renderedHtml" = NULL, "updatedAt" = now()
       WHERE id = $3::uuid`,
      [title, vBody, noteId]
    );

    if (updateError) return json({ error: updateError.message }, 500);

    // Background render HTML
    void (async () => {
      try {
        const renderedHtml = await renderForumMarkdown(vBody, { remoteLilypond: true });
        await query(
          `UPDATE "LiveClassNote" SET "renderedHtml" = $1 WHERE "id" = $2::uuid`,
          [renderedHtml, noteId]
        );
      } catch {
        // ignore preview render failures
      }
    })();

    return json({ ok: true, title, body: vBody });
  }

  // Case B: Save a new version snapshot
  if (!versionName) return json({ error: 'versionName required' }, 400);

  // Fetch current note title and body
  const { data: noteRows } = await query(
    `SELECT title, body FROM "LiveClassNote" WHERE id = $1::uuid LIMIT 1`,
    [noteId]
  );
  if (!noteRows?.length) return json({ error: 'Note not found' }, 404);

  const { title, body: nBody } = noteRows[0];

  const { data: savedVersion, error: saveError } = await query(
    `INSERT INTO "LiveClassNoteVersion" ("noteId", title, body, "versionName", "createdById")
     VALUES ($1::uuid, $2, $3, $4, $5::uuid)
     RETURNING id, "versionName", "createdAt"`,
    [noteId, title, nBody, versionName, user.id]
  );

  if (saveError) return json({ error: saveError.message }, 500);
  return json({ version: savedVersion?.[0] });
};
