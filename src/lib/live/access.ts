import type { Session } from '@auth/core/types';
import { createSupabaseServerClient, ensureDbUserFromSession } from '../forum-server';
import { canonicalizeCourseId } from '../course-alias';

const normalizeRole = (value: unknown) => String(value || '').trim().toLowerCase();
export type LiveManageAccess = {
  canManage: boolean;
  userId: string;
  userRole: string;
  enrollmentRole: string;
};

export async function resolveLiveParticipantRole(
  session: Session | null | undefined,
  courseId = '',
): Promise<'teacher' | 'student'> {
  const normalizedCourseId = await canonicalizeCourseId(courseId);

  if (normalizedCourseId) {
    const access = await resolveLiveManageAccess(session, normalizedCourseId);
    return access.userRole === 'teacher' || access.enrollmentRole === 'teacher'
      ? 'teacher'
      : 'student';
  }

  if (!session?.user?.email) {
    return 'student';
  }

  const supabase = createSupabaseServerClient();
  const dbUser = await ensureDbUserFromSession(supabase, session);
  return normalizeRole(dbUser?.role) === 'teacher' ? 'teacher' : 'student';
}

export async function resolveLiveManageAccess(
  session: Session | null | undefined,
  courseId: string,
): Promise<LiveManageAccess> {
  const normalizedCourseId = await canonicalizeCourseId(courseId);
  if (!session?.user?.email || !normalizedCourseId) {
    return {
      canManage: false,
      userId: '',
      userRole: '',
      enrollmentRole: '',
    };
  }

  const supabase = createSupabaseServerClient();
  const sessionEmail = String(session.user.email || '').trim();
  if (!sessionEmail) {
    return {
      canManage: false,
      userId: '',
      userRole: '',
      enrollmentRole: '',
    };
  }

  // Multiple User rows can exist for the same email (legacy/import races).
  // Resolve access from all candidates so teacher permissions are not lost.
  const { data: candidateUsers, error: candidateUsersError } = await supabase
    .from('User')
    .select('id, role')
    .ilike('email', sessionEmail);

  if (candidateUsersError) {
    throw candidateUsersError;
  }

  let userCandidates = Array.isArray(candidateUsers) ? candidateUsers : [];
  if (userCandidates.length === 0) {
    const ensured = await ensureDbUserFromSession(supabase, session);
    if (ensured) {
      userCandidates = [{ id: ensured.id, role: ensured.role }];
    }
  }

  if (userCandidates.length === 0) {
    return {
      canManage: false,
      userId: '',
      userRole: '',
      enrollmentRole: '',
    };
  }

  const normalizedUsers = userCandidates
    .map((row) => ({
      id: String((row as any)?.id || '').trim(),
      role: normalizeRole((row as any)?.role),
    }))
    .filter((row) => Boolean(row.id));

  if (normalizedUsers.length === 0) {
    return {
      canManage: false,
      userId: '',
      userRole: '',
      enrollmentRole: '',
    };
  }

  const userIds = Array.from(new Set(normalizedUsers.map((row) => row.id)));

  const { data: enrollmentRows, error: enrollmentError } = await supabase
    .from('Enrollment')
    .select('userId, courseId, roleInCourse')
    .in('userId', userIds);

  if (enrollmentError && enrollmentError.code !== 'PGRST116') {
    throw enrollmentError;
  }

  const enrollments = Array.isArray(enrollmentRows) ? enrollmentRows : [];
  const canonicalEnrollments = await Promise.all(
    enrollments.map(async (row) => ({
      userId: String((row as any)?.userId || '').trim(),
      roleInCourse: normalizeRole((row as any)?.roleInCourse),
      courseId: await canonicalizeCourseId((row as any)?.courseId || ''),
    })),
  );

  const matchingEnrollments = canonicalEnrollments.filter(
    (row) => row.userId && row.courseId === normalizedCourseId,
  );

  const teacherUser = normalizedUsers.find((row) => row.role === 'teacher') || null;
  const teacherEnrollment = matchingEnrollments.find((row) => row.roleInCourse === 'teacher');
  const selectedEnrollment = teacherEnrollment || matchingEnrollments[0] || null;
  const selectedUser = selectedEnrollment
    ? normalizedUsers.find((row) => row.id === selectedEnrollment.userId) || null
    : (teacherUser || normalizedUsers[0] || null);

  const userRole = normalizeRole(selectedUser?.role);
  const enrollmentRole = normalizeRole(selectedEnrollment?.roleInCourse);
  const canManage = enrollmentRole === 'teacher'
    || (matchingEnrollments.length === 0 && userRole === 'teacher');

  return {
    canManage,
    userId: String(selectedUser?.id || ''),
    userRole,
    enrollmentRole,
  };
}
