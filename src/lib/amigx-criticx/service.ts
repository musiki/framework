import { getClient, query } from '../db/pool';
import { getCourseAliases } from '../course-alias';
import { isElevatedGlobalRole } from '../roles';
import { ensureAmigxCriticxSchema } from './schema';
import {
  canViewReview,
  computeUrnCandidates,
  isExcludedStudentGroup,
  validatePairSelection,
  type AmigxCriticxPair,
  type AmigxCriticxReviewRecord,
  type StudentCandidate,
} from './logic';

interface DbEnrollmentStudentRow {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  roleInCourse: string | null;
}

interface DbReviewRow {
  id: string;
  courseId: string;
  authorUserId: string;
  authorName: string | null;
  authorEmail: string | null;
  recipientUserId: string;
  recipientName: string | null;
  recipientEmail: string | null;
  descripcion: string | null;
  funcionaNoFunciona: string | null;
  hariaDistinto: string | null;
  recipientResponse: string | null;
  recipientRespondedAt: string | Date | null;
  isPublic: boolean | null;
  status: string | null;
  submittedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface AmigxCriticxPortalState {
  courseId: string;
  currentUser: {
    id: string;
    name: string;
    email: string | null;
    isTeacher: boolean;
  };
  urnCandidates: StudentCandidate[];
  allActiveStudents: StudentCandidate[];
  myOutboundReview: AmigxCriticxReviewRecord | null;
  myInboundReview: AmigxCriticxReviewRecord | null;
  visibleReviews: AmigxCriticxReviewRecord[];
  urnStats: {
    totalStudents: number;
    assignedCount: number;
    submittedCount: number;
    availableCount: number;
  };
}

function toIsoOrNull(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  const str = String(val).trim();
  return str || null;
}

function formatDisplayName(name: string | null | undefined, email: string | null | undefined, fallbackId: string): string {
  const cleanName = String(name || '').trim();
  if (cleanName) return cleanName;
  const cleanEmail = String(email || '').trim();
  if (cleanEmail) return cleanEmail.split('@')[0] || cleanEmail;
  return `Alumnx ${fallbackId.slice(0, 6)}`;
}

function mapReviewRow(row: DbReviewRow): AmigxCriticxReviewRecord {
  const status = row.status === 'submitted' ? 'submitted' : 'claimed';
  return {
    id: String(row.id),
    courseId: String(row.courseId || 's123'),
    authorUserId: String(row.authorUserId),
    authorName: formatDisplayName(row.authorName, row.authorEmail, String(row.authorUserId)),
    recipientUserId: String(row.recipientUserId),
    recipientName: formatDisplayName(row.recipientName, row.recipientEmail, String(row.recipientUserId)),
    descripcion: String(row.descripcion ?? ''),
    funcionaNoFunciona: String(row.funcionaNoFunciona ?? ''),
    hariaDistinto: String(row.hariaDistinto ?? ''),
    recipientResponse: String(row.recipientResponse ?? ''),
    recipientRespondedAt: toIsoOrNull(row.recipientRespondedAt),
    isPublic: Boolean(row.isPublic),
    status,
    submittedAt: toIsoOrNull(row.submittedAt),
    createdAt: toIsoOrNull(row.createdAt) || new Date().toISOString(),
    updatedAt: toIsoOrNull(row.updatedAt) || new Date().toISOString(),
  };
}

export async function getActiveCourseStudents(courseId = 's123'): Promise<StudentCandidate[]> {
  const aliases = await getCourseAliases(courseId);
  const courseIds = aliases.length > 0 ? aliases : [courseId];

  const [enrollmentRes, profileRes] = await Promise.all([
    query<DbEnrollmentStudentRow>(
      `SELECT DISTINCT ON (u."id")
          u."id",
          u."name",
          u."email",
          u."role",
          e."roleInCourse"
         FROM "Enrollment" e
         JOIN "User" u ON u."id" = e."userId"
        WHERE e."courseId" = ANY($1)
        ORDER BY u."id", e."roleInCourse" ASC`,
      [courseIds],
    ),
    query<{
      userId: string | null;
      studentId: string | null;
      grupo: string | null;
    }>(
      `SELECT
          s."userId"::text AS "userId",
          NULLIF(TRIM(s."payload"->>'studentId'), '') AS "studentId",
          COALESCE(NULLIF(TRIM(s."payload"->>'grupo'), ''), NULLIF(TRIM(s."payload"->>'group'), '')) AS "grupo"
         FROM "Submission" s
        WHERE s."assignmentId" LIKE '__meta__:course-student-profile:%'
          AND (
            LOWER(COALESCE(s."payload"->>'courseId', s."payload"->>'course', s."payload"->>'courseSlug', '')) = ANY($1)
            OR s."assignmentId" ILIKE '__meta__:course-student-profile:' || $2 || ':%'
          )
        ORDER BY s."submittedAt" DESC`,
      [courseIds.map((c) => c.toLowerCase()), courseId],
    ),
  ]);

  if (enrollmentRes.error) {
    throw enrollmentRes.error;
  }

  const latestGroupByStudentId = new Map<string, string>();
  for (const row of profileRes.data ?? []) {
    const targetId = String(row.studentId || row.userId || '').trim();
    if (!targetId || latestGroupByStudentId.has(targetId)) continue;
    latestGroupByStudentId.set(targetId, String(row.grupo || '').trim());
  }

  const students: StudentCandidate[] = [];
  for (const row of enrollmentRes.data ?? []) {
    const roleInCourse = String(row.roleInCourse || 'student').trim().toLowerCase();
    if (roleInCourse === 'teacher') continue;
    if (isElevatedGlobalRole(row.role)) continue;
    const studentId = String(row.id);
    const grupo = latestGroupByStudentId.get(studentId) || '';
    if (isExcludedStudentGroup(grupo)) continue;
    students.push({
      id: studentId,
      name: formatDisplayName(row.name, row.email, studentId),
      email: row.email ? String(row.email).trim() : null,
      grupo: grupo || null,
    });
  }

  students.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  return students;
}

export async function listCourseAmigxCriticxReviews(courseId = 's123'): Promise<AmigxCriticxReviewRecord[]> {
  await ensureAmigxCriticxSchema();

  const { data: rows, error } = await query<DbReviewRow>(
    `SELECT
        r."id",
        r."courseId",
        r."authorUserId",
        au."name" AS "authorName",
        au."email" AS "authorEmail",
        r."recipientUserId",
        ru."name" AS "recipientName",
        ru."email" AS "recipientEmail",
        r."descripcion",
        r."funcionaNoFunciona",
        r."hariaDistinto",
        r."recipientResponse",
        r."recipientRespondedAt",
        r."isPublic",
        r."status",
        r."submittedAt",
        r."createdAt",
        r."updatedAt"
       FROM "AmigxCriticxReview" r
       JOIN "User" au ON au."id" = r."authorUserId"
       JOIN "User" ru ON ru."id" = r."recipientUserId"
      WHERE r."courseId" = $1
      ORDER BY r."submittedAt" DESC NULLS LAST, r."updatedAt" DESC`,
    [courseId],
  );

  if (error) {
    throw error;
  }

  return (rows ?? []).map(mapReviewRow);
}

export async function getAmigxCriticxPortalState(
  courseId: string,
  currentUser: { id: string; name: string | null; email: string | null; isTeacher: boolean },
): Promise<AmigxCriticxPortalState> {
  const canonicalCourse = courseId || 's123';
  const [allActiveStudents, allReviews] = await Promise.all([
    getActiveCourseStudents(canonicalCourse),
    listCourseAmigxCriticxReviews(canonicalCourse),
  ]);

  const pairs: AmigxCriticxPair[] = allReviews.map((r) => ({
    authorUserId: r.authorUserId,
    recipientUserId: r.recipientUserId,
  }));

  const urnCandidates = computeUrnCandidates(allActiveStudents, pairs, currentUser.id);
  const myOutboundReview = allReviews.find((r) => r.authorUserId === currentUser.id) || null;
  const myInboundReview = allReviews.find((r) => r.recipientUserId === currentUser.id) || null;
  const visibleReviews = allReviews.filter((r) =>
    canViewReview(r, currentUser.id, currentUser.isTeacher),
  );

  const takenRecipients = new Set(allReviews.map((r) => r.recipientUserId));
  const submittedCount = allReviews.filter((r) => r.status === 'submitted').length;

  return {
    courseId: canonicalCourse,
    currentUser: {
      id: currentUser.id,
      name: formatDisplayName(currentUser.name, currentUser.email, currentUser.id),
      email: currentUser.email,
      isTeacher: currentUser.isTeacher,
    },
    urnCandidates,
    allActiveStudents,
    myOutboundReview,
    myInboundReview,
    visibleReviews,
    urnStats: {
      totalStudents: allActiveStudents.length,
      assignedCount: allReviews.length,
      submittedCount,
      availableCount: allActiveStudents.filter((s) => !takenRecipients.has(s.id)).length,
    },
  };
}

export async function claimOrChangeRecipient(params: {
  courseId: string;
  authorUserId: string;
  recipientUserId: string;
}): Promise<{ ok: true; reviewId: string } | { ok: false; status: number; message: string }> {
  await ensureAmigxCriticxSchema();
  const { courseId, authorUserId, recipientUserId } = params;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock existing rows for this course to guarantee strict first-come-first-served urn semantics
    const existingRes = await client.query<{
      id: string;
      authorUserId: string;
      recipientUserId: string;
      status: string;
    }>(
      `SELECT "id", "authorUserId", "recipientUserId", "status"
         FROM "AmigxCriticxReview"
        WHERE "courseId" = $1
        FOR UPDATE`,
      [courseId],
    );

    const pairs: AmigxCriticxPair[] = existingRes.rows.map((r) => ({
      authorUserId: String(r.authorUserId),
      recipientUserId: String(r.recipientUserId),
    }));

    const validation = validatePairSelection(authorUserId, recipientUserId, pairs);
    if (!validation.ok) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, message: validation.message };
    }

    const upsertRes = await client.query<{ id: string }>(
      `INSERT INTO "AmigxCriticxReview" (
          "courseId",
          "authorUserId",
          "recipientUserId",
          "status",
          "createdAt",
          "updatedAt"
        )
        VALUES ($1, $2::uuid, $3::uuid, 'claimed', now(), now())
        ON CONFLICT ("courseId", "authorUserId")
        DO UPDATE SET
          "recipientUserId" = EXCLUDED."recipientUserId",
          "updatedAt" = now()
        RETURNING "id"`,
      [courseId, authorUserId, recipientUserId],
    );

    await client.query('COMMIT');
    return { ok: true, reviewId: String(upsertRes.rows[0]?.id || '') };
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const pgCode = (error as { code?: string })?.code;
    if (pgCode === '23505') {
      return {
        ok: false,
        status: 409,
        message: 'Estx alumnx acaba de ser elegidx por otrx compañerx en la urna.',
      };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function submitAmigxCriticxReport(params: {
  courseId: string;
  authorUserId: string;
  recipientUserId: string;
  descripcion: string;
  funcionaNoFunciona: string;
  hariaDistinto: string;
  isPublic: boolean;
}): Promise<{ ok: true; reviewId: string } | { ok: false; status: number; message: string }> {
  await ensureAmigxCriticxSchema();
  const {
    courseId,
    authorUserId,
    recipientUserId,
    descripcion,
    funcionaNoFunciona,
    hariaDistinto,
    isPublic,
  } = params;

  if (!descripcion.trim() || !funcionaNoFunciona.trim() || !hariaDistinto.trim()) {
    return {
      ok: false,
      status: 400,
      message: 'Completá los tres campos del informe según la rúbrica antes de entregar.',
    };
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const existingRes = await client.query<{
      id: string;
      authorUserId: string;
      recipientUserId: string;
    }>(
      `SELECT "id", "authorUserId", "recipientUserId"
         FROM "AmigxCriticxReview"
        WHERE "courseId" = $1
        FOR UPDATE`,
      [courseId],
    );

    const pairs: AmigxCriticxPair[] = existingRes.rows.map((r) => ({
      authorUserId: String(r.authorUserId),
      recipientUserId: String(r.recipientUserId),
    }));

    const validation = validatePairSelection(authorUserId, recipientUserId, pairs);
    if (!validation.ok) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, message: validation.message };
    }

    const upsertRes = await client.query<{ id: string }>(
      `INSERT INTO "AmigxCriticxReview" (
          "courseId",
          "authorUserId",
          "recipientUserId",
          "descripcion",
          "funcionaNoFunciona",
          "hariaDistinto",
          "isPublic",
          "status",
          "submittedAt",
          "createdAt",
          "updatedAt"
        )
        VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, 'submitted', now(), now(), now())
        ON CONFLICT ("courseId", "authorUserId")
        DO UPDATE SET
          "recipientUserId" = EXCLUDED."recipientUserId",
          "descripcion" = EXCLUDED."descripcion",
          "funcionaNoFunciona" = EXCLUDED."funcionaNoFunciona",
          "hariaDistinto" = EXCLUDED."hariaDistinto",
          "isPublic" = EXCLUDED."isPublic",
          "status" = 'submitted',
          "submittedAt" = now(),
          "updatedAt" = now()
        RETURNING "id"`,
      [
        courseId,
        authorUserId,
        recipientUserId,
        descripcion,
        funcionaNoFunciona,
        hariaDistinto,
        Boolean(isPublic),
      ],
    );

    await client.query('COMMIT');
    return { ok: true, reviewId: String(upsertRes.rows[0]?.id || '') };
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const pgCode = (error as { code?: string })?.code;
    if (pgCode === '23505') {
      return {
        ok: false,
        status: 409,
        message: 'Estx alumnx acaba de ser elegidx por otrx compañerx en la urna.',
      };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function setAmigxCriticxPublicToggle(params: {
  courseId: string;
  authorUserId: string;
  isPublic: boolean;
}): Promise<{ ok: boolean; message?: string }> {
  await ensureAmigxCriticxSchema();
  const { courseId, authorUserId, isPublic } = params;

  const { count, error } = await query(
    `UPDATE "AmigxCriticxReview"
        SET "isPublic" = $3,
            "updatedAt" = now()
      WHERE "courseId" = $1
        AND "authorUserId" = $2::uuid`,
    [courseId, authorUserId, Boolean(isPublic)],
  );

  if (error) throw error;
  if (!count) {
    return { ok: false, message: 'Aún no tenés una asignación activa para cambiar la visibilidad.' };
  }
  return { ok: true };
}

export async function submitRecipientResponse(params: {
  courseId: string;
  recipientUserId: string;
  reviewId: string;
  recipientResponse: string;
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  await ensureAmigxCriticxSchema();
  const { courseId, recipientUserId, reviewId, recipientResponse } = params;

  if (!recipientResponse.trim()) {
    return {
      ok: false,
      status: 400,
      message: 'La respuesta escrita no puede estar vacía.',
    };
  }

  const { count, error } = await query(
    `UPDATE "AmigxCriticxReview"
        SET "recipientResponse" = $4,
            "recipientRespondedAt" = now(),
            "updatedAt" = now()
      WHERE "id" = $1::uuid
        AND "courseId" = $2
        AND "recipientUserId" = $3::uuid`,
    [reviewId, courseId, recipientUserId, recipientResponse],
  );

  if (error) throw error;
  if (!count) {
    return {
      ok: false,
      status: 404,
      message: 'No se encontró la devolución recibida para este usuario.',
    };
  }
  return { ok: true };
}

export async function releaseRecipientClaim(params: {
  courseId: string;
  actorUserId: string;
  isTeacher: boolean;
  targetAuthorUserId?: string;
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  await ensureAmigxCriticxSchema();
  const { courseId, actorUserId, isTeacher, targetAuthorUserId } = params;
  const authorToDelete = isTeacher && targetAuthorUserId ? targetAuthorUserId : actorUserId;

  const { count, error } = await query(
    isTeacher
      ? `DELETE FROM "AmigxCriticxReview"
          WHERE "courseId" = $1
            AND "authorUserId" = $2::uuid`
      : `DELETE FROM "AmigxCriticxReview"
          WHERE "courseId" = $1
            AND "authorUserId" = $2::uuid
            AND "status" = 'claimed'`,
    [courseId, authorToDelete],
  );

  if (error) throw error;
  if (!count) {
    return {
      ok: false,
      status: 400,
      message: 'No se puede liberar una entrega ya enviada (solo docentes pueden reiniciar una asignación entregada).',
    };
  }
  return { ok: true };
}
