import { isElevatedGlobalRole } from './roles';
import { query } from './db/pool';

export const hasTeacherEnrollment = async (_supabase: any, userId: string): Promise<boolean> => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return false;

  const { data, error } = await query(
    `SELECT "roleInCourse" FROM "Enrollment" WHERE "userId" = $1 AND "roleInCourse" = $2 LIMIT 1`,
    [normalizedUserId, 'teacher']
  );

  if (error) throw new Error(error.message || 'Database error');
  return Array.isArray(data) && data.length > 0;
};

export const promoteUserToTeacherIfNeeded = async (_supabase: any, userId: string): Promise<boolean> => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return false;

  const teacherByEnrollment = await hasTeacherEnrollment(_supabase, normalizedUserId);
  if (!teacherByEnrollment) return false;

  const { data: userRows, error: userError } = await query(
    `SELECT "id", "role" FROM "User" WHERE "id" = $1`,
    [normalizedUserId]
  );
  const user = userRows?.[0];

  if (userError) throw userError;
  if (!user) return false;
  if (isElevatedGlobalRole(user.role)) return false;

  const { error: updateError } = await query(
    `UPDATE "User" SET "role" = $1, "updatedAt" = $2 WHERE "id" = $3`,
    ['teacher', new Date().toISOString(), normalizedUserId]
  );

  if (updateError) throw updateError;
  return true;
};

