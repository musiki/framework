import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

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
  if (!nextRole) {
    return json({ error: 'Invalid role' }, 400);
  }

  const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);

  try {
    const { data: requester, error: requesterError } = await supabase
      .from('User')
      .select('id, role')
      .eq('email', currentUser.email)
      .maybeSingle();

    if (requesterError) throw requesterError;
    if (!requester) return json({ error: 'Requester user not found' }, 404);

    if (normalizeRole(requester.role) !== 'teacher') {
      return json({ error: 'Only teachers can update roles' }, 403);
    }

    if (requester.id === targetUserId) {
      return json({ error: 'Cannot update your own role from this view' }, 400);
    }

    const { data: targetUser, error: targetUserError } = await supabase
      .from('User')
      .select('id, role, name, email')
      .eq('id', targetUserId)
      .maybeSingle();

    if (targetUserError) throw targetUserError;
    if (!targetUser) return json({ error: 'User not found' }, 404);

    const currentRole = normalizeRole(targetUser.role);
    if (!currentRole) {
      return json({ error: 'Target user has an unsupported role' }, 400);
    }

    if (currentRole === nextRole) {
      return json({
        success: true,
        user: {
          id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          role: currentRole,
        },
      });
    }

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

    const { data: updatedUser, error: updateError } = await supabase
      .from('User')
      .update({
        role: nextRole,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', targetUserId)
      .select('id, name, email, role')
      .single();

    if (updateError) throw updateError;

    return json({
      success: true,
      user: updatedUser,
    });
  } catch (error: any) {
    console.error('Error updating user role:', error?.message || error);
    return json({ error: error?.message || 'Failed to update user role' }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;
  if (!currentUser?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const targetUserId = String(params.id || '').trim();
  if (!targetUserId) {
    return json({ error: 'User id required' }, 400);
  }

  const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_KEY);

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
      .select('id')
      .eq('id', targetUserId)
      .maybeSingle();

    if (targetUserError) throw targetUserError;
    if (!targetUser) return json({ error: 'User not found' }, 404);

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
