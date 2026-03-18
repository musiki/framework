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
      (requesterEnrollments || []).some((e: any) => {
        return normalizeRole(e.roleInCourse) === 'teacher';
      });

    if (!isTeacher) {
      return new Response(JSON.stringify({ error: 'Only teachers can import students' }), { status: 403 });
    }

    let imported = 0;
    let alreadyEnrolled = 0;

    for (const student of students as Array<{ name: string; email: string }>) {
      const email = normalizeText(student.email).toLowerCase();
      const name = normalizeText(student.name);
      if (!email || !email.includes('@')) continue;

      // Find or create user
      const { data: existingUsers } = await supabase
        .from('User')
        .select('id')
        .ilike('email', email);

      let userId: string;

      if (!existingUsers || existingUsers.length === 0) {
        const { data: newUser, error: createError } = await supabase
          .from('User')
          .insert([{
            id: crypto.randomUUID(),
            email,
            name: name || email,
            emailVerified: false,
            role: 'student',
            createdAt: new Date(),
            updatedAt: new Date(),
          }])
          .select('id')
          .single();

        if (createError || !newUser) continue;
        userId = newUser.id;
      } else {
        userId = existingUsers[0].id;
      }

      // Check existing enrollment
      const { data: existing } = await supabase
        .from('Enrollment')
        .select('id')
        .eq('userId', userId)
        .eq('courseId', canonicalCourse)
        .maybeSingle();

      if (existing) {
        alreadyEnrolled++;
        continue;
      }

      // Create enrollment
      const { error: enrollError } = await supabase
        .from('Enrollment')
        .insert([{
          userId,
          courseId: canonicalCourse,
          roleInCourse: 'student',
        }]);

      if (!enrollError) imported++;
    }

    return new Response(JSON.stringify({ success: true, imported, alreadyEnrolled }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
