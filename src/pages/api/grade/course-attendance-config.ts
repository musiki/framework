import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/forum-server';
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
    slug: `${courseId}/__meta__/attendance-config/${year}`,
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

    const supabase = createSupabaseServerClient();
    const assignmentId = `${META_ASSIGNMENT_PREFIX}:${encodeURIComponent(courseId)}:${year}`;
    await ensureMetaAssignment(supabase, assignmentId, courseId, year);

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

    const { data: existingRows, error: existingError } = await supabase
      .from('Submission')
      .select('id, userId, attempts, submittedAt, payload')
      .eq('assignmentId', assignmentId)
      .order('submittedAt', { ascending: false });
    if (existingError) throw existingError;

    const teacherSubmission = (existingRows || []).find(
      (row: any) => String(row?.userId || '').trim() === String(access.userId || '').trim(),
    );

    if (teacherSubmission?.id) {
      const attempts = Number(teacherSubmission.attempts || 0);
      const { error: updateError } = await supabase
        .from('Submission')
        .update({
          payload: metaPayload,
          attempts: Number.isFinite(attempts) ? attempts + 1 : 1,
          submittedAt: new Date().toISOString(),
        })
        .eq('id', teacherSubmission.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase
        .from('Submission')
        .insert([
          {
            userId: access.userId,
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
