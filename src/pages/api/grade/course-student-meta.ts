import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';
import { resolveLiveManageAccess } from '../../../lib/live/access';

const META_KIND = 'course_student_profile';
const META_ASSIGNMENT_PREFIX = '__meta__:course-student-profile';

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

const normalizeTurno = (value: unknown) => {
  const upper = cleanString(value).toUpperCase();
  if (upper === 'M' || upper === 'T' || upper === 'N') return upper;
  return 'M';
};

const normalizeConcepto = (value: unknown) => {
  const raw = cleanString(value);
  if (!raw) return '';
  const parsed = Number(raw.replace(',', '.'));
  if (!Number.isFinite(parsed)) return '';
  const bounded = Math.min(10, Math.max(0, parsed));
  return String(Number(bounded.toFixed(2)));
};

const normalizeNotaFinal = (value: unknown) => {
  const raw = cleanString(value);
  if (!raw) return '';
  const parsed = Number(raw.replace(',', '.'));
  if (!Number.isFinite(parsed)) return '';
  const bounded = Math.min(10, Math.max(0, parsed));
  return String(Number(bounded.toFixed(2)));
};

const normalizeNotes = (value: unknown) =>
  cleanString(value)
    .replace(/\s+/g, ' ')
    .slice(0, 280);

const normalizeGrupo = (value: unknown) => {
  const raw = cleanString(value);
  if (!raw) return '';
  if (raw.toUpperCase() === 'X') return 'X';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return '';
  const normalized = Math.min(99, Math.max(0, Math.trunc(parsed)));
  return String(normalized).padStart(2, '0');
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
    slug: `${courseId}/__meta__/student-profile/${year}`,
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
    const hasTurno = Object.prototype.hasOwnProperty.call(body || {}, 'turno');
    const hasConcepto = Object.prototype.hasOwnProperty.call(body || {}, 'concepto');
    const hasGrupo = Object.prototype.hasOwnProperty.call(body || {}, 'grupo');
    const hasNotes = Object.prototype.hasOwnProperty.call(body || {}, 'notes');
    const hasNotaFinal = Object.prototype.hasOwnProperty.call(body || {}, 'notaFinal');
    const courseId = normalizeCourseId(body?.courseId);
    const studentId = cleanString(body?.studentId);
    const year = normalizeYear(body?.year);

    if (!courseId || !studentId) {
      return json({ error: 'courseId and studentId are required' }, 400);
    }

    const access = await resolveLiveManageAccess(session, courseId);
    if (!access.canManage) {
      return json({ error: 'Only teachers can update student metadata' }, 403);
    }

    const { data: students, error: studentError } = await query(
      'SELECT "id" FROM "User" WHERE "id" = $1',
      [studentId]
    );
    if (studentError) throw studentError;
    if (!students || students.length === 0) {
      return json({ error: 'Student not found' }, 404);
    }

    const assignmentId = `${META_ASSIGNMENT_PREFIX}:${encodeURIComponent(courseId)}:${year}`;
    await ensureMetaAssignment(assignmentId, courseId, year);

    const { data: existingSubmissions, error: existingError } = await query(
      'SELECT "id", "attempts", "payload" FROM "Submission" WHERE "userId" = $1 AND "assignmentId" = $2',
      [studentId, assignmentId]
    );
    if (existingError) throw existingError;

    const existingSubmission = existingSubmissions?.[0];
    let existingPayload: Record<string, any> = 
      existingSubmission?.payload && typeof existingSubmission.payload === 'object'
        ? existingSubmission.payload
        : {};

    const turno = hasTurno ? normalizeTurno(body?.turno) : normalizeTurno(existingPayload?.turno);
    const concepto = hasConcepto
      ? normalizeConcepto(body?.concepto)
      : normalizeConcepto(existingPayload?.concepto || existingPayload?.concept);
    const grupo = hasGrupo
      ? normalizeGrupo(body?.grupo)
      : normalizeGrupo(existingPayload?.grupo || existingPayload?.group);
    const notes = hasNotes
      ? normalizeNotes(body?.notes)
      : normalizeNotes(existingPayload?.notes);
    const notaFinal = hasNotaFinal
      ? normalizeNotaFinal(body?.notaFinal)
      : normalizeNotaFinal(existingPayload?.notaFinal || existingPayload?.finalGrade);

    const metaPayload = {
      __metaKind: META_KIND,
      courseId,
      studentId,
      year,
      turno,
      concepto,
      grupo,
      notes,
      notaFinal,
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

    return json({
      success: true,
      meta: {
        courseId,
        studentId,
        year,
        turno,
        concepto,
        grupo,
        notes,
        notaFinal,
      },
    });
  } catch (error: any) {
    console.error('Error updating course student metadata:', error);
    return json({ error: error?.message || 'Failed to update metadata' }, 500);
  }
};
