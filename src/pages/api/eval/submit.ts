import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { buildEvalCatalog, type EvalCatalogEntry } from '../../../lib/eval-catalog';
import { canonicalizeCourseId, canonicalizeCourseSlugPath } from '../../../lib/course-alias';

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
  supabase: ReturnType<typeof createClient>,
  assignmentId: string,
  payload: Record<string, unknown>,
) {
  let draft = { ...payload };
  let attempts = 0;

  while (Object.keys(draft).length > 0 && attempts < 12) {
    attempts += 1;
    const { error } = await supabase.from('Assignment').update(draft).eq('id', assignmentId);
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

  const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);

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
    let { data: requesterUser, error: requesterError } = await supabase
      .from('User')
      .select('id, role, email, name, image')
      .eq('email', currentUser.email)
      .maybeSingle();

    if (requesterError) throw requesterError;

    if (!requesterUser) {
      const { data: newUser, error: createError } = await supabase
        .from('User')
        .insert([
          {
            id: crypto.randomUUID(),
            email: currentUser.email,
            name: currentUser.name || currentUser.email,
            emailVerified: true,
            image: currentUser.image || null,
            role: 'student',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ])
        .select('id, role, email, name, image')
        .single();

      if (createError) throw createError;
      requesterUser = newUser;
    }

    // 2) Decide target student user (teacher can submit on behalf of a student)
    let targetUser = requesterUser;

    if (targetStudentEmail && targetStudentEmail !== requesterUser.email?.toLowerCase()) {
      if (requesterUser.role !== 'teacher') {
        return json({ error: 'Only teachers can submit for another student' }, 403);
      }

      let { data: studentUser, error: studentFindError } = await supabase
        .from('User')
        .select('id, role, email, name, image')
        .eq('email', targetStudentEmail)
        .maybeSingle();

      if (studentFindError) throw studentFindError;

      if (!studentUser) {
        const { data: createdStudent, error: studentCreateError } = await supabase
          .from('User')
          .insert([
            {
              id: crypto.randomUUID(),
              email: targetStudentEmail,
              name: targetStudentName || targetStudentEmail,
              emailVerified: true,
              image: null,
              role: 'student',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ])
          .select('id, role, email, name, image')
          .single();

        if (studentCreateError) throw studentCreateError;
        studentUser = createdStudent;
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

    const { data: assignment, error: assignmentFindError } = await supabase
      .from('Assignment')
      .select('*')
      .eq('id', evalId)
      .maybeSingle();

    if (assignmentFindError) throw assignmentFindError;

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
          const { error: assignmentUpdateError } = await supabase
            .from('Assignment')
            .update(updatePayload)
            .eq('id', evalId);

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

      const withWeight = await supabase.from('Assignment').insert([
        {
          ...assignmentBase,
          weight: 1,
        },
      ]);

      if (withWeight.error) {
        const weightMissing =
          typeof withWeight.error.message === 'string' &&
          withWeight.error.message.toLowerCase().includes('weight');

        if (weightMissing) {
          const withoutWeight = await supabase.from('Assignment').insert([assignmentBase]);
          if (withoutWeight.error) throw withoutWeight.error;
        } else {
          throw withWeight.error;
        }
      }

      const { data: createdAssignment, error: createdAssignmentError } = await supabase
        .from('Assignment')
        .select('*')
        .eq('id', evalId)
        .maybeSingle();

      if (createdAssignmentError) throw createdAssignmentError;
      assignmentRow = createdAssignment || assignmentBase;
    }

    const metadataUpdate = buildAssignmentMetadataPayload(
      evalId,
      finalCourseId,
      finalSlug,
      catalogEntry,
      assignmentRow,
    );

    if (Object.keys(metadataUpdate).length > 0) {
      await updateAssignmentSafe(supabase, evalId, metadataUpdate);
      assignmentRow = {
        ...(assignmentRow || {}),
        ...metadataUpdate,
      };
    }

    let enrolledInCourse = false;
    if (ensureEnrollment && finalCourseId) {
      const { data: existingEnrollment, error: enrollmentFindError } = await supabase
        .from('Enrollment')
        .select('id')
        .eq('userId', targetUser.id)
        .eq('courseId', finalCourseId)
        .maybeSingle();

      if (enrollmentFindError) throw enrollmentFindError;

      if (existingEnrollment) {
        enrolledInCourse = true;
      } else {
        const { error: enrollmentInsertError } = await supabase.from('Enrollment').insert([
          {
            userId: targetUser.id,
            courseId: finalCourseId,
            roleInCourse: 'student',
          },
        ]);

        if (enrollmentInsertError) throw enrollmentInsertError;
        enrolledInCourse = true;
      }
    }

    // 4) Upsert submission
    const { data: existing, error: existingError } = await supabase
      .from('Submission')
      .select('*')
      .eq('userId', targetUser.id)
      .eq('assignmentId', evalId)
      .maybeSingle();

    if (existingError) throw existingError;

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
      const { error: updateError } = await supabase
        .from('Submission')
        .update(baseUpdate)
        .eq('id', existing.id);

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

      const { data: createdSubmission, error: insertError } = await supabase
        .from('Submission')
        .insert([insertPayload])
        .select('id')
        .single();

      if (insertError) throw insertError;
      submissionId = createdSubmission.id;
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
