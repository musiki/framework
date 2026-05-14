import type { Session } from '@auth/core/types';
import { getEntry } from 'astro:content';
import { canonicalizeCourseId, getCourseAliases } from './course-alias';
import { isElevatedGlobalRole } from './roles';
import { query } from './db/pool';

export type ForumDbUser = {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
};

export type ForumCourseAccess = {
  canRead: boolean;
  canWrite: boolean;
  isPublicCourse: boolean;
  isEnrolled: boolean;
  isTeacher: boolean;
};

function clampLength(value: string, maxLength: number): string {
  if (maxLength <= 0) return value;
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

export function cleanString(value: unknown, maxLength = 0): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return maxLength > 0 ? clampLength(s, maxLength) : s;
}

export function cleanBody(value: unknown, maxLength = 0): string {
  const s = typeof value === 'string' ? value : '';
  return maxLength > 0 ? clampLength(s, maxLength) : s;
}

export function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeDbUser(row: any): ForumDbUser {
  return {
    id: String(row.id),
    email: row.email ?? null,
    name: row.name ?? null,
    role: row.role ?? null,
  };
}

export async function ensureDbUserFromSession(
  session: Session | null | undefined,
): Promise<ForumDbUser | null> {
  const email = cleanString(session?.user?.email ?? '', 320);
  if (!email) {
    if (session) {
      console.warn('[DB] Session exists but no email found. User object:', JSON.stringify(session.user));
    }
    return null;
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[DB] Resolving user for email: ${normalizedEmail}`);
  let resolvedUserId: string | null = null;

  try {
    const { resolveUserIdByEmail } = await import('./user-email');
    resolvedUserId = await resolveUserIdByEmail(normalizedEmail).catch((err) => {
      // If UserEmail table is missing, log warning but don't crash
      if (err.code === '42P01') {
        console.warn('[DB] UserEmail table not found. Falling back to direct email lookup.');
        return null;
      }
      
      // If it's a connection error, RE-THROW so the caller knows the DB is down
      const isConnectionError = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', '08006'].includes(err.code) 
        || String(err.message).includes('ECONNRESET');

      if (isConnectionError) {
        console.error('[DB] Connection error during user resolution:', err.message);
        throw err;
      }

      console.error('[DB] User resolution error:', err.message);
      return null;
    });
  } catch (err: any) {
    if (err.code === 'ECONNRESET' || String(err.message).includes('ECONNRESET')) {
      throw err; // Propagate the connection failure
    }
    console.error('[DB] Failed to load user-email module or unexpected error:', err);
  }

  const { data: existingRows, error: existingError } = resolvedUserId
    ? await query(`SELECT * FROM "User" WHERE "id" = $1 LIMIT 1`, [resolvedUserId])
    : await query(`SELECT * FROM "User" WHERE "email" ILIKE $1 ORDER BY "updatedAt" DESC LIMIT 1`, [normalizedEmail]);

  if (existingError) {
    console.error('[DB] existingError', existingError.message);
    throw new Error(existingError.message || 'Database lookup error');
  }

  const existing = existingRows?.[0];

  if (existing) {
    const sessionName = cleanString(session?.user?.name ?? '', 160);
    const sessionImage = cleanString(session?.user?.image ?? '', 1024);

    const nextName = sessionName || cleanString(existing.name || email, 160) || email;
    const nextImage = sessionImage || existing.image || null;

    // Trigger update if we have a new name from session OR if the DB name is currently missing
    const shouldUpdateName = (Boolean(sessionName) && nextName !== (existing.name ?? '')) || !existing.name;
    const shouldUpdateImage = Boolean(sessionImage) && nextImage !== (existing.image ?? null);

    if (shouldUpdateName || shouldUpdateImage) {
      const { error: updateError } = await query(
        `UPDATE "User" SET "name" = $1, "image" = $2, "updatedAt" = $3 WHERE "id" = $4`,
        [
          shouldUpdateName ? nextName : existing.name,
          shouldUpdateImage ? nextImage : existing.image,
          new Date().toISOString(),
          existing.id
        ]
      );

      if (updateError) {
        console.error('[DB] Failed to update profile:', updateError.message);
      } else {
        if (shouldUpdateName) existing.name = nextName;
        if (shouldUpdateImage) existing.image = nextImage;
      }
    }

    void logPlatformAccess(existing.id, normalizedEmail, existing.name).catch(() => {});
    return normalizeDbUser(existing);
  }

  // Create new user if not found
  console.log('[DB] Creating new user for', normalizedEmail);
  const now = new Date().toISOString();
  const newUserId = crypto.randomUUID();
  const insertPayload = {
    id: newUserId,
    email: normalizedEmail,
    name: cleanString(session?.user?.name ?? normalizedEmail, 160) || normalizedEmail,
    emailVerified: true,
    image: session?.user?.image ?? null,
    role: 'student',
    createdAt: now,
    updatedAt: now,
  };

  const { data: insertedRows, error: insertError } = await query(
    `INSERT INTO "User" ("id", "email", "name", "emailVerified", "image", "role", "createdAt", "updatedAt") 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, email, name, role`,
    [
      insertPayload.id,
      insertPayload.email,
      insertPayload.name,
      insertPayload.emailVerified,
      insertPayload.image,
      insertPayload.role,
      insertPayload.createdAt,
      insertPayload.updatedAt
    ]
  );

  if (insertError) {
    if (insertError.code === '23505') {
       // Collision race: refetch
       const { data: refetchedRows } = await query(
        `SELECT id, email, name, role FROM "User" WHERE "email" ILIKE $1 LIMIT 1`,
        [normalizedEmail]
      );
      if (refetchedRows?.[0]) return normalizeDbUser(refetchedRows[0]);
    }
    throw new Error(insertError.message || 'Database insert error');
  }

  const inserted = insertedRows?.[0];
  if (inserted) {
    try {
      const { registerEmailForUser } = await import('./user-email');
      await registerEmailForUser(inserted.id, normalizedEmail, true).catch(() => undefined);
    } catch {}
    void logPlatformAccess(inserted.id, normalizedEmail, insertPayload.name).catch(() => {});
    return normalizeDbUser(inserted);
  }

  return null;
}

async function logPlatformAccess(userId: string, email: string, name?: string | null): Promise<void> {
  const { data: recent } = await query(
    `SELECT id FROM "PlatformLoginLog"
     WHERE "userId" = $1 AND "createdAt" > NOW() - INTERVAL '4 hours'
     LIMIT 1`,
    [userId],
  );
  if (recent && recent.length > 0) return;
  await query(
    `INSERT INTO "PlatformLoginLog" ("userId", email, name, "createdAt")
     VALUES ($1, $2, $3, NOW())`,
    [userId, email || null, name || null],
  );
}

async function isPublicCourse(courseId: string): Promise<boolean> {
  const normalizedCourseId = await canonicalizeCourseId(courseId);
  if (!normalizedCourseId) return false;

  try {
    const courseEntry = await getEntry('cursos', `${normalizedCourseId}/_index`);
    return Boolean(courseEntry?.data?.public);
  } catch {
    return false;
  }
}

export async function getForumCourseAccess(
  user: ForumDbUser,
  courseId: string,
): Promise<ForumCourseAccess> {
  const normalizedCourseId = await canonicalizeCourseId(courseId);
  const courseAliases = await getCourseAliases(normalizedCourseId || courseId);
  const normalizedGlobalRole = String(user.role || '').trim().toLowerCase();
  const isPublic = await isPublicCourse(normalizedCourseId);

  const { data: enrollments, error: enrollmentError } = await query(
    `SELECT "id", "roleInCourse", "courseId" FROM "Enrollment" WHERE "userId" = $1 AND "courseId" = ANY($2)`,
    [user.id, courseAliases.length > 0 ? courseAliases : [normalizedCourseId || courseId]]
  );

  if (enrollmentError) throw enrollmentError;

  const matchingEnrollments = Array.isArray(enrollments) ? enrollments : [];
  const enrollment =
    matchingEnrollments.find(
      (row: any) => String(row?.roleInCourse || '').trim().toLowerCase() === 'teacher',
    ) || matchingEnrollments[0] || null;
  const isEnrolled = matchingEnrollments.length > 0;
  const isTeacherInCourse =
    isEnrolled &&
    (String((enrollment as any)?.roleInCourse || '').trim().toLowerCase() === 'teacher' ||
      isElevatedGlobalRole(normalizedGlobalRole));

  return {
    canRead: isEnrolled,
    canWrite: isEnrolled,
    isPublicCourse: isPublic,
    isEnrolled,
    isTeacher: isTeacherInCourse,
  };
}
