import { getRoleBadgeLabel } from '../dashboard-role';
import { normalizeGlobalRole } from '../roles';
import { buildSearchBlob, type DashboardGridProjection } from './shared';

interface AdminProjectionInput {
  activeCourseId: string;
  availableCourses: Array<{ courseId: string; title?: string; code?: string }>;
  studentGroupsByUserId?: Record<string, string>;
  allUsers: any[];
  allEnrollments: any[];
  allSubmissions: any[];
  allLiveClassAttendance: any[];
}

const normalizeRole = (value: unknown) => normalizeGlobalRole(value);
const normalizeText = (value: unknown) => String(value || '').trim();

const getRecordCourseId = (record: any) =>
  normalizeText(record?.courseId)
  || normalizeText(record?.pageSlug).split('/').filter(Boolean)[0]
  || '';

export function buildAdminProjection({
  activeCourseId,
  availableCourses,
  studentGroupsByUserId = {},
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
  const enrollmentCourseCatalog = Array.from(
    new Map(
      (availableCourses || [])
        .map((course) => {
          const courseId = normalizeText(course?.courseId || '');
          if (!courseId) return null;
          return [courseId, {
            courseId,
            label: normalizeText(course?.title || course?.code || courseId),
          }] as const;
        })
        .filter(Boolean) as [string, { courseId: string; label: string }][],
    ).values(),
  ).sort((left, right) => String(left.label || left.courseId).localeCompare(String(right.label || right.courseId), 'es'));
  const enrollmentCourseCatalogById = new Map(enrollmentCourseCatalog.map((course) => [course.courseId, course]));
  const userIdsFromUsers = (allUsers || [])
    .map((user: any) => String(user?.id || ''))
    .filter(Boolean);
  const userIdsFromEnrollments = Array.from(enrollmentsByUserId.keys())
    .map((userId) => String(userId || ''))
    .filter(Boolean);
  const userIds = Array.from(new Set([...userIdsFromUsers, ...userIdsFromEnrollments]));

  const rows = userIds
    .map((userId) => {
      const user = usersById.get(userId);
      const userEnrollments = enrollmentsByUserId.get(userId) || [];
      const enrollment = activeCourseIdNormalized
        ? userEnrollments.find((item: any) => String(item?.courseId || '').trim() === activeCourseIdNormalized) || null
        : userEnrollments.length === 1
          ? userEnrollments[0]
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

      const enrollmentCourses = Array.from(
        new Map(
          userEnrollments
            .map((item: any) => {
              const courseId = normalizeText(item?.courseId || '');
              const enrollmentId = normalizeText(item?.id || '');
              if (!courseId) return null;
              return [courseId, {
                courseId,
                label: normalizeText(enrollmentCourseCatalogById.get(courseId)?.label || courseId),
                enrollmentId,
                roleInCourse: normalizeRole(item?.roleInCourse || 'student'),
              }] as const;
            })
            .filter(Boolean) as [string, { courseId: string; label: string; enrollmentId: string; roleInCourse: string }][],
        ).values(),
      ).sort((left, right) => String(left.courseId).localeCompare(String(right.courseId), 'es'));
      const teacherByEnrollment = enrollmentCourses.some((item) => normalizeRole(item.roleInCourse) === 'teacher');
      const normalizedGlobalRole = normalizeRole(user?.role);
      const globalRole = normalizedGlobalRole === 'admin'
        ? 'admin'
        : teacherByEnrollment
          ? 'teacher'
          : normalizedGlobalRole;
      const roleInCourse = normalizeRole(enrollment?.roleInCourse || '');
      const grupo = normalizeText(
        studentGroupsByUserId[userId]
          || enrollment?.grupo
          || enrollment?.group
          || user?.grupo
          || user?.group
          || '',
      ) || '—';

      return {
        id: userId,
        userId,
        enrollmentId: String(enrollment?.id || ''),
        name: String(user?.name || user?.email || userId || '—'),
        email: String(user?.email || '—'),
        grupo,
        globalRoleLabel: getRoleBadgeLabel(globalRole || 'student'),
        globalRole,
        courseRoleLabel: roleInCourse ? getRoleBadgeLabel(roleInCourse) : '—',
        courseRole: roleInCourse,
        enrollmentSummary: enrollmentCourses.length ? enrollmentCourses.map((e) => e.label || e.courseId).join(' · ') : '—',
        enrollmentCourses,
        enrollmentCourseCatalog,
        lastActivityAt: latestActivityAt,
        __search: buildSearchBlob([
          user?.name,
          user?.email,
          grupo,
          globalRole,
          roleInCourse,
          ...enrollmentCourses.map((e) => e.courseId),
          ...enrollmentCourses.map((e) => e.label),
          latestActivityAt,
        ]),
      };
    })
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'es'));

  return {
    columns: [
      {
        title: '',
        field: '__rowSelect',
        width: 30,
        minWidth: 30,
        headerSort: false,
        hozAlign: 'center',
        headerHozAlign: 'center',
        resizable: false,
        kind: 'row-select',
      },
      { title: 'Nombre', field: 'name', frozen: true, minWidth: 180, kind: 'editable-text' },
      { title: 'Email', field: 'email', minWidth: 220, kind: 'editable-text' },
      { title: 'Grupo', field: 'grupo', width: 58, minWidth: 58, maxWidth: 58, hozAlign: 'center', headerHozAlign: 'center', kind: 'grupo' },
      { title: 'Rol global', field: 'globalRole', width: 200, minWidth: 200, maxWidth: 200, hozAlign: 'center', headerHozAlign: 'center', kind: 'role' },
      { title: 'Inscripción', field: 'enrollmentSummary', width: 500, minWidth: 500, maxWidth: 500, kind: 'enrollment-courses' },
      { title: 'Última actividad', field: 'lastActivityAt', width: 250, minWidth: 250, maxWidth: 250, kind: 'relative-datetime' },
      { title: 'Acciones', field: '__adminActions', width: 250, minWidth: 250, maxWidth: 250, hozAlign: 'center', headerHozAlign: 'center', headerSort: false, kind: 'admin-actions' },
    ],
    rows,
    emptyMessage: 'No hay usuarios para mostrar en Admin.',
  };
}
