import { getRoleBadgeLabel } from '../dashboard-role';
import { buildSearchBlob, type DashboardGridProjection } from './shared';

interface AdminProjectionInput {
  activeCourseId: string;
  allUsers: any[];
  allEnrollments: any[];
  allSubmissions: any[];
  allLiveClassAttendance: any[];
}

const normalizeRole = (value: unknown) => String(value || '').trim().toLowerCase();
const normalizeText = (value: unknown) => String(value || '').trim();

const getRecordCourseId = (record: any) =>
  normalizeText(record?.courseId)
  || normalizeText(record?.pageSlug).split('/').filter(Boolean)[0]
  || '';

const formatSubmissionDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function buildAdminProjection({
  activeCourseId,
  allUsers,
  allEnrollments,
  allSubmissions,
  allLiveClassAttendance,
}: AdminProjectionInput): DashboardGridProjection {
  const usersById = new Map((allUsers || []).map((user: any) => [String(user?.id || ''), user]));
  const enrollments = (allEnrollments || []).filter((enrollment: any) =>
    String(enrollment?.userId || '').trim() && String(enrollment?.courseId || '').trim(),
  );
  const enrollmentsByUserId = enrollments.reduce((acc: Map<string, any[]>, enrollment: any) => {
    const userId = String(enrollment?.userId || '').trim();
    if (!userId) return acc;
    if (!acc.has(userId)) acc.set(userId, []);
    acc.get(userId)?.push(enrollment);
    return acc;
  }, new Map<string, any[]>());

  const activeCourseIdNormalized = String(activeCourseId || '').trim();
  const userIds = Array.from(
    new Set([
      ...(allUsers || []).map((user: any) => String(user?.id || '')).filter(Boolean),
      ...Array.from(enrollmentsByUserId.keys()),
    ]),
  );

  const rows = userIds
    .map((userId) => {
      const user = usersById.get(userId);
      const userEnrollments = enrollmentsByUserId.get(userId) || [];
      const enrollment = activeCourseIdNormalized
        ? userEnrollments.find((item: any) => String(item?.courseId || '').trim() === activeCourseIdNormalized) || null
        : null;
      const latestSubmission = (allSubmissions || [])
        .filter((submission: any) => String(submission?.userId || '') === userId)
        .sort((left: any, right: any) => String(right?.submittedAt || '').localeCompare(String(left?.submittedAt || ''), 'es'))[0] || null;
      const latestAttendance = (allLiveClassAttendance || [])
        .filter((attendance: any) => String(attendance?.userId || '') === userId)
        .sort((left: any, right: any) => String(right?.lastEventAt || '').localeCompare(String(left?.lastEventAt || ''), 'es'))[0] || null;

      const latestActivityAt =
        String(latestAttendance?.lastEventAt || '') > String(latestSubmission?.submittedAt || '')
          ? String(latestAttendance?.lastEventAt || '')
          : String(latestSubmission?.submittedAt || '');

      const globalRole = normalizeRole(user?.role);
      const roleInCourse = normalizeRole(enrollment?.roleInCourse || '');
      const activeCourses = Array.from(
        new Map(
          userEnrollments
            .map((item: any) => {
              const courseId = normalizeText(item?.courseId || '');
              if (!courseId) return null;
              return [courseId, courseId] as const;
            })
            .filter(Boolean) as [string, string][],
        ).values(),
      ).sort((left, right) => String(left).localeCompare(String(right), 'es'));

      return {
        id: userId,
        userId,
        enrollmentId: String(enrollment?.id || ''),
        name: String(user?.name || user?.email || userId || '—'),
        email: String(user?.email || '—'),
        globalRoleLabel: getRoleBadgeLabel(globalRole || 'student'),
        globalRole,
        courseRoleLabel: roleInCourse ? getRoleBadgeLabel(roleInCourse) : '—',
        courseRole: roleInCourse,
        enrollmentSummary: activeCourses.length ? activeCourses.join(' · ') : '—',
        enrollmentCourses: activeCourses,
        lastActivityAt: latestActivityAt,
        lastActivityLabel: formatSubmissionDate(latestActivityAt),
        __search: buildSearchBlob([
          user?.name,
          user?.email,
          globalRole,
          roleInCourse,
          ...activeCourses,
          latestActivityAt,
        ]),
      };
    })
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'es'));

  return {
    columns: [
      { title: 'Nombre', field: 'name', frozen: true, minWidth: 180 },
      { title: 'Email', field: 'email', minWidth: 220 },
      { title: 'Rol global', field: 'globalRole', width: 110, hozAlign: 'center', headerHozAlign: 'center', kind: 'role' },
      { title: 'Rol curso', field: 'courseRole', width: 118, hozAlign: 'center', headerHozAlign: 'center', kind: 'course-role' },
      { title: 'Inscripción', field: 'enrollmentSummary', minWidth: 220, kind: 'enrollment-courses' },
      { title: 'Última actividad', field: 'lastActivityLabel', minWidth: 150 },
      { title: 'Acciones', field: '__adminActions', width: 98, hozAlign: 'center', headerHozAlign: 'center', headerSort: false, kind: 'admin-actions' },
    ],
    rows,
    emptyMessage: 'No hay usuarios para mostrar en Admin.',
  };
}
