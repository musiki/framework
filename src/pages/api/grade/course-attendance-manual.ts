import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';
import { resolveLiveManageAccess } from '../../../lib/live/access';

const META_KIND = 'course_attendance_manual';
const META_ASSIGNMENT_PREFIX = '__meta__:course-attendance-manual';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const cleanString = (value: unknown) => String(value || '').trim();

const normalizeCourseId = (value: unknown) => {
  const raw = cleanString(value);
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const normalizeYear = (value: unknown) => {
  const raw = cleanString(value);
  if (/^\d{4}$/.test(raw)) return raw;
  return String(new Date().getFullYear());
};

const normalizeDateOnly = (value: unknown) => {
  const raw = cleanString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  return raw;
};

async function ensureMetaAssignment(
  assignmentId: string,
  courseId: string,
  year: string,
) {
  const { data: assignments, error: existingError } = await query(
    'SELECT "id" FROM "Assignment" WHERE "id" = $1',
    [assignmentId]
  );

  if (existingError) throw existingError;
  if (assignments && assignments.length > 0) return;

  const assignmentBase = {
    id: assignmentId,
    courseId,
    slug: `${courseId}/__meta__/attendance-manual/${year}`,
  };

  const withWeight = await query(
    'INSERT INTO "Assignment" ("id", "courseId", "slug", "weight") VALUES ($1, $2, $3, $4) RETURNING "id"',
    [assignmentId, courseId, assignmentBase.slug, 1]
  );

  if (!withWeight.error) return;

  const weightMissing =
    typeof withWeight.error.message === 'string'
    && withWeight.error.message.toLowerCase().includes('weight');

  if (!weightMissing) throw withWeight.error;

  const withoutWeight = await query(
    'INSERT INTO "Assignment" ("id", "courseId", "slug") VALUES ($1, $2, $3) RETURNING "id"',
    [assignmentId, courseId, assignmentBase.slug]
  );
  if (withoutWeight.error) throw withoutWeight.error;
}

const normalizeManualCountInput = (value: unknown) => {
  const raw = cleanString(String(value ?? '').replace(',', '.')).toLowerCase();
  if (!raw) {
    return {
      hasValue: false,
      count: 0,
    };
  }

  if (raw === '/' || raw === '1' || raw === '✔') {
    return {
      hasValue: true,
      count: 1,
    };
  }

  if (raw === '-' || raw === '~' || raw === '0.5' || raw === '.5') {
    return {
      hasValue: true,
      count: 0.5,
    };
  }

  if (raw === 'x' || raw === '0' || raw === '✖') {
    return {
      hasValue: true,
      count: 0,
    };
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return {
      hasValue: true,
      count: 0,
    };
  }

  const clamped = Math.max(0, Math.min(1, parsed));
  return {
    hasValue: true,
    count: Math.round(clamped * 2) / 2,
  };
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const courseId = normalizeCourseId(body?.courseId);
    const studentId = cleanString(body?.studentId);
    const year = normalizeYear(body?.year);
    const date = normalizeDateOnly(body?.date);
    const countInput = normalizeManualCountInput(body?.countRaw ?? body?.count);

    if (!courseId || !studentId || !year || !date) {
      return json({ error: 'courseId, studentId, year and date are required' }, 400);
    }

    const access = await resolveLiveManageAccess(session, courseId);
    if (!access.canManage) {
      return json({ error: 'Only teachers can update manual attendance' }, 403);
    }

    const assignmentId = `${META_ASSIGNMENT_PREFIX}:${encodeURIComponent(courseId)}:${year}`;
    await ensureMetaAssignment(assignmentId, courseId, year);

    const { data: existingRows, error: existingError } = await query(
      'SELECT "id", "attempts", "payload" FROM "Submission" WHERE "userId" = $1 AND "assignmentId" = $2 ORDER BY "submittedAt" DESC',
      [studentId, assignmentId]
    );
    if (existingError) throw existingError;
    const existingSubmission = existingRows?.[0] ?? null;
    const duplicateSubmissionIds = (existingRows || [])
      .slice(1)
      .map((row: any) => cleanString(row?.id))
      .filter(Boolean);

    const currentPayload =
      existingSubmission?.payload && typeof existingSubmission.payload === 'object' && !Array.isArray(existingSubmission.payload)
        ? existingSubmission.payload
        : {};
    const currentManualDays =
      currentPayload?.manualDays && typeof currentPayload.manualDays === 'object' && !Array.isArray(currentPayload.manualDays)
        ? { ...currentPayload.manualDays }
        : {};

    if (countInput.hasValue) {
      currentManualDays[date] = countInput.count;
    } else {
      delete currentManualDays[date];
    }

    const metaPayload = {
      __metaKind: META_KIND,
      courseId,
      studentId,
      year,
      manualDays: currentManualDays,
      updatedAt: new Date().toISOString(),
      updatedBy: access.userId || '',
      updatedByEmail: cleanString(session?.user?.email),
    };

    if (existingSubmission?.id) {
      const attempts = Number(existingSubmission.attempts || 0);
      const { error: updateError } = await query(
        'UPDATE "Submission" SET "payload" = $1, "attempts" = $2, "submittedAt" = $3 WHERE "id" = $4',
        [
          metaPayload,
          Number.isFinite(attempts) ? attempts + 1 : 1,
          new Date().toISOString(),
          existingSubmission.id
        ]
      );
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await query(
        'INSERT INTO "Submission" ("userId", "assignmentId", "payload", "attempts", "submittedAt") VALUES ($1, $2, $3, $4, $5)',
        [
          studentId,
          assignmentId,
          metaPayload,
          1,
          new Date().toISOString()
        ]
      );
      if (insertError) throw insertError;
    }

    if (duplicateSubmissionIds.length > 0) {
      const { error: dedupeError } = await query(
        'DELETE FROM "Submission" WHERE "id" = ANY($1)',
        [duplicateSubmissionIds]
      );
      if (dedupeError) {
        console.error('Error deduplicating manual attendance submissions:', dedupeError);
      }
    }

    return json({
      success: true,
      meta: {
        courseId,
        studentId,
        year,
        date,
        count: countInput.hasValue ? countInput.count : null,
        manualDays: currentManualDays,
      },
    });
  } catch (error: any) {
    console.error('Error updating manual attendance:', error);
    return json({ error: error?.message || 'Failed to update manual attendance' }, 500);
  }
};
