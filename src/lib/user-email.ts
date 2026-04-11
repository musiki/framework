/**
 * UserEmail — multi-email identity helpers
 *
 * Pattern: one User per person, many UserEmail rows per User.
 * Login resolves email → UserEmail.userId → User.
 *
 * Fallback: if no UserEmail row exists for an email, we try User.email
 * directly and auto-migrate on hit (lazy seeding).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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
  supabase: SupabaseClient,
  rawEmail: string,
): Promise<string | null> {
  const email = rawEmail.toLowerCase().trim();
  if (!email) return null;

  // 1. UserEmail table
  const { data: ueRow } = await supabase
    .from('UserEmail')
    .select('userId')
    .eq('email', email)
    .maybeSingle();

  if (ueRow?.userId) return ueRow.userId;

  // 2. Fallback: User.email (handles pre-migration rows)
  const { data: userRow } = await supabase
    .from('User')
    .select('id')
    .ilike('email', email)
    .maybeSingle();

  if (!userRow?.id) return null;

  // Lazy migration — insert UserEmail row so future lookups hit path #1
  await supabase.from('UserEmail').upsert(
    [{ userId: userRow.id, email, isPrimary: true }],
    { onConflict: 'email', ignoreDuplicates: true },
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
  supabase: SupabaseClient,
  userId: string,
  rawEmail: string,
  isPrimary = false,
): Promise<{ ok: boolean; conflict?: string }> {
  const email = rawEmail.toLowerCase().trim();

  const existingOwnerId = await resolveUserIdByEmail(supabase, email);
  if (existingOwnerId) {
    if (existingOwnerId === userId) return { ok: true }; // already registered
    return { ok: false, conflict: existingOwnerId };
  }

  const { error } = await supabase.from('UserEmail').insert([{ userId, email, isPrimary }]);
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
  supabase: SupabaseClient,
  keepId: string,
  mergeId: string,
): Promise<MergeResult> {
  if (keepId === mergeId) return { ok: false, error: 'keepId and mergeId are the same' };

  // Verify both users exist
  const { data: users } = await supabase
    .from('User')
    .select('id')
    .in('id', [keepId, mergeId]);

  const foundIds = new Set((users || []).map((u: any) => u.id));
  if (!foundIds.has(keepId)) return { ok: false, error: `User ${keepId} not found` };
  if (!foundIds.has(mergeId)) return { ok: false, error: `User ${mergeId} not found` };

  // 1. Transfer UserEmail rows
  const { data: mergeEmails } = await supabase
    .from('UserEmail')
    .select('id, email, isPrimary')
    .eq('userId', mergeId);

  let transferredEmails = 0;
  for (const row of (mergeEmails || []) as UserEmailRow[]) {
    // Check if email already registered under keepId
    const { data: existing } = await supabase
      .from('UserEmail')
      .select('id')
      .eq('email', row.email)
      .eq('userId', keepId)
      .maybeSingle();

    if (existing) {
      // Just remove the duplicate row
      await supabase.from('UserEmail').delete().eq('id', row.id);
    } else {
      await supabase
        .from('UserEmail')
        .update({ userId: keepId, isPrimary: false })
        .eq('id', row.id);
      transferredEmails++;
    }
  }

  // Also ensure the mergeId's User.email is registered under keepId
  const { data: mergeUser } = await supabase
    .from('User')
    .select('email')
    .eq('id', mergeId)
    .maybeSingle();

  if (mergeUser?.email) {
    await registerEmailForUser(supabase, keepId, mergeUser.email, false).catch(() => undefined);
  }

  // 2. Transfer Enrollments (skip if keepId already enrolled in same course)
  const { data: keepEnrollments } = await supabase
    .from('Enrollment')
    .select('courseId')
    .eq('userId', keepId);

  const keepCourseIds = new Set((keepEnrollments || []).map((e: any) => e.courseId));

  const { data: mergeEnrollments } = await supabase
    .from('Enrollment')
    .select('id, courseId')
    .eq('userId', mergeId);

  let transferredEnrollments = 0;
  for (const e of (mergeEnrollments || []) as any[]) {
    if (keepCourseIds.has(e.courseId)) {
      await supabase.from('Enrollment').delete().eq('id', e.id);
    } else {
      await supabase.from('Enrollment').update({ userId: keepId }).eq('id', e.id);
      transferredEnrollments++;
    }
  }

  // 3. Transfer Submissions (skip if keepId already has submission for same assignment)
  const { data: keepSubmissions } = await supabase
    .from('Submission')
    .select('assignmentId')
    .eq('userId', keepId);

  const keepAssignmentIds = new Set((keepSubmissions || []).map((s: any) => s.assignmentId));

  const { data: mergeSubmissions } = await supabase
    .from('Submission')
    .select('id, assignmentId')
    .eq('userId', mergeId);

  let transferredSubmissions = 0;
  for (const s of (mergeSubmissions || []) as any[]) {
    if (keepAssignmentIds.has(s.assignmentId)) {
      await supabase.from('Submission').delete().eq('id', s.id);
    } else {
      await supabase.from('Submission').update({ userId: keepId }).eq('id', s.id);
      transferredSubmissions++;
    }
  }

  // 4. Delete the merged user
  const { error: deleteError } = await supabase.from('User').delete().eq('id', mergeId);
  if (deleteError) return { ok: false, error: deleteError.message };

  return { ok: true, transferredEmails, transferredEnrollments, transferredSubmissions };
}

// ── List emails for a user ─────────────────────────────────────────────────────

export async function listEmailsForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserEmailRow[]> {
  const { data } = await supabase
    .from('UserEmail')
    .select('id, userId, email, isPrimary, createdAt')
    .eq('userId', userId)
    .order('isPrimary', { ascending: false })
    .order('createdAt', { ascending: true });

  return (data || []) as UserEmailRow[];
}
