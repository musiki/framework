import type { APIRoute } from 'astro';
import {
  cleanBody,
  cleanString,
  ensureDbUserFromSession,
  json,
} from '../../../lib/forum-server';
import { renderForumMarkdown } from '../../../lib/forum-markdown';
import { query } from '../../../lib/db/pool';
import { getNoteAccess } from './notes/annotations';

const TITLE_MAX = 160;
const BODY_MAX  = 10_000_000;

async function validateOwnedFolderScope(
  folderId: string | null,
  userId: string,
  courseId: string | null,
): Promise<string | null> {
  if (!folderId) return null;
  const { data, error } = await query(
    `SELECT id FROM "LiveClassNoteFolder"
     WHERE id = $1::uuid AND "userId" = $2::uuid AND "courseId" IS NOT DISTINCT FROM $3
     LIMIT 1`,
    [folderId, userId, courseId],
  );
  if (error) return error.message;
  return data?.length ? null : 'Folder does not belong to this note scope';
}

async function findNoteCourseId(id: string): Promise<string | null | undefined> {
  const { data, error } = await query(
    `SELECT "courseId" FROM "LiveClassNote" WHERE id = $1::uuid LIMIT 1`,
    [id],
  );
  if (error) throw error;
  return data?.length ? (data[0].courseId ?? null) : undefined;
}

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

  // Get user's classes in this course to retrieve group-shared notes
  let userClasses: string[] = [];
  if (courseId) {
    const { data: classRows } = await query(
      `SELECT DISTINCT "claseId" FROM "ResourceSession"
       WHERE "courseId" = $1 AND "claseId" IS NOT NULL AND "claseId" != ''`,
      [courseId]
    );
    userClasses = (classRows ?? []).map((row: any) => String(row.claseId));

    // Also get the user's group from their student profile metadata submission
    const { data: profileSub } = await query(
      `SELECT payload->>'grupo' as grupo
       FROM "Submission"
       WHERE "userId" = $1::uuid 
         AND "assignmentId" LIKE $2
       LIMIT 1`,
      [user.id, `__meta__:course-student-profile:${encodeURIComponent(courseId)}:%`]
    );
    if (profileSub?.length && profileSub[0].grupo) {
      const g = String(profileSub[0].grupo).trim();
      if (g) {
        userClasses.push(g);
        userClasses.push(`${courseId}/${g}`);
      }
    }
  }

  const params: any[] = [user.id];
  let classCondition = '';
  if (userClasses.length > 0) {
    params.push(userClasses);
    classCondition = ` OR (s."targetType" = 'class' AND s."targetId" = ANY($${params.length}::text[]))`;
  }

  let sql = `SELECT DISTINCT n.id, n.title, n.body, n."renderedHtml", n."noteDate", n."courseId", n."folderId", n."createdAt", n."updatedAt", n."userId",
                    o.name as "ownerName"
             FROM "LiveClassNote" n
             LEFT JOIN "User" o ON n."userId" = o.id
             LEFT JOIN "LiveClassNoteShare" s ON n.id = s."noteId"
             WHERE (n."userId" = $1::uuid OR
                    (s."targetType" = 'user' AND s."targetId" = $1::text) OR
                    (s."targetType" = 'teachers' AND EXISTS (SELECT 1 FROM "Enrollment" WHERE "userId" = $1::uuid AND "courseId" = n."courseId" AND "roleInCourse" = 'teacher')) OR
                    (s."targetType" = 'students' AND EXISTS (SELECT 1 FROM "Enrollment" WHERE "userId" = $1::uuid AND "courseId" = n."courseId" AND "roleInCourse" = 'student'))${classCondition})`;

  if (noteId) {
    params.push(noteId);
    sql += ` AND n."id" = $${params.length}::uuid`;
  }
  if (courseId) {
    params.push(courseId);
    sql += ` AND n."courseId" = $${params.length}`;
  }
  if (roomName) {
    params.push(roomName);
    sql += ` AND n."roomName" = $${params.length}`;
  }
  if (folderId) {
    params.push(folderId);
    sql += ` AND n."folderId" = $${params.length}::uuid`;
  }

  sql += ` ORDER BY n."noteDate" DESC, n."updatedAt" DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { data, error } = await query(sql, params);
  if (error) return json({ error: error.message }, 500);

  const notesWithAccess = [];
  for (const note of data ?? []) {
    const access = await getNoteAccess(note.id, user.id);
    notesWithAccess.push({ ...note, accessLevel: access });
  }

  return json({ notes: notesWithAccess, currentUserId: user.id });
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

  if (folderId) {
    let folderCourseId = courseId;
    if (id && !('courseId' in body)) {
      const existingCourseId = await findNoteCourseId(id);
      if (existingCourseId === undefined) return json({ error: 'Not found' }, 404);
      folderCourseId = existingCourseId;
    }
    const folderError = await validateOwnedFolderScope(folderId, user.id, folderCourseId);
    if (folderError) return json({ error: folderError }, 400);
  }

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

  // Insert/update first (fast) - omitted fields on updates must remain untouched.
  let result;
  if (id) {
    const access = await getNoteAccess(id, user.id);
    if (access !== 'edit') return json({ error: 'Forbidden' }, 403);

    const updateRow: Record<string, unknown> = { updatedAt: row.updatedAt };
    if ('title' in body) updateRow.title = title;
    if ('body' in body) {
      updateRow.body = noteBody;
      updateRow.renderedHtml = null;
    }
    if ('courseId' in body) updateRow.courseId = courseId;
    if ('folderId' in body) updateRow.folderId = folderId;
    if ('roomName' in body) updateRow.roomName = roomName;
    if ('noteDate' in body) updateRow.noteDate = noteDate;
    const cols = Object.keys(updateRow);
    const vals = Object.values(updateRow);
    const setSql = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    result = await query(
      `UPDATE "LiveClassNote" SET ${setSql} WHERE "id" = $${cols.length + 1}::uuid 
       RETURNING id, title, "noteDate", "updatedAt", "courseId", "folderId"`,
      [...vals, id]
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
  if (!id || 'body' in body) {
    const savedId = savedNote.id;
    void (async () => {
      try {
        const renderedHtml = await renderForumMarkdown(noteBody, { remoteLilypond: true });
        await query(
          `UPDATE "LiveClassNote" SET "renderedHtml" = $1 WHERE "id" = $2::uuid`,
          [renderedHtml, savedId]
        );
      } catch {
        // non-fatal: rendered HTML stays null
      }
    })();
  }

  return json({ note: savedNote });
};

// PATCH /api/live/notes - partial edits must preserve note scope/folder metadata.
export const PATCH: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => ({}));
  const id = cleanString(body?.id ?? '', 36);
  if (!id) return json({ error: 'id required' }, 400);

  const sets: string[] = [];
  const params: (string | null)[] = [];
  let updatedBody: string | undefined;

  // null means "remove from folder"; missing key means "don't change"
  if ('folderId' in body) {
    const folderId = body.folderId === null ? null : cleanString(String(body.folderId ?? ''), 36) || null;
    const noteCourseId = await findNoteCourseId(id);
    if (noteCourseId === undefined) return json({ error: 'Not found' }, 404);
    const folderError = await validateOwnedFolderScope(folderId, user.id, noteCourseId);
    if (folderError) return json({ error: folderError }, 400);
    params.push(folderId);
    sets.push(`"folderId" = $${params.length}`);
  }

  if ('title' in body) {
    const title = cleanString(String(body.title ?? ''), TITLE_MAX) || 'nota';
    params.push(title);
    sets.push(`"title" = $${params.length}`);
  }

  if ('body' in body) {
    updatedBody = cleanBody(body.body ?? '', BODY_MAX);
    params.push(updatedBody);
    sets.push(`body = $${params.length}`);
  }

  if (sets.length === 0) return json({ error: 'nothing to update' }, 400);

  const access = await getNoteAccess(id, user.id);
  if (access !== 'edit') return json({ error: 'Forbidden' }, 403);

  params.push(id);
  const { data, error } = await query(
    `UPDATE "LiveClassNote" SET ${sets.join(', ')}, "updatedAt" = now()
     WHERE "id" = $${params.length}::uuid
     RETURNING id`,
    params
  );

  if (error) return json({ error: error.message }, 500);
  if (!data?.length) return json({ error: 'Not found' }, 404);

  if (updatedBody !== undefined) {
    void (async () => {
      try {
        const renderedHtml = await renderForumMarkdown(updatedBody, { remoteLilypond: true });
        await query(
          `UPDATE "LiveClassNote" SET "renderedHtml" = $1 WHERE "id" = $2::uuid`,
          [renderedHtml, id],
        );
      } catch {
        // A failed preview render must not invalidate an already-saved draft.
      }
    })();
  }

  return json({ ok: true });
};

// DELETE /api/live/notes?id=...
export const DELETE: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 36);
  if (!id) return json({ error: 'id required' }, 400);

  const { error } = await query(
    `DELETE FROM "LiveClassNote" WHERE "id" = $1::uuid AND "userId" = $2::uuid`,
    [id, user.id]
  );

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
