import type { APIRoute } from 'astro';
import { resolveLiveManageAccess } from '../../../../lib/live/access';
import { isElevatedGlobalRole, normalizeGlobalRole } from '../../../../lib/roles';
import { resolveUserIdByEmail } from '../../../../lib/user-email';
import { query } from '../../../../lib/db/pool';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

const normalizeRole = (value: unknown) => {
  return normalizeGlobalRole(value);
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
  const courseId = String((payload as any)?.courseId || '').trim();

  if (!nextRole && !nextName && !nextEmail) {
    return json({ error: 'Nothing to update' }, 400);
  }

  try {
    // Use enrollment-based access check (same as course-student-meta) when courseId is provided,
    // otherwise fall back to global role check with case-insensitive email lookup.
    let canEdit = false;
    let requesterId = '';
    if (courseId) {
      const access = await resolveLiveManageAccess(session, courseId);
      canEdit = access.canManage;
      requesterId = access.userId;
    } else {
      const normalizedEmail = String(currentUser.email || '').toLowerCase().trim();
      const resolvedId = await resolveUserIdByEmail(undefined, normalizedEmail).catch(() => null);
      const { data: requesterUserRows } = resolvedId
        ? await query(`SELECT "id", "role" FROM "User" WHERE "id" = $1`, [resolvedId])
        : await query(`SELECT "id", "role" FROM "User" WHERE "email" ILIKE $1`, [normalizedEmail]);
      const requesterUser = requesterUserRows?.[0];
      canEdit = Boolean(requesterUser && isElevatedGlobalRole(requesterUser.role));
      requesterId = String(requesterUser?.id || '');
    }

    if (!canEdit) {
      return json({ error: 'Only teachers or admins can update user data' }, 403);
    }

    const { data: targetUserRows, error: targetUserError } = await query(
      `SELECT "id", "role", "name", "email" FROM "User" WHERE "id" = $1`,
      [targetUserId]
    );

    if (targetUserError) throw targetUserError;
    const targetUser = targetUserRows?.[0];
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
        const { data: existingEmailRows } = await query(
          `SELECT "id" FROM "User" WHERE "email" ILIKE $1 AND "id" <> $2`,
          [nextEmail, targetUserId]
        );
        const existingEmail = existingEmailRows?.[0];
        if (existingEmail) {
          return json({ error: 'Email already in use' }, 409);
        }
      }
      updateFields.email = nextEmail;
    }

    // Handle role update
    if (nextRole) {
      const currentRole = normalizeRole(targetUser.role);
      const isSelfRoleChange = requesterId && requesterId === targetUserId;
      if (
        isSelfRoleChange
        && !(isElevatedGlobalRole(currentRole) && isElevatedGlobalRole(nextRole))
      ) {
        return json({ error: 'Cannot update your own role from this view' }, 400);
      }

      if (isElevatedGlobalRole(currentRole) && nextRole === 'student') {
        const { data: elevatedUsers, error: elevatedUsersError } = await query(
          `SELECT "id", "role" FROM "User" WHERE "id" <> $1`,
          [targetUserId]
        );

        if (elevatedUsersError) throw elevatedUsersError;
        const otherElevatedCount = (elevatedUsers || []).filter((row: any) => isElevatedGlobalRole(row?.role)).length;
        if (!otherElevatedCount) {
          return json({ error: 'At least one teacher or admin account must remain' }, 400);
        }
      }
      updateFields.role = nextRole;
    }

    const cols = Object.keys(updateFields);
    const vals = Object.values(updateFields);
    const setSql = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    const { data: updatedUserRows, error: updateError } = await query(
      `UPDATE "User" SET ${setSql} WHERE "id" = $${cols.length + 1} RETURNING "id", "name", "email", "role"`,
      [...vals, targetUserId]
    );
    const updatedUser = updatedUserRows?.[0];

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

  const requestUrl = new URL(request.url);
  const activeCourseId = String(requestUrl.searchParams.get('courseId') || '').trim();

  try {
    const normalizedRequesterEmail = String(currentUser.email || '').toLowerCase().trim();
    const resolvedRequesterId = await resolveUserIdByEmail(undefined, normalizedRequesterEmail).catch(() => null);
    const { data: requesterRows } = resolvedRequesterId
      ? await query(`SELECT "id", "role" FROM "User" WHERE "id" = $1`, [resolvedRequesterId])
      : await query(`SELECT "id", "role" FROM "User" WHERE "email" ILIKE $1`, [normalizedRequesterEmail]);
    
    const requester = (requesterRows || []).find((row: any) => isElevatedGlobalRole(row?.role)) || (requesterRows || [])[0];

    if (!requester) return json({ error: 'Requester user not found' }, 404);

    const requesterRole = normalizeRole(requester.role);
    const requesterIsAdmin = requesterRole === 'admin';
    if (!isElevatedGlobalRole(requesterRole)) {
      return json({ error: 'Only teachers or admins can delete users' }, 403);
    }

    if (requester.id === targetUserId) {
      return json({ error: 'Cannot delete current elevated account' }, 400);
    }

    const { data: targetUserRows, error: targetUserError } = await query(
      `SELECT "id", "role", "name", "email" FROM "User" WHERE "id" = $1`,
      [targetUserId]
    );

    if (targetUserError) throw targetUserError;
    const targetUser = targetUserRows?.[0];
    if (!targetUser) return json({ error: 'User not found' }, 404);

    const targetRole = normalizeRole(targetUser.role);

    if (isElevatedGlobalRole(targetRole)) {
      const { data: otherElevatedUsers, error: elevatedUsersError } = await query(
        `SELECT "id", "role" FROM "User" WHERE "id" <> $1`,
        [targetUserId]
      );

      if (elevatedUsersError) throw elevatedUsersError;
      const otherElevatedCount = (otherElevatedUsers || []).filter((row: any) => isElevatedGlobalRole(row?.role)).length;
      if (!otherElevatedCount) {
        return json({ error: 'At least one teacher or admin account must remain' }, 400);
      }
    }

    if (activeCourseId) {
      const { data: targetCourseEnrollmentRows, error: targetEnrollmentError } = await query(
        `SELECT "id", "roleInCourse" FROM "Enrollment" WHERE "courseId" = $1 AND "userId" = $2`,
        [activeCourseId, targetUserId]
      );
      const targetCourseEnrollment = targetCourseEnrollmentRows?.[0];

      if (targetEnrollmentError) throw targetEnrollmentError;

      if (!requesterIsAdmin && normalizeRole(targetCourseEnrollment?.roleInCourse) === 'teacher') {
        const { count: otherCourseTeachersCount, error: otherCourseTeachersError } = await query(
          `SELECT COUNT(*) as count FROM "Enrollment" WHERE "courseId" = $1 AND "roleInCourse" = $2 AND "userId" <> $3`,
          [activeCourseId, 'teacher', targetUserId]
        );

        if (otherCourseTeachersError) throw otherCourseTeachersError;
        if (!Number(otherCourseTeachersCount || 0)) {
          return json({ error: 'At least one course teacher must remain in this course' }, 400);
        }
      }
    }

    const { error: submissionsDeleteError } = await query(
      `DELETE FROM "Submission" WHERE "userId" = $1`,
      [targetUserId]
    );
    if (submissionsDeleteError) throw submissionsDeleteError;

    const { error: enrollmentsDeleteError } = await query(
      `DELETE FROM "Enrollment" WHERE "userId" = $1`,
      [targetUserId]
    );
    if (enrollmentsDeleteError) throw enrollmentsDeleteError;

    const { error: userDeleteError } = await query(
      `DELETE FROM "User" WHERE "id" = $1`,
      [targetUserId]
    );
    if (userDeleteError) throw userDeleteError;

    return json({ success: true }, 200);
  } catch (error: any) {
    console.error('Error deleting user:', error?.message || error);
    return json({ error: error?.message || 'Failed to delete user' }, 500);
  }
};

