import type { APIRoute } from 'astro';
import { canonicalizeCourseId } from '../../../lib/course-alias';
import { isAdminGlobalRole, isElevatedGlobalRole } from '../../../lib/roles';
import { resolveUserIdByEmail, registerEmailForUser } from '../../../lib/user-email';
import { query } from '../../../lib/db/pool';

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

    // Verify requester is a teacher
    const requesterEmail = normalizeText(currentUser.email).toLowerCase();
    const { data: requesterUsers } = await query(
      `SELECT "id", "role" FROM "User" WHERE "email" ILIKE $1`,
      [requesterEmail]
    );

    const requesterUser = (requesterUsers || [])[0];
    if (!requesterUser) {
      return new Response(JSON.stringify({ error: 'Requester not found' }), { status: 404 });
    }

    const canonicalCourse = await canonicalizeCourseId(courseId);
    if (!canonicalCourse) {
      return new Response(JSON.stringify({ error: 'Course not found' }), { status: 404 });
    }

    // Check that requester is a teacher in this course
    const { data: requesterEnrollments } = await query(
      `SELECT "courseId", "roleInCourse" FROM "Enrollment" WHERE "userId" = $1`,
      [requesterUser.id]
    );

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
    const { data: existingAssignmentRows } = await query(
      `SELECT "id" FROM "Assignment" WHERE "id" = $1`,
      [assignmentId]
    );
    const existingAssignment = existingAssignmentRows?.[0];

    if (!existingAssignment) {
      const base = { id: assignmentId, courseId: canonicalCourse, slug: `${canonicalCourse}/__meta__/student-profile/${year}` };
      const { error: insertError } = await query(
        `INSERT INTO "Assignment" ("id", "courseId", "slug", "weight") VALUES ($1, $2, $3, $4) ON CONFLICT ("id") DO NOTHING`,
        [base.id, base.courseId, base.slug, 1]
      );
      if (insertError) {
         // Maybe it was already inserted by a concurrent request, but ON CONFLICT should handle it
      }
    }

    let enrolled = 0;
    let alreadyEnrolled = 0;
    let errors = 0;

    for (const student of students as Array<{ name: string; email: string }>) {
      const email = normalizeText(student.email).toLowerCase();
      const name = normalizeText(student.name);
      if (!email || !email.includes('@')) continue;

      // Ensure User record exists (resolve via UserEmail first)
      const resolvedId = await resolveUserIdByEmail(email);

      let userId: string;

      if (!resolvedId) {
        const newId = crypto.randomUUID();
        const now = new Date();
        const { error: userInsertError } = await query(
          `INSERT INTO "User" ("id", "email", "name", "emailVerified", "role", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [newId, email, name || email, false, 'student', now, now]
        );
        if (userInsertError) {
          console.error('User insert error for', email, userInsertError.message);
          errors++;
          continue;
        }
        userId = newId;
        // Register email in UserEmail for multi-email identity
        await registerEmailForUser(userId, email, true).catch(() => undefined);
      } else {
        userId = resolvedId;
      }

      // Check if already enrolled
      const { data: existingEnrollmentRows } = await query(
        `SELECT "id" FROM "Enrollment" WHERE "userId" = $1 AND "courseId" = $2`,
        [userId, canonicalCourse]
      );
      const existingEnrollment = existingEnrollmentRows?.[0];

      if (existingEnrollment) {
        alreadyEnrolled++;
      } else {
        // Directly enroll the student
        const { error: enrollError } = await query(
          `INSERT INTO "Enrollment" ("userId", "courseId", "roleInCourse") VALUES ($1, $2, $3)`,
          [userId, canonicalCourse, 'student']
        );

        if (enrollError) {
          console.error('Enrollment insert error for', email, enrollError.message);
          errors++;
          continue;
        }
        enrolled++;
      }

      // Save turno to student profile submission
      const { data: existingSubRows } = await query(
        `SELECT "id", "attempts", "payload" FROM "Submission" WHERE "userId" = $1 AND "assignmentId" = $2`,
        [userId, assignmentId]
      );
      const existingSub = existingSubRows?.[0];

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
        await query(
          `UPDATE "Submission" SET "payload" = $1, "attempts" = $2, "submittedAt" = $3 WHERE "id" = $4`,
          [metaPayload, (Number(existingSub.attempts) || 0) + 1, new Date().toISOString(), existingSub.id]
        );
      } else {
        await query(
          `INSERT INTO "Submission" ("userId", "assignmentId", "payload", "attempts", "submittedAt") VALUES ($1, $2, $3, $4, $5)`,
          [userId, assignmentId, metaPayload, 1, new Date().toISOString()]
        );
      }
    }

    return new Response(JSON.stringify({ success: true, enrolled, alreadyEnrolled, errors }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

