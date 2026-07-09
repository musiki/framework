import type { APIRoute } from 'astro';
import { canonicalizeCourseId } from '../../../lib/course-alias';
import { isAdminGlobalRole, isElevatedGlobalRole } from '../../../lib/roles';
import { query } from '../../../lib/db/pool';
import { registerEmailForUser } from '../../../lib/user-email';


const clean = (v: unknown) => String(v || '').trim();
const cleanLower = (v: unknown) => clean(v).toLowerCase();

const normalizeTurno = (v: unknown) => {
  const u = clean(v).toUpperCase();
  return ['M', 'T', 'N'].includes(u) ? u : 'M';
};

const normalizeGrupo = (v: unknown) => {
  const raw = clean(v);
  if (!raw) return '';
  if (raw.toUpperCase() === 'X') return 'X';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  return String(Math.min(99, Math.max(0, Math.trunc(n)))).padStart(2, '0');
};

const normalizeYear = (v: unknown) => {
  const raw = clean(v);
  return /^\d{4}$/.test(raw) ? raw : String(new Date().getFullYear());
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;
  if (!currentUser?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const courseId = clean(body?.courseId);
  const year = normalizeYear(body?.year);
  const requestedUserId = clean(body?.userId);
  const firstName = clean(body?.firstName);
  const lastName = clean(body?.lastName);
  const email = cleanLower(body?.email);
  const turno = normalizeTurno(body?.turno);
  const grupo = normalizeGrupo(body?.grupo);

  if (!courseId) {
    return new Response(JSON.stringify({ error: 'courseId is required' }), { status: 400 });
  }

  if (!requestedUserId && (!email || !email.includes('@'))) {
    return new Response(JSON.stringify({ error: 'userId or valid email is required' }), { status: 400 });
  }

  // Verify requester is a teacher and owns the course.
  const { data: actingUsers } = await query(
    `SELECT "id", "role" FROM "User" WHERE "email" ILIKE $1`,
    [cleanLower(currentUser.email)]
  );
  const requester = (actingUsers || [])[0];
  if (!requester || !Array.isArray(actingUsers) || actingUsers.length === 0) {
    return new Response(JSON.stringify({ error: 'Requester not found' }), { status: 404 });
  }

  const actingUserIds = actingUsers
    .map((user: any) => clean(user?.id))
    .filter(Boolean);

  const { data: requesterEnrollments } = await query(
    `SELECT "courseId", "roleInCourse", "userId" FROM "Enrollment" WHERE "userId" = ANY($1)`,
    [actingUserIds]
  );
  const isAdmin =
    (actingUsers || []).some((user: any) => isAdminGlobalRole(user?.role));
  const isTeacher =
    (actingUsers || []).some((user: any) => isElevatedGlobalRole(user?.role))
    || (requesterEnrollments || []).some((e: any) => cleanLower(e?.roleInCourse) === 'teacher');
  if (!isTeacher) return new Response(JSON.stringify({ error: 'Only teachers can add students' }), { status: 403 });

  const canonicalCourse = await canonicalizeCourseId(courseId);
  if (!canonicalCourse) return new Response(JSON.stringify({ error: 'Course not found' }), { status: 404 });

  const manageableCourses = new Set<string>();
  for (const enrollment of requesterEnrollments || []) {
    if (cleanLower(enrollment?.roleInCourse) !== 'teacher') continue;
    const managedCourseId = await canonicalizeCourseId(enrollment?.courseId);
    if (managedCourseId) manageableCourses.add(managedCourseId);
  }

  if (!isAdmin && !manageableCourses.has(canonicalCourse)) {
    return new Response(JSON.stringify({ error: 'You can only add students to your own courses' }), { status: 403 });
  }

  // Find or create user
  let userId: string;
  let resolvedEmail = email;

  if (requestedUserId) {
    const { data: existingUserByIdRows, error: existingUserByIdError } = await query(
      `SELECT "id", "email" FROM "User" WHERE "id" = $1`,
      [requestedUserId]
    );
    const existingUserById = existingUserByIdRows?.[0];
    if (existingUserByIdError) {
      return new Response(JSON.stringify({ error: existingUserByIdError.message }), { status: 500 });
    }
    if (!existingUserById) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
    }
    userId = existingUserById.id;
    resolvedEmail = cleanLower(existingUserById.email);
  } else {
    const { data: existingUsers } = await query(
      `SELECT "id", "email" FROM "User" WHERE "email" ILIKE $1`,
      [email]
    );
    if (existingUsers && existingUsers.length > 0) {
      userId = existingUsers[0].id;
      resolvedEmail = cleanLower(existingUsers[0].email);
    } else {
      const name = [lastName, firstName].filter(Boolean).join(', ') || email;
      const newId = crypto.randomUUID();
      const now = new Date();
      const { error: insertErr } = await query(
        `INSERT INTO "User" ("id", "email", "name", "emailVerified", "role", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newId, email, name, false, 'student', now, now]
      );
      if (insertErr) return new Response(JSON.stringify({ error: insertErr.message }), { status: 500 });
      userId = newId;
      await registerEmailForUser(userId, email, true).catch(() => undefined);
    }
  }

  // Check existing enrollment
  const { data: existingEnrollmentRows } = await query(
    `SELECT "id", "userId", "courseId", "roleInCourse" FROM "Enrollment" WHERE "userId" = $1 AND "courseId" = $2`,
    [userId, canonicalCourse]
  );
  const existingEnrollment = existingEnrollmentRows?.[0];
  let status: string;
  let enrollmentRecord = existingEnrollment || null;

  if (existingEnrollment) {
    status = 'already_enrolled';
  } else {
    const { data: insertedEnrollmentRows, error: enrollErr } = await query(
      `INSERT INTO "Enrollment" ("userId", "courseId", "roleInCourse") VALUES ($1, $2, $3) RETURNING "id", "userId", "courseId", "roleInCourse"`,
      [userId, canonicalCourse, 'student']
    );
    const insertedEnrollment = insertedEnrollmentRows?.[0];
    if (enrollErr) return new Response(JSON.stringify({ error: enrollErr.message }), { status: 500 });
    enrollmentRecord = insertedEnrollment || null;
    status = 'enrolled';
  }

  // Save turno/grupo to student profile submission
  if (turno || grupo) {
    const META_PREFIX = '__meta__:course-student-profile';
    const assignmentId = `${META_PREFIX}:${encodeURIComponent(canonicalCourse)}:${year}`;

    // Ensure meta assignment exists
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
    }

    const { data: existingSubRows } = await query(
      `SELECT "id", "attempts", "payload" FROM "Submission" WHERE "userId" = $1 AND "assignmentId" = $2`,
      [userId, assignmentId]
    );
    const existingSub = existingSubRows?.[0];
    const existingPayload = (existingSub?.payload && typeof existingSub.payload === 'object') ? existingSub.payload as Record<string, any> : {};

    const metaPayload = {
      __metaKind: 'course_student_profile',
      courseId: canonicalCourse, studentId: userId, year,
      turno: turno || normalizeTurno(existingPayload?.turno),
      grupo: grupo || normalizeGrupo(existingPayload?.grupo),
      concepto: existingPayload?.concepto ?? '',
      notes: existingPayload?.notes ?? '',
      notaFinal: existingPayload?.notaFinal ?? '',
      updatedAt: new Date().toISOString(),
      updatedBy: requester.id,
      updatedByEmail: cleanLower(currentUser.email),
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

  return new Response(JSON.stringify({
    success: true,
    userId,
    email: resolvedEmail,
    status,
    enrollment: enrollmentRecord,
  }), { status: 200 });
};

