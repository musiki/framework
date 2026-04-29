/**
 * UserEmail — multi-email identity helpers
 *
 * Pattern: one User per person, many UserEmail rows per User.
 * Login resolves email → UserEmail.userId → User.
 *
 * Fallback: if no UserEmail row exists for an email, we try User.email
 * directly and auto-migrate on hit (lazy seeding).
 */

import { query } from './db/pool';

// ── Types ──────────────────────────────────────────────────────────────────────

export type UserEmailRow = {
  id: string;
  userId: string;
  email: string;
  isPrimary: boolean;
  createdAt: string;
};

export type MergeResult =
  | { ok: true; transferredEmails: number; transferredEnrollments: number; transferredSubmissions: number }
  | { ok: false; error: string };

// ── Core lookup ────────────────────────────────────────────────────────────────

/**
 * Resolve a User.id from an email address.
 *
 * Order of lookup:
 * 1. UserEmail table (exact, case-insensitive)
 * 2. User.email direct lookup (fallback + lazy migration)
 *
 * Returns null if no user owns this email.
 */
export async function resolveUserIdByEmail(
  rawEmail: string,
): Promise<string | null> {
  const email = rawEmail.toLowerCase().trim();
  if (!email) return null;

  // 1. UserEmail table
  const { data: ueRows, error: ueError } = await query(`SELECT "userId" FROM "UserEmail" WHERE "email" = $1`, [email]);
  if (ueError) {
    console.warn(`[DB-EMAIL] UserEmail lookup error for ${email}:`, ueError.message);
  }
  const ueRow = ueRows?.[0];

  if (ueRow?.userId) {
    console.log(`[DB-EMAIL] Found userId ${ueRow.userId} in UserEmail table for ${email}`);
    return ueRow.userId;
  }

  // 2. Fallback: User.email (handles pre-migration rows)
  const { data: userRows, error: userError } = await query(`SELECT "id" FROM "User" WHERE "email" ILIKE $1`, [email]);
  if (userError) {
    console.warn(`[DB-EMAIL] User table lookup error for ${email}:`, userError.message);
  }
  const userRow = userRows?.[0];

  if (!userRow?.id) {
    console.log(`[DB-EMAIL] No user found for ${email} in User or UserEmail table`);
    return null;
  }

  console.log(`[DB-EMAIL] Found userId ${userRow.id} in User table (fallback) for ${email}. Migrating to UserEmail...`);
  // Lazy migration — insert UserEmail row so future lookups hit path #1
  await query(
    `INSERT INTO "UserEmail" ("userId", "email", "isPrimary") VALUES ($1, $2, $3) ON CONFLICT ("email") DO NOTHING`,
    [userRow.id, email, true]
  );

  return userRow.id;
}

// ── Register ───────────────────────────────────────────────────────────────────

/**
 * Add an additional email to an existing user.
 * No-op if the email is already linked to the same user.
 * Returns false if the email is already owned by a different user.
 */
export async function registerEmailForUser(
  userId: string,
  rawEmail: string,
  isPrimary = false,
): Promise<{ ok: boolean; conflict?: string }> {
  const email = rawEmail.toLowerCase().trim();

  const existingOwnerId = await resolveUserIdByEmail(email);
  if (existingOwnerId) {
    if (existingOwnerId === userId) return { ok: true }; // already registered
    return { ok: false, conflict: existingOwnerId };
  }

  const { error } = await query(
    `INSERT INTO "UserEmail" ("userId", "email", "isPrimary") VALUES ($1, $2, $3)`,
    [userId, email, isPrimary]
  );
  
  if (error && error.code !== '23505') {
    throw new Error(error.message || 'Failed to register email');
  }

  return { ok: !error };
}

// ── Merge ──────────────────────────────────────────────────────────────────────

/**
 * Merge two User records into one.
 * - keepId: the user that survives
 * - mergeId: the duplicate that is deleted
 *
 * Operations (all or nothing — done sequentially; Supabase lacks cross-table txns):
 * 1. Transfer all UserEmail rows from mergeId → keepId
 * 2. Reassign all Enrollment rows from mergeId → keepId (skip duplicates)
 * 3. Reassign all Submission rows from mergeId → keepId (skip duplicates)
 * 4. Delete the mergeId User record
 */
export async function mergeUsers(
  keepId: string,
  mergeId: string,
): Promise<MergeResult> {
  if (keepId === mergeId) return { ok: false, error: 'keepId and mergeId are the same' };

  // Verify both users exist
  const { data: users } = await query(`SELECT "id" FROM "User" WHERE "id" = ANY($1)`, [[keepId, mergeId]]);

  const foundIds = new Set((users || []).map((u: any) => u.id));
  if (!foundIds.has(keepId)) return { ok: false, error: `User ${keepId} not found` };
  if (!foundIds.has(mergeId)) return { ok: false, error: `User ${mergeId} not found` };

  // 1. Transfer UserEmail rows
  const { data: mergeEmails } = await query(`SELECT "id", "email", "isPrimary" FROM "UserEmail" WHERE "userId" = $1`, [mergeId]);

  let transferredEmails = 0;
  for (const row of (mergeEmails || []) as UserEmailRow[]) {
    // Check if email already registered under keepId
    const { data: existingRows } = await query(
      `SELECT "id" FROM "UserEmail" WHERE "email" = $1 AND "userId" = $2`,
      [row.email, keepId]
    );
    const existing = existingRows?.[0];

    if (existing) {
      // Just remove the duplicate row
      await query(`DELETE FROM "UserEmail" WHERE "id" = $1`, [row.id]);
    } else {
      await query(
        `UPDATE "UserEmail" SET "userId" = $1, "isPrimary" = $2 WHERE "id" = $3`,
        [keepId, false, row.id]
      );
      transferredEmails++;
    }
  }

  // Also ensure the mergeId's User.email is registered under keepId
  const { data: mergeUserRows } = await query(`SELECT "email" FROM "User" WHERE "id" = $1`, [mergeId]);
  const mergeUser = mergeUserRows?.[0];

  if (mergeUser?.email) {
    await registerEmailForUser(keepId, mergeUser.email, false).catch(() => undefined);
  }

  // 2. Transfer Enrollments (skip if keepId already enrolled in same course)
  const { data: keepEnrollments } = await query(`SELECT "courseId" FROM "Enrollment" WHERE "userId" = $1`, [keepId]);

  const keepCourseIds = new Set((keepEnrollments || []).map((e: any) => e.courseId));

  const { data: mergeEnrollments } = await query(`SELECT "id", "courseId" FROM "Enrollment" WHERE "userId" = $1`, [mergeId]);

  let transferredEnrollments = 0;
  for (const e of (mergeEnrollments || []) as any[]) {
    if (keepCourseIds.has(e.courseId)) {
      await query(`DELETE FROM "Enrollment" WHERE "id" = $1`, [e.id]);
    } else {
      await query(`UPDATE "Enrollment" SET "userId" = $1 WHERE "id" = $2`, [keepId, e.id]);
      transferredEnrollments++;
    }
  }

  // 3. Transfer Submissions (skip if keepId already has submission for same assignment)
  const { data: keepSubmissions } = await query(`SELECT "assignmentId" FROM "Submission" WHERE "userId" = $1`, [keepId]);

  const keepAssignmentIds = new Set((keepSubmissions || []).map((s: any) => s.assignmentId));

  const { data: mergeSubmissions } = await query(`SELECT "id", "assignmentId" FROM "Submission" WHERE "userId" = $1`, [mergeId]);

  let transferredSubmissions = 0;
  for (const s of (mergeSubmissions || []) as any[]) {
    if (keepAssignmentIds.has(s.assignmentId)) {
      await query(`DELETE FROM "Submission" WHERE "id" = $1`, [s.id]);
    } else {
      await query(`UPDATE "Submission" SET "userId" = $1 WHERE "id" = $2`, [keepId, s.id]);
      transferredSubmissions++;
    }
  }

  // 4. Delete the merged user
  const { error: deleteError } = await query(`DELETE FROM "User" WHERE "id" = $1`, [mergeId]);
  if (deleteError) return { ok: false, error: deleteError.message };

  return { ok: true, transferredEmails, transferredEnrollments, transferredSubmissions };
}

// ── List emails for a user ─────────────────────────────────────────────────────

export async function listEmailsForUser(
  userId: string,
): Promise<UserEmailRow[]> {
  const { data } = await query(
    `SELECT "id", "userId", "email", "isPrimary", "createdAt" FROM "UserEmail" WHERE "userId" = $1 ORDER BY "isPrimary" DESC, "createdAt" ASC`,
    [userId]
  );

  return (data || []) as UserEmailRow[];
}


