import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/forum-server';
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
    slug: `${courseId}/__meta__/attendance-manual/${year}`,
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

    const supabase = createSupabaseServerClient();
    const assignmentId = `${META_ASSIGNMENT_PREFIX}:${encodeURIComponent(courseId)}:${year}`;
    await ensureMetaAssignment(supabase, assignmentId, courseId, year);

    const { data: existingSubmission, error: existingError } = await supabase
      .from('Submission')
      .select('id, attempts, payload')
      .eq('userId', studentId)
      .eq('assignmentId', assignmentId)
      .maybeSingle();
    if (existingError) throw existingError;

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
