import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';
import { resolveLiveManageAccess } from '../../../lib/live/access';

const META_KIND = 'course_attendance_config';
const META_ASSIGNMENT_PREFIX = '__meta__:course-attendance-config';

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
    slug: `${courseId}/__meta__/attendance-config/${year}`,
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

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const courseId = normalizeCourseId(body?.courseId);
    const year = normalizeYear(body?.year);
    const startDate = normalizeDateOnly(body?.startDate);
    const endDate = normalizeDateOnly(body?.endDate);

    if (!courseId || !startDate || !endDate) {
      return json({ error: 'courseId, startDate and endDate are required' }, 400);
    }

    const access = await resolveLiveManageAccess(session, courseId);
    if (!access.canManage) {
      return json({ error: 'Only teachers can update attendance configuration' }, 403);
    }

    const assignmentId = `${META_ASSIGNMENT_PREFIX}:${encodeURIComponent(courseId)}:${year}`;
    await ensureMetaAssignment(assignmentId, courseId, year);

    const metaPayload = {
      __metaKind: META_KIND,
      courseId,
      year,
      startDate,
      endDate,
      updatedAt: new Date().toISOString(),
      updatedBy: access.userId || '',
      updatedByEmail: cleanString(session?.user?.email),
    };

    const { data: existingRows, error: existingError } = await query(
      'SELECT "id", "userId", "attempts", "submittedAt", "payload" FROM "Submission" WHERE "assignmentId" = $1 ORDER BY "submittedAt" DESC',
      [assignmentId]
    );
    if (existingError) throw existingError;

    const teacherSubmission = (existingRows || []).find(
      (row: any) => String(row?.userId || '').trim() === String(access.userId || '').trim(),
    );

    if (teacherSubmission?.id) {
      const attempts = Number(teacherSubmission.attempts || 0);
      const { error: updateError } = await query(
        'UPDATE "Submission" SET "payload" = $1, "attempts" = $2, "submittedAt" = $3 WHERE "id" = $4',
        [
          metaPayload,
          Number.isFinite(attempts) ? attempts + 1 : 1,
          new Date().toISOString(),
          teacherSubmission.id
        ]
      );
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await query(
        'INSERT INTO "Submission" ("userId", "assignmentId", "payload", "attempts", "submittedAt") VALUES ($1, $2, $3, $4, $5)',
        [
          access.userId,
          assignmentId,
          metaPayload,
          1,
          new Date().toISOString()
        ]
      );
      if (insertError) throw insertError;
    }

    return json({
      success: true,
      config: {
        courseId,
        year,
        startDate,
        endDate,
      },
    });
  } catch (error: any) {
    console.error('Error updating attendance configuration:', error);
    return json({ error: error?.message || 'Failed to update attendance configuration' }, 500);
  }
};
