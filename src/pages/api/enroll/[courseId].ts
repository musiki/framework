import type { APIRoute } from 'astro';
import { canonicalizeCourseId } from '../../../lib/course-alias';
import { createSupabaseServerClient, ensureDbUserFromSession } from '../../../lib/forum-server';
import { isElevatedGlobalRole } from '../../../lib/roles';
import { promoteUserToTeacherIfNeeded } from '../../../lib/user-role-sync';

export const POST: APIRoute = async ({ params, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const courseId = params.courseId;
  if (!courseId) {
    return new Response(JSON.stringify({ error: 'Course ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const normalizedCourseId = await canonicalizeCourseId(courseId) || String(courseId);
    const supabase = createSupabaseServerClient();
    const user = await ensureDbUserFromSession(supabase, session);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Could not create user record' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Teachers can always enroll themselves; students need a CourseInvite
    if (!isElevatedGlobalRole(user.role)) {
      const email = String(currentUser.email || '').trim().toLowerCase();
      const { data: invite } = await supabase
        .from('CourseInvite')
        .select('id')
        .eq('courseId', normalizedCourseId)
        .ilike('email', email)
        .maybeSingle();

      if (!invite) {
        return new Response(
          JSON.stringify({ error: 'No estás pre-registrado en este curso. Contactá al docente.' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // Check if already enrolled
    const { data: existing, error: existingError } = await supabase
      .from('Enrollment')
      .select('id')
      .eq('userId', user.id)
      .eq('courseId', normalizedCourseId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      return new Response(JSON.stringify({ message: 'Already enrolled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create enrollment
    const { error: insertError } = await supabase.from('Enrollment').insert([{
      userId: user.id,
      courseId: normalizedCourseId,
      roleInCourse: isElevatedGlobalRole(user.role) ? 'teacher' : 'student',
    }]);
    if (insertError) throw insertError;

    if (isElevatedGlobalRole(user.role)) {
      await promoteUserToTeacherIfNeeded(supabase, user.id);
    }

    return new Response(JSON.stringify({ success: true, message: 'Enrolled successfully' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Enrollment error:', error);
    return new Response(JSON.stringify({ error: 'Failed to enroll' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
