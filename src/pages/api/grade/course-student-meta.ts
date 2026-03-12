import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/forum-server';
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

const normalizeGrupo = (value: unknown) => {
  const raw = cleanString(value);
  if (!raw) return '';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return '';
  const normalized = Math.min(99, Math.max(0, Math.trunc(parsed)));
  return String(normalized).padStart(2, '0');
};

async function ensureMetaAssignment(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  assignmentId: string,
  courseId: string,
  year: string,
) {
  const { data: existing, error: existingError } = await supabase
    .from('Assignment')
    .select('id')
    .eq('id', assignmentId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return;

  const assignmentBase = {
    id: assignmentId,
    courseId,
    slug: `${courseId}/__meta__/student-profile/${year}`,
  };

  const withWeight = await supabase.from('Assignment').insert([
    {
      ...assignmentBase,
      weight: 1,
    },
  ]);

  if (!withWeight.error) return;

  const weightMissing =
    typeof withWeight.error.message === 'string'
    && withWeight.error.message.toLowerCase().includes('weight');

  if (!weightMissing) throw withWeight.error;

  const withoutWeight = await supabase.from('Assignment').insert([assignmentBase]);
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

    const supabase = createSupabaseServerClient();

    const { data: student, error: studentError } = await supabase
      .from('User')
      .select('id')
      .eq('id', studentId)
      .maybeSingle();
    if (studentError) throw studentError;
    if (!student) {
      return json({ error: 'Student not found' }, 404);
    }

    const assignmentId = `${META_ASSIGNMENT_PREFIX}:${encodeURIComponent(courseId)}:${year}`;
    await ensureMetaAssignment(supabase, assignmentId, courseId, year);

    const { data: existingSubmission, error: existingError } = await supabase
      .from('Submission')
      .select('id, attempts')
      .eq('userId', studentId)
      .eq('assignmentId', assignmentId)
      .maybeSingle();
    if (existingError) throw existingError;

    let existingPayload: Record<string, any> = {};
    if (existingSubmission?.id) {
      const { data: existingPayloadRow, error: existingPayloadError } = await supabase
        .from('Submission')
        .select('payload')
        .eq('id', existingSubmission.id)
        .maybeSingle();
      if (existingPayloadError) throw existingPayloadError;
      existingPayload =
        existingPayloadRow?.payload && typeof existingPayloadRow.payload === 'object'
          ? existingPayloadRow.payload
          : {};
    }

    const turno = hasTurno ? normalizeTurno(body?.turno) : normalizeTurno(existingPayload?.turno);
    const concepto = hasConcepto
      ? normalizeConcepto(body?.concepto)
      : normalizeConcepto(existingPayload?.concepto || existingPayload?.concept);
    const grupo = hasGrupo
      ? normalizeGrupo(body?.grupo)
      : normalizeGrupo(existingPayload?.grupo || existingPayload?.group);

    const metaPayload = {
      __metaKind: META_KIND,
      courseId,
      studentId,
      year,
      turno,
      concepto,
      grupo,
      updatedAt: new Date().toISOString(),
      updatedBy: access.userId || '',
      updatedByEmail: cleanString(session?.user?.email),
    };

    if (existingSubmission?.id) {
      const attempts = Number(existingSubmission.attempts || 0);
      const { error: updateError } = await supabase
        .from('Submission')
        .update({
          payload: metaPayload,
          attempts: Number.isFinite(attempts) ? attempts + 1 : 1,
          submittedAt: new Date().toISOString(),
        })
        .eq('id', existingSubmission.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase
        .from('Submission')
        .insert([
          {
            userId: studentId,
            assignmentId,
            payload: metaPayload,
            attempts: 1,
            submittedAt: new Date().toISOString(),
          },
        ]);
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
      },
    });
  } catch (error: any) {
    console.error('Error updating course student metadata:', error);
    return json({ error: error?.message || 'Failed to update metadata' }, 500);
  }
};
