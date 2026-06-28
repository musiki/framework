import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';
import { buildEvalCatalog, type EvalCatalogEntry } from '../../../lib/eval-catalog';
import { canonicalizeCourseId, canonicalizeCourseSlugPath } from '../../../lib/course-alias';
import { isElevatedGlobalRole } from '../../../lib/roles';
import { sm2, qualityFromOutcome } from '../../../lib/eval/srs';

// Spaced-repetition side-channel. Must never break the submission flow:
// callers invoke it after the submission is persisted, wrapped in try/catch.
async function updateSrsState(params: {
  userId: string;
  evalId: string;
  spaced: any;
  isCorrect?: boolean;
  score: number | null;
  confidence: number | null;
}): Promise<void> {
  const { userId, evalId, spaced, isCorrect, score, confidence } = params;
  if (!spaced || typeof spaced !== 'object' || spaced.enabled !== true) return;
  if (!userId || !evalId) return;
  if (typeof isCorrect !== 'boolean') return; // open/ungraded items don't reschedule

  const deck = typeof spaced.deck === 'string' && spaced.deck.trim() ? spaced.deck.trim() : 'default';
  const seedEase =
    typeof spaced.easeFactor === 'number' && Number.isFinite(spaced.easeFactor)
      ? spaced.easeFactor
      : 2.5;

  const { data: rows } = await query(
    'SELECT "reps", "easeFactor", "intervalDays" FROM "SrsState" WHERE "userId" = $1 AND "evalId" = $2',
    [userId, evalId],
  );
  const current = rows?.[0];
  const state = {
    reps: current ? Number(current.reps) || 0 : 0,
    easeFactor: current ? Number(current.easeFactor) || seedEase : seedEase,
    intervalDays: current ? Number(current.intervalDays) || 0 : 0,
  };

  const quality = qualityFromOutcome(isCorrect, { score, confidence });
  const next = sm2(state, quality);
  const now = new Date();

  await query(
    `INSERT INTO "SrsState" ("userId", "evalId", "deck", "reps", "easeFactor", "intervalDays", "dueAt", "lastQuality", "lastReviewedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT ("userId", "evalId") DO UPDATE SET
       "deck" = EXCLUDED."deck",
       "reps" = EXCLUDED."reps",
       "easeFactor" = EXCLUDED."easeFactor",
       "intervalDays" = EXCLUDED."intervalDays",
       "dueAt" = EXCLUDED."dueAt",
       "lastQuality" = EXCLUDED."lastQuality",
       "lastReviewedAt" = EXCLUDED."lastReviewedAt",
       "updatedAt" = EXCLUDED."updatedAt"`,
    [userId, evalId, deck, next.reps, next.easeFactor, next.intervalDays, next.dueAt, next.quality, now],
  );
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(10, Math.max(0, value));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed)) {
      return Math.min(10, Math.max(0, parsed));
    }
  }

  return null;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const EVAL_CATALOG_TTL_MS = 60_000;
const LIVE_ROUTE_SLUG_RE = /^live\/[0-9a-f-]+$/i;

let evalCatalogCache:
  | {
      loadedAt: number;
      data: Awaited<ReturnType<typeof buildEvalCatalog>>;
    }
  | null = null;

function normalizeSlugPath(value: string): string {
  return cleanString(value).replace(/^\/+|\/+$/g, '');
}

function isLiveRouteSlug(value: string): boolean {
  return LIVE_ROUTE_SLUG_RE.test(normalizeSlugPath(value));
}

async function getCachedEvalCatalog() {
  const now = Date.now();
  if (!evalCatalogCache || now - evalCatalogCache.loadedAt > EVAL_CATALOG_TTL_MS) {
    evalCatalogCache = {
      loadedAt: now,
      data: await buildEvalCatalog(),
    };
  }
  return evalCatalogCache.data;
}

async function resolveAssignmentLocation(
  evalId: string,
  requestedCourseId: string,
  requestedPageSlug: string,
): Promise<{ slug: string; courseId: string; catalogEntry: EvalCatalogEntry | null }> {
  const normalizedRequestedCourseId = await canonicalizeCourseId(requestedCourseId);
  const normalizedRequestedSlug = await canonicalizeCourseSlugPath(
    normalizeSlugPath(requestedPageSlug),
    normalizedRequestedCourseId,
  );
  const safeRequestedSlug = isLiveRouteSlug(normalizedRequestedSlug) ? '' : normalizedRequestedSlug;

  const evalCatalog = await getCachedEvalCatalog();
  const entries = evalCatalog.get(evalId) || [];
  if (entries.length === 0) {
    return {
      slug: safeRequestedSlug,
      courseId: normalizedRequestedCourseId,
      catalogEntry: null,
    };
  }

  const selected =
    entries.find((entry) => {
      const entryCourseId = cleanString(entry.courseId).toLowerCase();
      return entryCourseId && entryCourseId === normalizedRequestedCourseId.toLowerCase();
    }) || entries[0];

  const catalogSlug = normalizeSlugPath(selected.entryId);
  const catalogCourseId = await canonicalizeCourseId(
    cleanString(selected.courseId) ||
    cleanString(catalogSlug.split('/')[0]) ||
    normalizedRequestedCourseId,
  );

  return {
    slug: safeRequestedSlug || catalogSlug,
    courseId: catalogCourseId,
    catalogEntry: selected ?? null,
  };
}

function valuesDiffer(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    return value ?? null;
  };

  const l = normalize(left);
  const r = normalize(right);

  if (typeof l === 'string' || typeof r === 'string') {
    return String(l ?? '') !== String(r ?? '');
  }

  if (typeof l === 'number' || typeof r === 'number') {
    const ln = Number(l ?? NaN);
    const rn = Number(r ?? NaN);
    if (Number.isNaN(ln) && Number.isNaN(rn)) return false;
    return ln !== rn;
  }

  return JSON.stringify(l) !== JSON.stringify(r);
}

function extractColumnNameFromError(message: string): string {
  if (!message) return '';

  const patterns = [
    /Could not find the '([^']+)' column/i,
    /column "([^"]+)" of relation/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return cleanString(match[1]);
  }

  return '';
}

async function updateAssignmentSafe(
  assignmentId: string,
  payload: Record<string, unknown>,
) {
  let draft: Record<string, unknown> = { ...payload };
  let attempts = 0;

  while (Object.keys(draft).length > 0 && attempts < 12) {
    attempts += 1;
    
    const keys = Object.keys(draft);
    const setClause = keys.map((key, i) => `"${key}" = $${i + 1}`).join(', ');
    const { error } = await query(
      `UPDATE "Assignment" SET ${setClause} WHERE "id" = $${keys.length + 1}`,
      [...keys.map(k => draft[k]), assignmentId]
    );
    
    if (!error) return;

    const missingColumn = extractColumnNameFromError(String(error.message || ''));
    if (missingColumn && Object.prototype.hasOwnProperty.call(draft, missingColumn)) {
      delete draft[missingColumn];
      continue;
    }

    // Retry once without JSON-ish fields if their type differs from the current schema.
    if (Object.prototype.hasOwnProperty.call(draft, 'settings')) {
      delete draft.settings;
      continue;
    }

    throw error;
  }
}

function buildAssignmentMetadataPayload(
  evalId: string,
  finalCourseId: string,
  finalSlug: string,
  catalogEntry: EvalCatalogEntry | null,
  existingAssignment: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!catalogEntry) return {};

  const title = cleanString(catalogEntry.entryTitle || evalId);
  const prompt = cleanString(catalogEntry.prompt);
  const description = prompt || cleanString(catalogEntry.entryId);

  const candidateFields: Record<string, unknown> = {
    courseId: finalCourseId,
    slug: finalSlug,
    title,
    description,
    type: cleanString(catalogEntry.evalType || 'unknown'),
    mode: cleanString(catalogEntry.mode || 'self'),
    prompt,
    points: Number(catalogEntry.points || 0) || 0,
    lessonId: cleanString(catalogEntry.entryId),
    sourcePath: cleanString(catalogEntry.sourcePath),
    noteType: cleanString(catalogEntry.noteType),
    noteTypeLabel: cleanString(catalogEntry.noteTypeLabel),
    contentHash: cleanString(catalogEntry.contentHash),
    contentVersion: cleanString(catalogEntry.contentVersion),
    settings: {
      evalId,
      evalType: cleanString(catalogEntry.evalType || 'unknown'),
      mode: cleanString(catalogEntry.mode || 'self'),
      prompt,
      options: Array.isArray(catalogEntry.options) ? catalogEntry.options : [],
      sourceCollection: cleanString(catalogEntry.sourceCollection),
      entryId: cleanString(catalogEntry.entryId),
      entryTitle: title,
      noteType: cleanString(catalogEntry.noteType),
      noteTypeLabel: cleanString(catalogEntry.noteTypeLabel),
      sourcePath: cleanString(catalogEntry.sourcePath),
      contentHash: cleanString(catalogEntry.contentHash),
      contentVersion: cleanString(catalogEntry.contentVersion),
      evalSnapshot:
        catalogEntry.evalSnapshot && typeof catalogEntry.evalSnapshot === 'object'
          ? catalogEntry.evalSnapshot
          : {},
    },
    updatedAt: new Date().toISOString(),
  };

  if (!existingAssignment) return candidateFields;

  const existingKeys = new Set(Object.keys(existingAssignment));
  const updatePayload: Record<string, unknown> = {};
  Object.entries(candidateFields).forEach(([key, value]) => {
    if (!existingKeys.has(key)) return;
    if (valuesDiffer(existingAssignment[key], value)) {
      updatePayload[key] = value;
    }
  });

  return updatePayload;
}

function asPayloadRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function buildSubmissionPayloadWithAudit(
  payload: Record<string, unknown>,
  evalId: string,
  assignmentId: string,
  finalCourseId: string,
  finalSlug: string,
  catalogEntry: EvalCatalogEntry | null,
) {
  const nowIso = new Date().toISOString();
  const basePayload = asPayloadRecord(payload);
  const sourceSnapshot =
    catalogEntry?.evalSnapshot && typeof catalogEntry.evalSnapshot === 'object'
      ? catalogEntry.evalSnapshot
      : null;

  return {
    ...basePayload,
    _audit: {
      evalId,
      assignmentId,
      courseId: finalCourseId,
      pageSlug: finalSlug,
      contentHash: cleanString(catalogEntry?.contentHash || ''),
      contentVersion: cleanString(catalogEntry?.contentVersion || ''),
      noteType: cleanString(catalogEntry?.noteType || ''),
      noteTypeLabel: cleanString(catalogEntry?.noteTypeLabel || ''),
      sourceCollection: cleanString(catalogEntry?.sourceCollection || ''),
      sourcePath: cleanString(catalogEntry?.sourcePath || ''),
      snapshot: sourceSnapshot,
      syncedAt: nowIso,
      submittedAt: nowIso,
    },
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  try {
    const body = await request.json();

    const evalId = cleanString(body?.evalId);
    const answer = body?.answer;
    const isCorrect = typeof body?.isCorrect === 'boolean' ? body.isCorrect : undefined;
    const requestedCourseId = await canonicalizeCourseId(cleanString(body?.courseId));
    const requestedPageSlug = await canonicalizeCourseSlugPath(
      normalizeSlugPath(body?.pageSlug),
      requestedCourseId,
    );
    const feedback = cleanString(body?.feedback);
    const score = normalizeScore(body?.score);
    const markAsGraded = Boolean(body?.markAsGraded) || score !== null;
    const ensureEnrollment = Boolean(body?.ensureEnrollment);

    const targetStudentEmail = cleanString(body?.targetStudentEmail).toLowerCase();
    const targetStudentName = cleanString(body?.targetStudentName);

    const payload =
      body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : { answer, isCorrect };

    if (!evalId) {
      return json({ error: 'evalId required' }, 400);
    }

    // 1) Requester user (create on first login)
    let { data: requesterUsers, error: requesterError } = await query(
      'SELECT "id", "role", "email", "name", "image" FROM "User" WHERE "email" = $1',
      [currentUser.email]
    );

    if (requesterError) throw requesterError;
    let requesterUser = requesterUsers?.[0];

    if (!requesterUser) {
      const newUserUUID = crypto.randomUUID();
      const { data: newUsers, error: createError } = await query(
        `INSERT INTO "User" ("id", "email", "name", "emailVerified", "image", "role", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING "id", "role", "email", "name", "image"`,
        [
          newUserUUID,
          currentUser.email,
          currentUser.name || currentUser.email,
          true,
          currentUser.image || null,
          'student',
          new Date(),
          new Date(),
        ]
      );

      if (createError) throw createError;
      requesterUser = newUsers?.[0];
    }

    // 2) Decide target student user (teacher can submit on behalf of a student)
    let targetUser = requesterUser;

    if (targetStudentEmail && targetStudentEmail !== requesterUser.email?.toLowerCase()) {
      if (!isElevatedGlobalRole(requesterUser.role)) {
        return json({ error: 'Only teachers can submit for another student' }, 403);
      }

      let { data: studentUsers, error: studentFindError } = await query(
        'SELECT "id", "role", "email", "name", "image" FROM "User" WHERE "email" = $1',
        [targetStudentEmail]
      );

      if (studentFindError) throw studentFindError;
      let studentUser = studentUsers?.[0];

      if (!studentUser) {
        const newStudentUUID = crypto.randomUUID();
        const { data: createdStudents, error: studentCreateError } = await query(
          `INSERT INTO "User" ("id", "email", "name", "emailVerified", "image", "role", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING "id", "role", "email", "name", "image"`,
          [
            newStudentUUID,
            targetStudentEmail,
            targetStudentName || targetStudentEmail,
            true,
            null,
            'student',
            new Date(),
            new Date(),
          ]
        );

        if (studentCreateError) throw studentCreateError;
        studentUser = createdStudents?.[0];
      }

      targetUser = studentUser;
    }

    // 3) Ensure assignment exists
    const {
      slug: catalogSlug,
      courseId: catalogCourseId,
      catalogEntry,
    } = await resolveAssignmentLocation(
      evalId,
      requestedCourseId,
      requestedPageSlug,
    );

    const { data: assignments, error: assignmentFindError } = await query(
      'SELECT * FROM "Assignment" WHERE "id" = $1',
      [evalId]
    );

    if (assignmentFindError) throw assignmentFindError;
    const assignment = assignments?.[0];

    const assignmentCourseId = await canonicalizeCourseId(assignment?.courseId || '');
    const finalCourseId =
      assignmentCourseId ||
      catalogCourseId ||
      requestedCourseId ||
      cleanString(catalogSlug.split('/')[0]) ||
      'sin-curso';
    const finalSlug = catalogSlug || `${finalCourseId}/assignment/${evalId}`;
    const payloadWithAudit = buildSubmissionPayloadWithAudit(
      payload,
      evalId,
      evalId,
      finalCourseId,
      finalSlug,
      catalogEntry,
    );

    let assignmentRow: Record<string, unknown> | null = assignment || null;

    if (assignmentRow) {
      const assignmentSlug = normalizeSlugPath(String(assignmentRow.slug || ''));
      const shouldUpdateSlug = !assignmentSlug || isLiveRouteSlug(assignmentSlug);
      const shouldUpdateCourse =
        !cleanString(assignmentRow.courseId) ||
        cleanString(assignmentRow.courseId).toLowerCase() === 'ejemplo-generative-art';

      if (shouldUpdateSlug || shouldUpdateCourse) {
        const updatePayload: Record<string, unknown> = {};
        if (shouldUpdateSlug) updatePayload.slug = finalSlug;
        if (shouldUpdateCourse) updatePayload.courseId = finalCourseId;

        if (Object.keys(updatePayload).length > 0) {
          const keys = Object.keys(updatePayload);
          const setClause = keys.map((key, i) => `"${key}" = $${i + 1}`).join(', ');
          const { error: assignmentUpdateError } = await query(
            `UPDATE "Assignment" SET ${setClause} WHERE "id" = $${keys.length + 1}`,
            [...keys.map(k => updatePayload[k]), evalId]
          );

          if (assignmentUpdateError) throw assignmentUpdateError;
          assignmentRow = { ...assignmentRow, ...updatePayload };
        }
      }
    }

    if (!assignmentRow) {
      const assignmentBase = {
        id: evalId,
        courseId: finalCourseId,
        slug: finalSlug,
      };

      const withWeight = await query(
        'INSERT INTO "Assignment" ("id", "courseId", "slug", "weight") VALUES ($1, $2, $3, $4) RETURNING *',
        [evalId, finalCourseId, finalSlug, 1]
      );

      if (withWeight.error) {
        const weightMissing =
          typeof withWeight.error.message === 'string' &&
          withWeight.error.message.toLowerCase().includes('weight');

        if (weightMissing) {
          const withoutWeight = await query(
            'INSERT INTO "Assignment" ("id", "courseId", "slug") VALUES ($1, $2, $3) RETURNING *',
            [evalId, finalCourseId, finalSlug]
          );
          if (withoutWeight.error) throw withoutWeight.error;
          assignmentRow = withoutWeight.data?.[0] || assignmentBase;
        } else {
          throw withWeight.error;
        }
      } else {
        assignmentRow = withWeight.data?.[0] || assignmentBase;
      }
    }

    const metadataUpdate = buildAssignmentMetadataPayload(
      evalId,
      finalCourseId,
      finalSlug,
      catalogEntry,
      assignmentRow,
    );

    if (Object.keys(metadataUpdate).length > 0) {
      await updateAssignmentSafe(evalId, metadataUpdate);
      assignmentRow = {
        ...(assignmentRow || {}),
        ...metadataUpdate,
      };
    }

    let enrolledInCourse = false;
    if (ensureEnrollment && finalCourseId) {
      const { data: existingEnrollments, error: enrollmentFindError } = await query(
        'SELECT "id" FROM "Enrollment" WHERE "userId" = $1 AND "courseId" = $2',
        [targetUser.id, finalCourseId]
      );

      if (enrollmentFindError) throw enrollmentFindError;

      if (existingEnrollments && existingEnrollments.length > 0) {
        enrolledInCourse = true;
      } else {
        const { error: enrollmentInsertError } = await query(
          'INSERT INTO "Enrollment" ("userId", "courseId", "roleInCourse") VALUES ($1, $2, $3)',
          [targetUser.id, finalCourseId, 'student']
        );

        if (enrollmentInsertError) throw enrollmentInsertError;
        enrolledInCourse = true;
      }
    }

    // 4) Upsert submission
    const { data: existingSubmissions, error: existingError } = await query(
      'SELECT * FROM "Submission" WHERE "userId" = $1 AND "assignmentId" = $2',
      [targetUser.id, evalId]
    );

    if (existingError) throw existingError;
    const existing = existingSubmissions?.[0];

    const fallbackBinaryScore = typeof isCorrect === 'boolean' ? (isCorrect ? 1 : 0) : null;
    const finalScore = score !== null ? score : fallbackBinaryScore;

    const baseUpdate: Record<string, unknown> = {
      payload: payloadWithAudit,
      attempts: ((existing?.attempts as number) || 0) + 1,
      submittedAt: new Date(),
    };

    if (finalScore !== null) {
      baseUpdate.score = finalScore;
    }

    if (feedback) {
      baseUpdate.feedback = feedback;
    }

    if (markAsGraded || finalScore !== null) {
      baseUpdate.gradedAt = new Date();
    }

    let submissionId = '';

    if (existing) {
      const keys = Object.keys(baseUpdate);
      const setClause = keys.map((key, i) => `"${key}" = $${i + 1}`).join(', ');
      const { error: updateError } = await query(
        `UPDATE "Submission" SET ${setClause} WHERE "id" = $${keys.length + 1}`,
        [...keys.map(k => baseUpdate[k]), existing.id]
      );

      if (updateError) throw updateError;
      submissionId = existing.id;
    } else {
      const insertPayload: Record<string, unknown> = {
        userId: targetUser.id,
        assignmentId: evalId,
        payload: payloadWithAudit,
        attempts: 1,
        submittedAt: new Date(),
      };

      if (finalScore !== null) insertPayload.score = finalScore;
      if (feedback) insertPayload.feedback = feedback;
      if (markAsGraded || finalScore !== null) insertPayload.gradedAt = new Date();

      const keys = Object.keys(insertPayload);
      const cols = keys.map(k => `"${k}"`).join(', ');
      const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
      const { data: createdSubmissions, error: insertError } = await query(
        `INSERT INTO "Submission" (${cols}) VALUES (${vals}) RETURNING "id"`,
        keys.map(k => insertPayload[k])
      );

      if (insertError) throw insertError;
      submissionId = createdSubmissions?.[0]?.id;
    }

    // Spaced-repetition scheduling (best-effort; never blocks the response).
    try {
      const spacedSpec = (catalogEntry?.evalSnapshot as Record<string, unknown> | undefined)?.spaced;
      if (spacedSpec) {
        const confidenceRaw = (payload as Record<string, unknown>)?.confidence;
        const confidence =
          typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw) ? confidenceRaw : null;
        await updateSrsState({
          userId: targetUser.id,
          evalId,
          spaced: spacedSpec,
          isCorrect,
          score: finalScore,
          confidence,
        });
      }
    } catch (srsError: any) {
      console.warn('[SRS] update skipped:', srsError?.message || srsError);
    }

    return json(
      {
        success: true,
        isCorrect,
        score: finalScore,
        submissionId,
        targetUser: {
          id: targetUser.id,
          email: targetUser.email,
          name: targetUser.name,
        },
        enrolledInCourse,
      },
      200,
    );
  } catch (error: any) {
    console.error('Submission error:', error?.message || error);
    return json({ error: error?.message || 'Submission error' }, 500);
  }
};
