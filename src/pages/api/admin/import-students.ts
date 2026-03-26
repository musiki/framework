import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { canonicalizeCourseId } from '../../../lib/course-alias';

const normalizeText = (value: unknown) => String(value || '').trim();
const normalizeRole = (value: unknown) => normalizeText(value).toLowerCase();

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { courseId, students } = await request.json();

    if (!courseId || !Array.isArray(students)) {
      return new Response(JSON.stringify({ error: 'Missing courseId or students' }), { status: 400 });
    }

    const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);

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

    const isTeacher =
      requesterUser.role === 'teacher' ||
      (requesterEnrollments || []).some((e: any) => normalizeRole(e.roleInCourse) === 'teacher');

    if (!isTeacher) {
      return new Response(JSON.stringify({ error: 'Only teachers can import students' }), { status: 403 });
    }

    let invited = 0;
    let alreadyInvited = 0;
    let alreadyEnrolled = 0;

    for (const student of students as Array<{ name: string; email: string }>) {
      const email = normalizeText(student.email).toLowerCase();
      const name = normalizeText(student.name);
      if (!email || !email.includes('@')) continue;

      // Ensure User record exists so they can log in and find their invite
      const { data: existingUsers } = await supabase
        .from('User')
        .select('id')
        .ilike('email', email);

      if (!existingUsers || existingUsers.length === 0) {
        await supabase.from('User').insert([{
          id: crypto.randomUUID(),
          email,
          name: name || email,
          emailVerified: false,
          role: 'student',
          createdAt: new Date(),
          updatedAt: new Date(),
        }]);
      }

      // If already fully enrolled, skip
      const userId = existingUsers?.[0]?.id;
      if (userId) {
        const { data: existingEnrollment } = await supabase
          .from('Enrollment')
          .select('id')
          .eq('userId', userId)
          .eq('courseId', canonicalCourse)
          .maybeSingle();

        if (existingEnrollment) {
          alreadyEnrolled++;
          continue;
        }
      }

      // Check if invite already exists
      const { data: existingInvite } = await supabase
        .from('CourseInvite')
        .select('id')
        .eq('courseId', canonicalCourse)
        .ilike('email', email)
        .maybeSingle();

      if (existingInvite) {
        alreadyInvited++;
        continue;
      }

      // Insert new invite
      const { error: insertError } = await supabase
        .from('CourseInvite')
        .insert([{ courseId: canonicalCourse, email, createdByUserId: requesterUser.id }]);

      if (!insertError) invited++;
    }

    return new Response(JSON.stringify({ success: true, invited, alreadyInvited, alreadyEnrolled }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
