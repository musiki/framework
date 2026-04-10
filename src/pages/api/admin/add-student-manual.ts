import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/forum-server';
import { canonicalizeCourseId } from '../../../lib/course-alias';
import { isAdminGlobalRole, isElevatedGlobalRole } from '../../../lib/roles';

const clean = (v: unknown) => String(v || '').trim();
const cleanLower = (v: unknown) => clean(v).toLowerCase();

const normalizeTurno = (v: unknown) => {
  const u = clean(v).toUpperCase();
  return ['M', 'T', 'N'].includes(u) ? u : 'M';
};

const normalizeGrupo = (v: unknown) => {
  const raw = clean(v);
  if (!raw) return '';
  if (raw.toUpperCase() === 'X') return 'X';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  return String(Math.min(99, Math.max(0, Math.trunc(n)))).padStart(2, '0');
};

const normalizeYear = (v: unknown) => {
  const raw = clean(v);
  return /^\d{4}$/.test(raw) ? raw : String(new Date().getFullYear());
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;
  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const courseId = clean(body?.courseId);
  const year = normalizeYear(body?.year);
  const requestedUserId = clean(body?.userId);
  const firstName = clean(body?.firstName);
  const lastName = clean(body?.lastName);
  const email = cleanLower(body?.email);
  const turno = normalizeTurno(body?.turno);
  const grupo = normalizeGrupo(body?.grupo);

  if (!courseId) {
    return new Response(JSON.stringify({ error: 'courseId is required' }), { status: 400 });
  }

  if (!requestedUserId && (!email || !email.includes('@'))) {
    return new Response(JSON.stringify({ error: 'userId or valid email is required' }), { status: 400 });
  }

  const supabase = createSupabaseServerClient();

  // Verify requester is a teacher and owns the course.
  const { data: actingUsers } = await supabase
    .from('User')
    .select('id, role')
    .ilike('email', cleanLower(currentUser.email));
  const requester = (actingUsers || [])[0];
  if (!requester || !Array.isArray(actingUsers) || actingUsers.length === 0) {
    return new Response(JSON.stringify({ error: 'Requester not found' }), { status: 404 });
  }

  const actingUserIds = actingUsers
    .map((user: any) => clean(user?.id))
    .filter(Boolean);

  const { data: requesterEnrollments } = await supabase
    .from('Enrollment')
    .select('courseId, roleInCourse, userId')
    .in('userId', actingUserIds);
  const isAdmin =
    (actingUsers || []).some((user: any) => isAdminGlobalRole(user?.role));
  const isTeacher =
    (actingUsers || []).some((user: any) => isElevatedGlobalRole(user?.role))
    || (requesterEnrollments || []).some((e: any) => cleanLower(e?.roleInCourse) === 'teacher');
  if (!isTeacher) return new Response(JSON.stringify({ error: 'Only teachers can add students' }), { status: 403 });

  const canonicalCourse = await canonicalizeCourseId(courseId);
  if (!canonicalCourse) return new Response(JSON.stringify({ error: 'Course not found' }), { status: 404 });

  const manageableCourses = new Set<string>();
  for (const enrollment of requesterEnrollments || []) {
    if (cleanLower(enrollment?.roleInCourse) !== 'teacher') continue;
    const managedCourseId = await canonicalizeCourseId(enrollment?.courseId);
    if (managedCourseId) manageableCourses.add(managedCourseId);
  }

  if (!isAdmin && !manageableCourses.has(canonicalCourse)) {
    return new Response(JSON.stringify({ error: 'You can only add students to your own courses' }), { status: 403 });
  }

  // Find or create user
  let userId: string;
  let resolvedEmail = email;

  if (requestedUserId) {
    const { data: existingUserById, error: existingUserByIdError } = await supabase
      .from('User')
      .select('id, email')
      .eq('id', requestedUserId)
      .maybeSingle();
    if (existingUserByIdError) {
      return new Response(JSON.stringify({ error: existingUserByIdError.message }), { status: 500 });
    }
    if (!existingUserById) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
    }
    userId = existingUserById.id;
    resolvedEmail = cleanLower(existingUserById.email);
  } else {
    const { data: existingUsers } = await supabase.from('User').select('id, email').ilike('email', email);
    if (existingUsers && existingUsers.length > 0) {
      userId = existingUsers[0].id;
      resolvedEmail = cleanLower(existingUsers[0].email);
    } else {
      const name = [lastName, firstName].filter(Boolean).join(', ') || email;
      const newId = crypto.randomUUID();
      const { error: insertErr } = await supabase.from('User').insert([{
        id: newId, email, name,
        emailVerified: false, role: 'student',
        createdAt: new Date(), updatedAt: new Date(),
      }]);
      if (insertErr) return new Response(JSON.stringify({ error: insertErr.message }), { status: 500 });
      userId = newId;
    }
  }

  // Check existing enrollment
  const { data: existingEnrollment } = await supabase
    .from('Enrollment')
    .select('id, userId, courseId, roleInCourse')
    .eq('userId', userId)
    .eq('courseId', canonicalCourse)
    .maybeSingle();
  let status: string;
  let enrollmentRecord = existingEnrollment || null;

  if (existingEnrollment) {
    status = 'already_enrolled';
  } else {
    const { data: insertedEnrollment, error: enrollErr } = await supabase
      .from('Enrollment')
      .insert([{ userId, courseId: canonicalCourse, roleInCourse: 'student' }])
      .select('id, userId, courseId, roleInCourse')
      .single();
    if (enrollErr) return new Response(JSON.stringify({ error: enrollErr.message }), { status: 500 });
    enrollmentRecord = insertedEnrollment || null;
    status = 'enrolled';
  }

  // Save turno/grupo to student profile submission
  if (turno || grupo) {
    const META_PREFIX = '__meta__:course-student-profile';
    const assignmentId = `${META_PREFIX}:${encodeURIComponent(canonicalCourse)}:${year}`;

    // Ensure meta assignment exists
    const { data: existingAssignment } = await supabase.from('Assignment').select('id').eq('id', assignmentId).maybeSingle();
    if (!existingAssignment) {
      const base = { id: assignmentId, courseId: canonicalCourse, slug: `${canonicalCourse}/__meta__/student-profile/${year}` };
      const r = await supabase.from('Assignment').insert([{ ...base, weight: 1 }]);
      if (r.error) await supabase.from('Assignment').insert([base]);
    }

    const { data: existingSub } = await supabase.from('Submission').select('id, attempts, payload').eq('userId', userId).eq('assignmentId', assignmentId).maybeSingle();
    const existingPayload = (existingSub?.payload && typeof existingSub.payload === 'object') ? existingSub.payload as Record<string, any> : {};

    const metaPayload = {
      __metaKind: 'course_student_profile',
      courseId: canonicalCourse, studentId: userId, year,
      turno: turno || normalizeTurno(existingPayload?.turno),
      grupo: grupo || normalizeGrupo(existingPayload?.grupo),
      concepto: existingPayload?.concepto ?? '',
      notes: existingPayload?.notes ?? '',
      notaFinal: existingPayload?.notaFinal ?? '',
      updatedAt: new Date().toISOString(),
      updatedBy: requester.id,
      updatedByEmail: cleanLower(currentUser.email),
    };

    if (existingSub?.id) {
      await supabase.from('Submission').update({ payload: metaPayload, attempts: (Number(existingSub.attempts) || 0) + 1, submittedAt: new Date().toISOString() }).eq('id', existingSub.id);
    } else {
      await supabase.from('Submission').insert([{ userId, assignmentId, payload: metaPayload, attempts: 1, submittedAt: new Date().toISOString() }]);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    userId,
    email: resolvedEmail,
    status,
    enrollment: enrollmentRecord,
  }), { status: 200 });
};
