import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../../lib/forum-server';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

const normalizeRole = (value: unknown) => {
  const role = String(value || '').trim().toLowerCase();
  return role === 'teacher' ? 'teacher' : role === 'student' ? 'student' : '';
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;
  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const targetUserId = String(params.id || '').trim();
  if (!targetUserId) {
    return json({ error: 'User id required' }, 400);
  }

  const payload = await request.json().catch(() => ({}));
  const nextRole = normalizeRole((payload as any)?.role);
  const nextName = typeof (payload as any)?.name === 'string' ? String((payload as any).name).trim() : null;
  const nextEmail = typeof (payload as any)?.email === 'string' ? String((payload as any).email).trim().toLowerCase() : null;

  if (!nextRole && !nextName && !nextEmail) {
    return json({ error: 'Nothing to update' }, 400);
  }

  const supabase = createSupabaseServerClient();

  try {
    const { data: requester, error: requesterError } = await supabase
      .from('User')
      .select('id, role')
      .eq('email', currentUser.email)
      .maybeSingle();

    if (requesterError) throw requesterError;
    if (!requester) return json({ error: 'Requester user not found' }, 404);

    if (normalizeRole(requester.role) !== 'teacher') {
      return json({ error: 'Only teachers can update user data' }, 403);
    }

    const { data: targetUser, error: targetUserError } = await supabase
      .from('User')
      .select('id, role, name, email')
      .eq('id', targetUserId)
      .maybeSingle();

    if (targetUserError) throw targetUserError;
    if (!targetUser) return json({ error: 'User not found' }, 404);

    const updateFields: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    // Handle name update
    if (nextName !== null) {
      updateFields.name = nextName;
    }

    // Handle email update
    if (nextEmail !== null) {
      if (!nextEmail.includes('@')) {
        return json({ error: 'Invalid email' }, 400);
      }
      // Check uniqueness (skip if same as current)
      if (nextEmail !== String(targetUser.email || '').toLowerCase()) {
        const { data: existingEmail } = await supabase
          .from('User')
          .select('id')
          .ilike('email', nextEmail)
          .neq('id', targetUserId)
          .maybeSingle();
        if (existingEmail) {
          return json({ error: 'Email already in use' }, 409);
        }
      }
      updateFields.email = nextEmail;
    }

    // Handle role update
    if (nextRole) {
      if (requester.id === targetUserId) {
        return json({ error: 'Cannot update your own role from this view' }, 400);
      }

      const currentRole = normalizeRole(targetUser.role);
      if (currentRole === 'teacher' && nextRole !== 'teacher') {
        const { count: otherTeachersCount, error: teacherCountError } = await supabase
          .from('User')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'teacher')
          .neq('id', targetUserId);

        if (teacherCountError) throw teacherCountError;
        if (!Number(otherTeachersCount || 0)) {
          return json({ error: 'At least one teacher account must remain' }, 400);
        }
      }
      updateFields.role = nextRole;
    }

    const { data: updatedUser, error: updateError } = await supabase
      .from('User')
      .update(updateFields)
      .eq('id', targetUserId)
      .select('id, name, email, role')
      .single();

    if (updateError) throw updateError;

    return json({
      success: true,
      user: updatedUser,
    });
  } catch (error: any) {
    console.error('Error updating user:', error?.message || error);
    return json({ error: error?.message || 'Failed to update user' }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, locals, request }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;
  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const targetUserId = String(params.id || '').trim();
  if (!targetUserId) {
    return json({ error: 'User id required' }, 400);
  }

  const supabase = createSupabaseServerClient();
  const requestUrl = new URL(request.url);
  const activeCourseId = String(requestUrl.searchParams.get('courseId') || '').trim();

  try {
    const { data: requester, error: requesterError } = await supabase
      .from('User')
      .select('id, role')
      .eq('email', currentUser.email)
      .maybeSingle();

    if (requesterError) throw requesterError;
    if (!requester) return json({ error: 'Requester user not found' }, 404);

    const requesterRole = normalizeRole(requester.role);
    if (requesterRole !== 'teacher') {
      return json({ error: 'Only teachers can delete users' }, 403);
    }

    if (requester.id === targetUserId) {
      return json({ error: 'Cannot delete current teacher account' }, 400);
    }

    const { data: targetUser, error: targetUserError } = await supabase
      .from('User')
      .select('id, role, name, email')
      .eq('id', targetUserId)
      .maybeSingle();

    if (targetUserError) throw targetUserError;
    if (!targetUser) return json({ error: 'User not found' }, 404);

    const targetRole = normalizeRole(targetUser.role);

    if (targetRole === 'teacher') {
      const { count: otherTeachersCount, error: teacherCountError } = await supabase
        .from('User')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'teacher')
        .neq('id', targetUserId);

      if (teacherCountError) throw teacherCountError;
      if (!Number(otherTeachersCount || 0)) {
        return json({ error: 'At least one teacher account must remain' }, 400);
      }
    }

    if (activeCourseId) {
      const { data: targetCourseEnrollment, error: targetEnrollmentError } = await supabase
        .from('Enrollment')
        .select('id, roleInCourse')
        .eq('courseId', activeCourseId)
        .eq('userId', targetUserId)
        .maybeSingle();

      if (targetEnrollmentError) throw targetEnrollmentError;

      if (normalizeRole(targetCourseEnrollment?.roleInCourse) === 'teacher') {
        const { count: otherCourseTeachersCount, error: otherCourseTeachersError } = await supabase
          .from('Enrollment')
          .select('id', { count: 'exact', head: true })
          .eq('courseId', activeCourseId)
          .eq('roleInCourse', 'teacher')
          .neq('userId', targetUserId);

        if (otherCourseTeachersError) throw otherCourseTeachersError;
        if (!Number(otherCourseTeachersCount || 0)) {
          return json({ error: 'At least one course teacher must remain in this course' }, 400);
        }
      }
    }

    const { error: submissionsDeleteError } = await supabase
      .from('Submission')
      .delete()
      .eq('userId', targetUserId);
    if (submissionsDeleteError) throw submissionsDeleteError;

    const { error: enrollmentsDeleteError } = await supabase
      .from('Enrollment')
      .delete()
      .eq('userId', targetUserId);
    if (enrollmentsDeleteError) throw enrollmentsDeleteError;

    const { error: userDeleteError } = await supabase
      .from('User')
      .delete()
      .eq('id', targetUserId);
    if (userDeleteError) throw userDeleteError;

    return json({ success: true }, 200);
  } catch (error: any) {
    console.error('Error deleting user:', error?.message || error);
    return json({ error: error?.message || 'Failed to delete user' }, 500);
  }
};
