import type { APIRoute } from 'astro';
import { canonicalizeCourseId } from '../../../lib/course-alias';
import { ensureDbUserFromSession } from '../../../lib/forum-server';
import { isElevatedGlobalRole } from '../../../lib/roles';
import { hasTeacherEnrollment, promoteUserToTeacherIfNeeded } from '../../../lib/user-role-sync';
import { query } from '../../../lib/db/pool';

const normalizeRole = (value: unknown) => String(value || '').trim().toLowerCase();

export const POST: APIRoute = async ({ params, request, locals }) => {
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
    const body = await request.json().catch(() => ({}));
    const requestedRole = normalizeRole(body?.roleInCourse || '');
    const normalizedCourseId = await canonicalizeCourseId(courseId) || String(courseId);
    const user = await ensureDbUserFromSession(session);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Could not create user record' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isTeacher = isElevatedGlobalRole(user.role) || await hasTeacherEnrollment(user.id);

    // Teachers can always enroll themselves; students need a CourseInvite
    if (!isTeacher) {
      const email = String(currentUser.email || '').trim().toLowerCase();
      const { data: inviteRows } = await query(
        `SELECT "id" FROM "CourseInvite" WHERE "courseId" = $1 AND "email" ILIKE $2`,
        [normalizedCourseId, email]
      );
      const invite = inviteRows?.[0];

      if (!invite) {
        return new Response(
          JSON.stringify({ error: 'No estás pre-registrado en este curso. Contactá al docente.' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // Check if already enrolled
    const { data: existingRows, error: existingError } = await query(
      `SELECT "id" FROM "Enrollment" WHERE "userId" = $1 AND "courseId" = $2`,
      [user.id, normalizedCourseId]
    );
    const existing = existingRows?.[0];

    if (existingError) throw existingError;

    if (existing) {
      return new Response(JSON.stringify({ message: 'Already enrolled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const roleInCourse = isTeacher
      ? (['student', 'teacher'].includes(requestedRole) ? requestedRole : 'teacher')
      : 'student';

    // Create enrollment
    const { error: insertError } = await query(
      `INSERT INTO "Enrollment" ("userId", "courseId", "roleInCourse") VALUES ($1, $2, $3)`,
      [user.id, normalizedCourseId, roleInCourse]
    );
    if (insertError) throw insertError;

    if (isTeacher || roleInCourse === 'teacher') {
      await promoteUserToTeacherIfNeeded(user.id);
    }

    return new Response(JSON.stringify({ success: true, message: 'Enrolled successfully', roleInCourse }), {
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

