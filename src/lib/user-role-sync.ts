import { isElevatedGlobalRole } from './roles';

export const hasTeacherEnrollment = async (supabase: any, userId: string): Promise<boolean> => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return false;

  const { data, error } = await supabase
    .from('Enrollment')
    .select('roleInCourse')
    .eq('userId', normalizedUserId)
    .eq('roleInCourse', 'teacher')
    .limit(1);

  if (error) throw new Error(error.message || 'Supabase error');
  return Array.isArray(data) && data.length > 0;
};

export const promoteUserToTeacherIfNeeded = async (supabase: any, userId: string): Promise<boolean> => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return false;

  const teacherByEnrollment = await hasTeacherEnrollment(supabase, normalizedUserId);
  if (!teacherByEnrollment) return false;

  const { data: user, error: userError } = await supabase
    .from('User')
    .select('id, role')
    .eq('id', normalizedUserId)
    .maybeSingle();

  if (userError) throw userError;
  if (!user) return false;
  if (isElevatedGlobalRole(user.role)) return false;

  const { error: updateError } = await supabase
    .from('User')
    .update({
      role: 'teacher',
      updatedAt: new Date().toISOString(),
    })
    .eq('id', normalizedUserId);

  if (updateError) throw updateError;
  return true;
};
