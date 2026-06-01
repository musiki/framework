import type { APIRoute } from 'astro';
import { ensureDbUserFromSession, json, cleanString } from '../../../../lib/forum-server';
import { query } from '../../../../lib/db/pool';

// GET /api/live/notes/share?noteId=... OR ?courseId=...&search=... OR ?courseId=...&groups=true
export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const noteId = cleanString(url.searchParams.get('noteId') ?? '', 36) || null;
  const courseId = cleanString(url.searchParams.get('courseId') ?? '', 120) || null;
  const search = url.searchParams.get('search');
  const hasGroupsFlag = url.searchParams.has('groups');

  // Case 1: Search users within the course
  if (courseId && search !== null) {
    let usersQuery = '';
    let queryParams: any[] = [];
    const metaPrefix = `__meta__:course-student-profile:${encodeURIComponent(courseId)}:%`;
    
    if (search.trim() === '') {
      // List all members of the course
      usersQuery = `
        SELECT u.id, u.name, u.email, e."roleInCourse",
               (
                 SELECT s.payload->>'grupo'
                 FROM "Submission" s
                 WHERE s."userId" = u.id 
                   AND s."assignmentId" LIKE $3
                 LIMIT 1
               ) as "grupo"
        FROM "User" u
        JOIN "Enrollment" e ON e."userId" = u.id
        WHERE e."courseId" = $1 AND u.id != $2::uuid
        ORDER BY e."roleInCourse" DESC, u.name ASC
        LIMIT 200
      `;
      queryParams = [courseId, user.id, metaPrefix];
    } else {
      // Filter by search query
      const searchVal = `%${search.trim()}%`;
      usersQuery = `
        SELECT u.id, u.name, u.email, e."roleInCourse",
               (
                 SELECT s.payload->>'grupo'
                 FROM "Submission" s
                 WHERE s."userId" = u.id 
                   AND s."assignmentId" LIKE $4
                 LIMIT 1
               ) as "grupo"
        FROM "User" u
        JOIN "Enrollment" e ON e."userId" = u.id
        WHERE e."courseId" = $1 AND u.id != $2::uuid AND (u.name ILIKE $3 OR u.email ILIKE $3)
        ORDER BY e."roleInCourse" DESC, u.name ASC
        LIMIT 30
      `;
      queryParams = [courseId, user.id, searchVal, metaPrefix];
    }

    const { data: users, error } = await query(usersQuery, queryParams);
    if (error) return json({ error: error.message }, 500);
    return json({ users: users ?? [] });
  }

  // Case 2: List classes/sessions associated with the course
  if (courseId && hasGroupsFlag) {
    const { data: sessionClasses, error: sErr } = await query(
      `SELECT DISTINCT "claseId" as id
       FROM "ResourceSession"
       WHERE "courseId" = $1 AND "claseId" IS NOT NULL AND "claseId" != ''`,
      [courseId]
    );
    if (sErr) return json({ error: sErr.message }, 500);

    const { data: metaClasses, error: mErr } = await query(
      `SELECT DISTINCT (payload->>'grupo') as grupo
       FROM "Submission"
       WHERE "assignmentId" LIKE $1 AND payload->>'grupo' IS NOT NULL AND payload->>'grupo' != ''`,
      [`__meta__:course-student-profile:${encodeURIComponent(courseId)}:%`]
    );
    if (mErr) return json({ error: mErr.message }, 500);

    // Merge groups
    const groupMap = new Map<string, string>(); // id -> display name
    
    for (const row of sessionClasses ?? []) {
      const fullId = String(row.id);
      const shortName = fullId.split('/').pop() || fullId;
      groupMap.set(fullId, `Comisión ${shortName}`);
    }

    for (const row of metaClasses ?? []) {
      const g = String(row.grupo).trim();
      if (g) {
        // Class id can be courseId/grupo or just grupo
        const fullId = `${courseId}/${g}`;
        if (!groupMap.has(fullId) && !groupMap.has(g)) {
          groupMap.set(fullId, `Comisión ${g}`);
        }
      }
    }

    const classesList = Array.from(groupMap.entries()).map(([id, name]) => ({ id, name }));
    classesList.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));

    return json({ classes: classesList });
  }

  // Case 3: List current shares of a note
  if (noteId) {
    // Verify ownership
    const { data: noteRows } = await query(
      `SELECT "userId" FROM "LiveClassNote" WHERE id = $1::uuid LIMIT 1`,
      [noteId]
    );
    if (!noteRows?.length) return json({ error: 'Note not found' }, 404);
    if (noteRows[0].userId !== user.id) return json({ error: 'Forbidden' }, 403);

    const { data: shares, error } = await query(
      `SELECT s.id, s."noteId", s."targetType", s."targetId", s."accessLevel", s."createdAt",
              CASE WHEN s."targetType" = 'user' THEN u.name ELSE NULL END as "targetName",
              CASE WHEN s."targetType" = 'user' THEN u.email ELSE NULL END as "targetEmail"
       FROM "LiveClassNoteShare" s
       LEFT JOIN "User" u ON s."targetType" = 'user' AND u.id::text = s."targetId"
       WHERE s."noteId" = $1::uuid
       ORDER BY s."createdAt" ASC`,
      [noteId]
    );

    if (error) return json({ error: error.message }, 500);
    return json({ shares: shares ?? [] });
  }

  return json({ error: 'Invalid parameters' }, 400);
};

// POST /api/live/notes/share — add/update a share permission
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => ({}));
  const noteId = cleanString(body?.noteId ?? '', 36);
  const targetType = cleanString(body?.targetType ?? '', 50);
  const targetId = cleanString(body?.targetId ?? '', 200);
  const accessLevel = cleanString(body?.accessLevel ?? '', 20);

  if (!noteId || !targetType || !targetId || !accessLevel) {
    return json({ error: 'Missing required fields' }, 400);
  }

  // Verify ownership
  const { data: noteRows } = await query(
    `SELECT "userId" FROM "LiveClassNote" WHERE id = $1::uuid LIMIT 1`,
    [noteId]
  );
  if (!noteRows?.length) return json({ error: 'Note not found' }, 404);
  if (noteRows[0].userId !== user.id) return json({ error: 'Forbidden' }, 403);

  // Upsert share record
  const { data: existing } = await query(
    `SELECT id FROM "LiveClassNoteShare" WHERE "noteId" = $1::uuid AND "targetType" = $2 AND "targetId" = $3`,
    [noteId, targetType, targetId]
  );

  let result;
  if (existing?.length) {
    result = await query(
      `UPDATE "LiveClassNoteShare" SET "accessLevel" = $1 WHERE id = $2 RETURNING id`,
      [accessLevel, existing[0].id]
    );
  } else {
    result = await query(
      `INSERT INTO "LiveClassNoteShare" ("noteId", "sharedBy", "targetType", "targetId", "accessLevel")
       VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING id`,
      [noteId, user.id, targetType, targetId, accessLevel]
    );
  }

  if (result.error) return json({ error: result.error.message }, 500);
  return json({ ok: true });
};

// DELETE /api/live/notes/share?id=... — revoke a share permission
export const DELETE: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 36);
  if (!id) return json({ error: 'id required' }, 400);

  // Verify ownership via note join
  const { data: shareRows } = await query(
    `SELECT s."noteId", n."userId"
     FROM "LiveClassNoteShare" s
     JOIN "LiveClassNote" n ON s."noteId" = n.id
     WHERE s.id = $1::uuid LIMIT 1`,
    [id]
  );
  if (!shareRows?.length) return json({ error: 'Share not found' }, 404);
  if (shareRows[0].userId !== user.id) return json({ error: 'Forbidden' }, 403);

  const { error } = await query(
    `DELETE FROM "LiveClassNoteShare" WHERE id = $1::uuid`,
    [id]
  );

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
