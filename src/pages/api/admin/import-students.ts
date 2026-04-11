import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/forum-server';
import { canonicalizeCourseId } from '../../../lib/course-alias';
import { isAdminGlobalRole, isElevatedGlobalRole } from '../../../lib/roles';
import { resolveUserIdByEmail, registerEmailForUser } from '../../../lib/user-email';

const normalizeText = (value: unknown) => String(value || '').trim();
const normalizeRole = (value: unknown) => normalizeText(value).toLowerCase();
const normalizeTurno = (v: unknown) => {
  const u = normalizeText(v).toUpperCase();
  return (['M', 'T', 'N'] as const).includes(u as 'M' | 'T' | 'N') ? (u as 'M' | 'T' | 'N') : 'M';
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { courseId, students, turno: rawTurno } = await request.json();

    if (!courseId || !Array.isArray(students)) {
      return new Response(JSON.stringify({ error: 'Missing courseId or students' }), { status: 400 });
    }

    const turno = normalizeTurno(rawTurno);
    const year = String(new Date().getFullYear());
    const supabase = createSupabaseServerClient();

    // Verify requester is a teacher
    const requesterEmail = normalizeText(currentUser.email).toLowerCase();
    const { data: requesterUsers } = await supabase
      .from('User')
      .select('id, role')
      .ilike('email', requesterEmail);

    const requesterUser = (requesterUsers || [])[0];
    if (!requesterUser) {
      return new Response(JSON.stringify({ error: 'Requester not found' }), { status: 404 });
    }

    const canonicalCourse = await canonicalizeCourseId(courseId);
    if (!canonicalCourse) {
      return new Response(JSON.stringify({ error: 'Course not found' }), { status: 404 });
    }

    // Check that requester is a teacher in this course
    const { data: requesterEnrollments } = await supabase
      .from('Enrollment')
      .select('courseId, roleInCourse')
      .eq('userId', requesterUser.id);

    const isAdmin = isAdminGlobalRole(requesterUser.role);
    const isTeacher =
      isElevatedGlobalRole(requesterUser.role) ||
      (requesterEnrollments || []).some((e: any) => normalizeRole(e.roleInCourse) === 'teacher');

    if (!isTeacher) {
      return new Response(JSON.stringify({ error: 'Only teachers can import students' }), { status: 403 });
    }

    if (!isAdmin) {
      const manageableCourses = new Set(
        await Promise.all(
          (requesterEnrollments || [])
            .filter((e: any) => normalizeRole(e.roleInCourse) === 'teacher')
            .map((e: any) => canonicalizeCourseId(e.courseId)),
        ),
      );
      manageableCourses.delete('');
      if (!manageableCourses.has(canonicalCourse)) {
        return new Response(JSON.stringify({ error: 'You can only import students into your own courses' }), { status: 403 });
      }
    }

    // Ensure the meta assignment exists (shared across all students in this course/year)
    const META_PREFIX = '__meta__:course-student-profile';
    const assignmentId = `${META_PREFIX}:${encodeURIComponent(canonicalCourse)}:${year}`;
    const { data: existingAssignment } = await supabase.from('Assignment').select('id').eq('id', assignmentId).maybeSingle();
    if (!existingAssignment) {
      const base = { id: assignmentId, courseId: canonicalCourse, slug: `${canonicalCourse}/__meta__/student-profile/${year}` };
      const r = await supabase.from('Assignment').insert([{ ...base, weight: 1 }]);
      if (r.error) await supabase.from('Assignment').insert([base]);
    }

    let enrolled = 0;
    let alreadyEnrolled = 0;
    let errors = 0;

    for (const student of students as Array<{ name: string; email: string }>) {
      const email = normalizeText(student.email).toLowerCase();
      const name = normalizeText(student.name);
      if (!email || !email.includes('@')) continue;

      // Ensure User record exists (resolve via UserEmail first)
      const resolvedId = await resolveUserIdByEmail(supabase, email);

      let userId: string;

      if (!resolvedId) {
        const newId = crypto.randomUUID();
        const { error: userInsertError } = await supabase.from('User').insert([{
          id: newId,
          email,
          name: name || email,
          emailVerified: false,
          role: 'student',
          createdAt: new Date(),
          updatedAt: new Date(),
        }]);
        if (userInsertError) {
          console.error('User insert error for', email, userInsertError.message);
          errors++;
          continue;
        }
        userId = newId;
        // Register email in UserEmail for multi-email identity
        await registerEmailForUser(supabase, userId, email, true).catch(() => undefined);
      } else {
        userId = resolvedId;
      }

      // Check if already enrolled
      const { data: existingEnrollment } = await supabase
        .from('Enrollment')
        .select('id')
        .eq('userId', userId)
        .eq('courseId', canonicalCourse)
        .maybeSingle();

      if (existingEnrollment) {
        alreadyEnrolled++;
      } else {
        // Directly enroll the student
        const { error: enrollError } = await supabase
          .from('Enrollment')
          .insert([{ userId, courseId: canonicalCourse, roleInCourse: 'student' }]);

        if (enrollError) {
          console.error('Enrollment insert error for', email, enrollError.message);
          errors++;
          continue;
        }
        enrolled++;
      }

      // Save turno to student profile submission
      const { data: existingSub } = await supabase
        .from('Submission')
        .select('id, attempts, payload')
        .eq('userId', userId)
        .eq('assignmentId', assignmentId)
        .maybeSingle();

      const existingPayload = (existingSub?.payload && typeof existingSub.payload === 'object')
        ? existingSub.payload as Record<string, any>
        : {};

      const metaPayload = {
        __metaKind: 'course_student_profile',
        courseId: canonicalCourse,
        studentId: userId,
        year,
        turno,
        grupo: existingPayload?.grupo ?? '',
        concepto: existingPayload?.concepto ?? '',
        notes: existingPayload?.notes ?? '',
        notaFinal: existingPayload?.notaFinal ?? '',
        updatedAt: new Date().toISOString(),
        updatedBy: requesterUser.id,
        updatedByEmail: requesterEmail,
      };

      if (existingSub?.id) {
        await supabase.from('Submission').update({
          payload: metaPayload,
          attempts: (Number(existingSub.attempts) || 0) + 1,
          submittedAt: new Date().toISOString(),
        }).eq('id', existingSub.id);
      } else {
        await supabase.from('Submission').insert([{
          userId,
          assignmentId,
          payload: metaPayload,
          attempts: 1,
          submittedAt: new Date().toISOString(),
        }]);
      }
    }

    return new Response(JSON.stringify({ success: true, enrolled, alreadyEnrolled, errors }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
