import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';
import { canonicalizeCourseId } from '../../lib/course-alias';
import { ensureDbUserFromSession } from '../../lib/forum-server';
import { isAdminGlobalRole, isElevatedGlobalRole } from '../../lib/roles';
import { promoteUserToTeacherIfNeeded } from '../../lib/user-role-sync';
import { query } from '../../lib/db/pool';

const normalizeText = (value: unknown) => String(value || '').trim();
const normalizeRole = (value: unknown) => normalizeText(value).toLowerCase();

const courseExistsInContent = async (courseId: string): Promise<boolean> => {
  const normalizedCourseId = normalizeText(courseId);
  if (!normalizedCourseId) return false;
  try {
    const courseEntry = await getEntry('cursos', `${normalizedCourseId}/_index`);
    return Boolean(courseEntry);
  } catch {
    return false;
  }
};

type SessionUserRow = {
  id?: string | null;
  role?: string | null;
  email?: string | null;
};

const resolveSessionUsers = async (email: string): Promise<SessionUserRow[]> => {
  const normalizedEmail = normalizeText(email).toLowerCase();
  if (!normalizedEmail) return [];

  const { data, error } = await query(
    `SELECT "id", "role", "email" FROM "User" WHERE "email" ILIKE $1`,
    [normalizedEmail]
  );

  if (error) throw error;
  return Array.isArray(data) ? (data as SessionUserRow[]) : [];
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.session as any;
  const currentUser = session?.user;

  if (!currentUser) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { courseId } = await request.json();
    const normalizedCourseId = await canonicalizeCourseId(courseId);
    if (!normalizedCourseId) {
      return new Response(JSON.stringify({ error: 'Missing courseId' }), { status: 400 });
    }

    const user = await ensureDbUserFromSession(session);
    if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });

    // Teachers can always enroll; students need a CourseInvite
    if (!isElevatedGlobalRole(user.role)) {
      const email = String(currentUser?.email || '').trim().toLowerCase();
      const { data: inviteRows } = await query(
        `SELECT "id" FROM "CourseInvite" WHERE "courseId" = $1 AND "email" ILIKE $2`,
        [normalizedCourseId, email]
      );
      const invite = inviteRows?.[0];

      if (!invite) {
        return new Response(
          JSON.stringify({ error: 'No estás pre-registrado en este curso. Contactá al docente.' }),
          { status: 403 },
        );
      }
    }

    // Check existing enrollment
    const { data: existingRows, error: existingError } = await query(
      `SELECT "id" FROM "Enrollment" WHERE "userId" = $1 AND "courseId" = $2`,
      [user.id, normalizedCourseId]
    );
    if (existingError) throw existingError;
    const existing = existingRows?.[0];

    if (existing) {
      return new Response(JSON.stringify({ message: 'Already enrolled' }), { status: 200 });
    }

    // Determine role for the course based on the user's global role
    const roleInCourse = isElevatedGlobalRole(user.role) ? 'teacher' : 'student';

    // Insert Enrollment
    const { error } = await query(
      `INSERT INTO "Enrollment" ("userId", "courseId", "roleInCourse") VALUES ($1, $2, $3)`,
      [user.id, normalizedCourseId, roleInCourse]
    );

    if (error) throw error;

    if (roleInCourse === 'teacher') {
      await promoteUserToTeacherIfNeeded(undefined, user.id);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const session = locals.session as any;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { enrollmentId } = await request.json();
    const normalizedEnrollmentId = normalizeText(enrollmentId);
    if (!normalizedEnrollmentId) {
      return new Response(JSON.stringify({ error: 'Missing enrollmentId' }), { status: 400 });
    }

    const users = await resolveSessionUsers(currentUser.email);
    const actingUserIds = Array.from(new Set(users.map((user) => normalizeText(user?.id)).filter(Boolean)));
    const actingIsAdmin = users.some((user) => isAdminGlobalRole(user?.role));
    if (actingUserIds.length === 0) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
    }

    const { data: targetEnrollmentRows, error: targetEnrollmentError } = await query(
      `SELECT "id", "userId", "courseId", "roleInCourse" FROM "Enrollment" WHERE "id" = $1`,
      [normalizedEnrollmentId]
    );

    if (targetEnrollmentError) throw targetEnrollmentError;
    const targetEnrollment = targetEnrollmentRows?.[0];
    if (!targetEnrollment) {
      return new Response(JSON.stringify({ error: 'Enrollment not found' }), { status: 404 });
    }

    const targetRole = normalizeRole(targetEnrollment.roleInCourse);
    const targetCourseId = await canonicalizeCourseId(targetEnrollment.courseId);
    const { data: teacherEnrollments, error: teacherEnrollmentsError } = await query(
      `SELECT "courseId", "roleInCourse", "userId" FROM "Enrollment" WHERE "userId" = ANY($1)`,
      [actingUserIds]
    );

    if (teacherEnrollmentsError) throw teacherEnrollmentsError;

    const manageableCourses = new Set<string>();
    for (const enrollment of teacherEnrollments || []) {
      if (normalizeRole(enrollment?.roleInCourse) !== 'teacher') continue;
      const canonicalCourseId = await canonicalizeCourseId(enrollment?.courseId);
      if (canonicalCourseId) manageableCourses.add(canonicalCourseId);
    }

    if (!targetCourseId || (!actingIsAdmin && !manageableCourses.has(targetCourseId))) {
      return new Response(JSON.stringify({ error: 'You can only manage enrollments in your own courses' }), { status: 403 });
    }

    if (targetRole === 'teacher') {
      const isOwnTeacherEnrollment = actingUserIds.includes(normalizeText(targetEnrollment.userId));
      if (!actingIsAdmin && !isOwnTeacherEnrollment) {
        return new Response(JSON.stringify({ error: 'You can only remove your own teacher enrollment' }), { status: 403 });
      }

      const targetCourseExists = await courseExistsInContent(targetCourseId);
      if (!actingIsAdmin && targetCourseExists) {
        const { data: courseEnrollments, error: courseEnrollmentsError } = await query(
          `SELECT "id", "courseId", "roleInCourse" FROM "Enrollment" WHERE "courseId" = $1`,
          [targetCourseId]
        );

        if (courseEnrollmentsError) throw courseEnrollmentsError;

        let teacherCount = 0;
        for (const enrollment of courseEnrollments || []) {
          if (normalizeRole(enrollment?.roleInCourse) !== 'teacher') continue;
          const enrollmentCourseId = await canonicalizeCourseId(enrollment?.courseId);
          if (enrollmentCourseId === targetCourseId) {
            teacherCount += 1;
          }
        }

        if (teacherCount <= 1) {
          return new Response(JSON.stringify({ error: 'Cannot remove the last teacher enrollment in this course' }), { status: 403 });
        }
      }
    } else if (targetRole !== 'student') {
      return new Response(JSON.stringify({ error: 'Unsupported enrollment role' }), { status: 403 });
    }

    const { error: deleteError } = await query(
      `DELETE FROM "Enrollment" WHERE "id" = $1`,
      [normalizedEnrollmentId]
    );

    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const session = locals.session as any;
  const currentUser = session?.user;

  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { enrollmentId, roleInCourse } = await request.json();
    const normalizedEnrollmentId = normalizeText(enrollmentId);
    const normalizedNextRole = normalizeRole(roleInCourse);
    if (!normalizedEnrollmentId) {
      return new Response(JSON.stringify({ error: 'Missing enrollmentId' }), { status: 400 });
    }
    if (!['student', 'teacher'].includes(normalizedNextRole)) {
      return new Response(JSON.stringify({ error: 'Unsupported roleInCourse' }), { status: 400 });
    }

    const users = await resolveSessionUsers(currentUser.email);
    const actingUserIds = Array.from(new Set(users.map((user) => normalizeText(user?.id)).filter(Boolean)));
    const actingIsAdmin = users.some((user) => isAdminGlobalRole(user?.role));
    if (actingUserIds.length === 0) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
    }

    const { data: targetEnrollmentRows, error: targetEnrollmentError } = await query(
      `SELECT "id", "userId", "courseId", "roleInCourse" FROM "Enrollment" WHERE "id" = $1`,
      [normalizedEnrollmentId]
    );

    if (targetEnrollmentError) throw targetEnrollmentError;
    const targetEnrollment = targetEnrollmentRows?.[0];
    if (!targetEnrollment) {
      return new Response(JSON.stringify({ error: 'Enrollment not found' }), { status: 404 });
    }

    const targetCourseId = await canonicalizeCourseId(targetEnrollment.courseId);
    const currentRole = normalizeRole(targetEnrollment.roleInCourse);
    if (!targetCourseId) {
      return new Response(JSON.stringify({ error: 'Course not found for enrollment' }), { status: 404 });
    }

    const { data: actingEnrollments, error: actingEnrollmentsError } = await query(
      `SELECT "courseId", "roleInCourse", "userId" FROM "Enrollment" WHERE "userId" = ANY($1)`,
      [actingUserIds]
    );

    if (actingEnrollmentsError) throw actingEnrollmentsError;

    const manageableCourses = new Set<string>();
    for (const enrollment of actingEnrollments || []) {
      if (normalizeRole(enrollment?.roleInCourse) !== 'teacher') continue;
      const canonicalCourseId = await canonicalizeCourseId(enrollment?.courseId);
      if (canonicalCourseId) manageableCourses.add(canonicalCourseId);
    }

    if (!actingIsAdmin && !manageableCourses.has(targetCourseId)) {
      return new Response(JSON.stringify({ error: 'You can only manage roles in your own courses' }), { status: 403 });
    }

    if (currentRole === normalizedNextRole) {
      return new Response(JSON.stringify({ success: true, enrollment: targetEnrollment }), { status: 200 });
    }

    if (!actingIsAdmin && currentRole === 'teacher' && normalizedNextRole === 'student') {
      const targetCourseExists = await courseExistsInContent(targetCourseId);
      if (targetCourseExists) {
        const { data: courseEnrollments, error: courseEnrollmentsError } = await query(
          `SELECT "id", "courseId", "roleInCourse" FROM "Enrollment" WHERE "courseId" = $1`,
          [targetCourseId]
        );

        if (courseEnrollmentsError) throw courseEnrollmentsError;

        let teacherCount = 0;
        for (const enrollment of courseEnrollments || []) {
          if (normalizeRole(enrollment?.roleInCourse) !== 'teacher') continue;
          const enrollmentCourseId = await canonicalizeCourseId(enrollment?.courseId);
          if (enrollmentCourseId === targetCourseId) {
            teacherCount += 1;
          }
        }

        if (teacherCount <= 1) {
          return new Response(JSON.stringify({ error: 'Cannot demote the last teacher in this course' }), { status: 403 });
        }
      }
    }

    const { data: updatedEnrollmentRows, error: updateError } = await query(
      `UPDATE "Enrollment" SET "roleInCourse" = $1 WHERE "id" = $2 RETURNING "id", "userId", "courseId", "roleInCourse"`,
      [normalizedNextRole, normalizedEnrollmentId]
    );
    const updatedEnrollment = updatedEnrollmentRows?.[0];

    if (updateError) throw updateError;

    if (normalizedNextRole === 'teacher') {
      await promoteUserToTeacherIfNeeded(undefined, normalizeText(updatedEnrollment?.userId || targetEnrollment.userId));
    }

    return new Response(JSON.stringify({ success: true, enrollment: updatedEnrollment }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

