import {
  asDashboardNumber,
  buildSearchBlob,
  formatDashboardScore,
  type DashboardGridProjection,
  normalizeDashboardText,
} from './shared';

interface OverviewProjectionInput {
  activeCourseId: string;
  activeYear: string;
  attendanceRows: any[];
  attendanceSummaryRows: any[];
  submissions: any[];
  todayDateKey: string;
  teacherCourseGradeGroups: any[];
}

const formatPercent = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '';
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1).replace(/\.0$/, '')}%`;
};

const diffDays = (isoDate: string) => {
  const parsed = new Date(String(isoDate || ''));
  if (Number.isNaN(parsed.getTime())) return null;
  const now = Date.now();
  return Math.max(0, Math.floor((now - parsed.getTime()) / 86400000));
};

const isVisibleIdentityToken = (value: unknown) => {
  const normalized = normalizeDashboardText(value);
  return Boolean(normalized) && normalized !== '—';
};

export function buildOverviewProjection({
  activeCourseId,
  activeYear,
  attendanceRows,
  attendanceSummaryRows,
  submissions,
  todayDateKey,
  teacherCourseGradeGroups,
}: OverviewProjectionInput): DashboardGridProjection {
  if (!activeCourseId) {
    return {
      columns: [],
      rows: [],
      emptyMessage: 'Selecciona un curso para ver el overview.',
    };
  }

  const activeCourseGroup = (teacherCourseGradeGroups || []).find(
    (group: any) => String(group?.courseId || '') === String(activeCourseId || ''),
  );
  const activeYearGroup = (activeCourseGroup?.yearGroups || []).find(
    (group: any) => String(group?.year || '') === String(activeYear || ''),
  );
  const totalAssignments = Array.isArray(activeCourseGroup?.lessonGroups)
    ? activeCourseGroup.lessonGroups.flatMap((lesson: any) => lesson?.assignments || []).length
    : 0;

  const attendanceByStudentId = new Map(
    (attendanceRows || [])
      .filter((row: any) => String(row?.userId || '').trim())
      .map((row: any) => [String(row.userId), row]),
  );
  const attendanceSummaryByStudentId = new Map(
    (attendanceSummaryRows || [])
      .filter(
        (row: any) =>
          String(row?.userId || '').trim()
          && String(row?.role || '').trim().toLowerCase() !== 'teacher',
      )
      .map((row: any) => [String(row.userId), row]),
  );
  const gradebookByStudentId = new Map(
    (activeYearGroup?.rows || [])
      .filter((row: any) => String(row?.studentId || '').trim())
      .map((row: any) => [String(row.studentId), row]),
  );
  const submissionActivityByStudentId = new Map<string, string>();
  (submissions || []).forEach((submission: any) => {
    const studentId = String(submission?.userId || '').trim();
    const submittedAt = String(submission?.submittedAt || '').trim();
    if (!studentId || !submittedAt) return;
    const existing = submissionActivityByStudentId.get(studentId) || '';
    if (!existing || submittedAt > existing) {
      submissionActivityByStudentId.set(studentId, submittedAt);
    }
  });

  const studentIds = Array.from(
    new Set<string>([
      ...Array.from(attendanceByStudentId.keys()),
      ...Array.from(attendanceSummaryByStudentId.keys()),
      ...Array.from(gradebookByStudentId.keys()),
    ]),
  );

  const rows = studentIds
    .map((studentId) => {
      const attendanceRow = attendanceByStudentId.get(studentId) || {};
      const attendanceSummaryRow = attendanceSummaryByStudentId.get(studentId) || {};
      const gradebookRow = gradebookByStudentId.get(studentId) || {};
      const firstName = normalizeDashboardText(attendanceRow?.firstName || '');
      const lastName = normalizeDashboardText(attendanceRow?.lastName || '');
      const email = normalizeDashboardText(attendanceRow?.email || gradebookRow?.email || '');
      const gradebookName = normalizeDashboardText(gradebookRow?.name || '');
      const fallbackFirstName = !firstName && gradebookName && gradebookName !== '—'
        ? gradebookName
        : firstName;
      const averageNumber = asDashboardNumber(gradebookRow?.average);
      const absenceUnits = asDashboardNumber(attendanceRow?.absenceUnits) || 0;
      const attendanceCount = Number(
        gradebookRow?.attendanceCount
        || attendanceSummaryRow?.totalDaysAttended
        || 0,
      );
      const trackedAttendanceDays = Array.isArray(attendanceRow?.columns)
        ? attendanceRow.columns.filter((column: any) =>
            String(column?.dateKey || '').trim() && String(column.dateKey) <= String(todayDateKey || ''),
          ).length
        : 0;
      const attendanceRate = trackedAttendanceDays > 0
        ? Math.round((attendanceCount / trackedAttendanceDays) * 1000) / 10
        : null;
      const cells = gradebookRow?.cells && typeof gradebookRow.cells === 'object'
        ? Object.values(gradebookRow.cells)
        : [];
      const deliveriesDone = cells.filter(Boolean).length;
      const deliveriesPending = Math.max(0, totalAssignments - deliveriesDone);
      const reviewPending = cells.filter((cell: any) => String(cell?.statusLabel || '').trim().toLowerCase() === 'pendiente').length;
      const lastSubmissionAt = submissionActivityByStudentId.get(studentId) || '';
      const lastAttendanceAt = String(attendanceSummaryRow?.lastSeenAt || '').trim();
      const lastActivityAt = [lastSubmissionAt, lastAttendanceAt].filter(Boolean).sort().at(-1) || '';
      const lastActivityDays = diffDays(lastActivityAt);
      const risk =
        absenceUnits >= 4
        || (attendanceRate !== null && attendanceRate < 60)
        || deliveriesPending >= Math.max(2, Math.ceil(totalAssignments * 0.35))
        || (averageNumber !== null && averageNumber < 6)
        || (lastActivityDays !== null && lastActivityDays > 21)
          ? 'alto'
          : absenceUnits >= 3
            || (attendanceRate !== null && attendanceRate < 80)
            || deliveriesPending > 0
            || reviewPending > 0
            || (averageNumber !== null && averageNumber < 7)
            || (lastActivityDays !== null && lastActivityDays > 10)
            ? 'medio'
            : 'bajo';

      const hasReadableIdentity = [
        fallbackFirstName,
        lastName,
        email,
        gradebookName,
        attendanceRow?.name,
      ].some((value) => isVisibleIdentityToken(value));
      if (!hasReadableIdentity) return null;

      return {
        id: studentId,
        studentId,
        firstName: fallbackFirstName || '—',
        lastName,
        email,
        turno: normalizeDashboardText(attendanceRow?.turno || gradebookRow?.turnoValue || '—') || '—',
        grupo: normalizeDashboardText(attendanceRow?.grupo || gradebookRow?.groupValue || '—') || '—',
        attendanceCount,
        attendanceRate,
        attendanceRateDisplay: formatPercent(attendanceRate),
        deliveriesDone,
        deliveriesPending,
        absenceDisplay: normalizeDashboardText(attendanceRow?.absenceDisplay || '0') || '0',
        average: averageNumber,
        averageDisplay: formatDashboardScore(averageNumber),
        lastActivityAt,
        lastActivityLabel: normalizeDashboardText(
          attendanceSummaryRow?.lastSeenAt && lastActivityAt === lastAttendanceAt
            ? attendanceSummaryRow?.lastSeenLabel
            : lastActivityAt,
        ) || '—',
        risk,
        __search: buildSearchBlob([
          attendanceRow?.firstName,
          attendanceRow?.lastName,
          gradebookRow?.name,
          attendanceRow?.email,
          gradebookRow?.email,
          attendanceRow?.turno,
          gradebookRow?.turnoValue,
          attendanceRow?.grupo,
          gradebookRow?.groupValue,
          risk,
          attendanceRate,
          attendanceCount,
          deliveriesDone,
          deliveriesPending,
          attendanceRow?.absenceDisplay,
          gradebookRow?.average,
          lastActivityAt,
          attendanceSummaryRow?.lastSeenLabel,
        ]),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const lastNameDiff = String(left.lastName || '').localeCompare(String(right.lastName || ''), 'es');
      if (lastNameDiff !== 0) return lastNameDiff;
      return String(left.firstName || '').localeCompare(String(right.firstName || ''), 'es');
    });

  return {
    columns: [
      { title: 'Nombre', field: 'firstName', frozen: true, minWidth: 140 },
      { title: 'Apellido', field: 'lastName', frozen: true, minWidth: 150 },
      { title: 'Email', field: 'email', minWidth: 220 },
      { title: 'Turno', field: 'turno', width: 74, hozAlign: 'center', headerHozAlign: 'center', kind: 'turno' },
      { title: 'Grupo', field: 'grupo', width: 84, hozAlign: 'center', headerHozAlign: 'center', kind: 'grupo' },
      { title: 'Asist.%', field: 'attendanceRate', width: 92, hozAlign: 'center', headerHozAlign: 'center', kind: 'percent' },
      { title: 'Entreg.', field: 'deliveriesDone', width: 88, hozAlign: 'center', headerHozAlign: 'center', kind: 'metric' },
      { title: 'Pend.', field: 'deliveriesPending', width: 82, hozAlign: 'center', headerHozAlign: 'center', kind: 'metric' },
      { title: 'Prom.', field: 'average', width: 90, hozAlign: 'center', headerHozAlign: 'center', kind: 'score' },
      { title: 'Últ. act.', field: 'lastActivityAt', minWidth: 148, kind: 'datetime' },
      { title: 'Riesgo', field: 'risk', width: 96, hozAlign: 'center', headerHozAlign: 'center', kind: 'risk' },
    ],
    rows,
    emptyMessage: 'No hay estudiantes para el curso y año seleccionados.',
  };
}
