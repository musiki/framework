import {
  buildSearchBlob,
  formatDashboardAbsence,
  type DashboardAttendanceProjection,
} from './shared';

interface AttendanceProjectionInput {
  attendanceGridRows: any[];
  attendanceLogRows: any[];
  attendanceScheduleGrid: { columns?: any[] };
  todayDateKey: string;
}

const dateFieldKey = (dateKey: string) => `day_${String(dateKey || '').replaceAll('-', '_')}`;

const parseDateKey = (dateKey: string) => {
  const parsed = new Date(`${String(dateKey || '').trim()}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const formatAttendanceDayNumber = (dateKey: string) => {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return String(dateKey || '');
  return String(parsed.getUTCDate());
};

const capitalizeFirst = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : '';

const buildAttendanceDateColumns = (columns: any[] = []) => {
  const validColumns = (columns || []).filter((c) => {
    const dk = String(c?.dateKey || '').trim();
    return dk !== '' && dk !== 'undefined' && dk !== 'null';
  });

  const yearSet = new Set(
    validColumns
      .map((column) => parseDateKey(String(column?.dateKey || ''))?.getUTCFullYear())
      .filter((value): value is number => Number.isFinite(value)),
  );
  const showYear = yearSet.size > 1;
  const monthGroups = new Map<string, { title: string; columns: any[] }>();

  validColumns.forEach((column: any) => {
    const dateKey = String(column?.dateKey || '');
    const parsed = parseDateKey(dateKey);
    const monthKey = parsed
      ? `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`
      : `unknown-${dateKey}`;
    const monthTitle = parsed
      ? `${capitalizeFirst(parsed.toLocaleDateString('es-ES', { month: 'long', timeZone: 'UTC' }))}${showYear ? ` ${parsed.getUTCFullYear()}` : ''}`
      : 'Sin mes';

    if (!monthGroups.has(monthKey)) {
      monthGroups.set(monthKey, {
        title: monthTitle,
        columns: [],
      });
    }

    monthGroups.get(monthKey)?.columns.push({
      title: formatAttendanceDayNumber(dateKey),
      field: dateFieldKey(dateKey),
      dateKey,
      kind: 'attendance-day',
      width: 44,
      minWidth: 44,
      maxWidth: 50,
      hozAlign: 'center' as const,
      headerHozAlign: 'center' as const,
      cssClass: 'dashboard-attendance-day-col',
      headerSort: false,
    });
  });

  return Array.from(monthGroups.values()).map((group) => ({
    title: group.title,
    cssClass: 'dashboard-attendance-month-group',
    headerHozAlign: 'center' as const,
    columns: group.columns,
  }));
};

export function buildAttendanceProjection({
  attendanceGridRows,
  attendanceLogRows,
  attendanceScheduleGrid,
  todayDateKey,
}: AttendanceProjectionInput): DashboardAttendanceProjection {
  const summaryColumns = [
    { title: 'Nombre', field: 'firstName', frozen: true, minWidth: 124 },
    { title: 'Apellido', field: 'lastName', frozen: true, minWidth: 138 },
    { title: 'Turno', field: 'turno', width: 68, minWidth: 62, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'turno' },
    { title: 'Grupo', field: 'grupo', width: 72, minWidth: 66, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'grupo' },
    { title: 'Attendance', field: 'attendanceRate', width: 120, minWidth: 108, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'attendance-progress' },
    { title: 'Inasist.', field: 'absenceDisplay', width: 88, minWidth: 82, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'absence' },
    { title: 'Email', field: 'email', minWidth: 186 },
    ...buildAttendanceDateColumns(attendanceScheduleGrid?.columns || []),
  ];

  const summaryRows = (attendanceGridRows || []).map((row: any) => {
    const scheduledColumns = Array.isArray(row?.columns) ? row.columns : [];
    const scheduledDayCount = scheduledColumns.length;
    const attendedUnits = scheduledColumns.reduce(
      (sum: number, column: any) => sum + Math.max(0, Number(column?.effectiveValue || 0)),
      0,
    );
    const attendanceRate = scheduledDayCount > 0
      ? Math.round((attendedUnits / scheduledDayCount) * 1000) / 10
      : 0;

    const record: Record<string, any> = {
      id: String(row?.userId || ''),
      studentId: String(row?.userId || ''),
      firstName: String(row?.firstName || '—'),
      lastName: String(row?.lastName || ''),
      turno: String(row?.turno || '—'),
      grupo: String(row?.grupo || '—'),
      attendanceRate,
      attendanceCount: attendedUnits,
      attendanceTotalCount: scheduledDayCount,
      absenceUnits: Number(row?.absenceUnits || 0),
      absenceDisplay: formatDashboardAbsence(row?.absenceUnits),
      email: String(row?.email || ''),
      __attendanceCellMeta: {},
    };

    (row?.columns || []).forEach((column: any) => {
      const field = dateFieldKey(String(column?.dateKey || ''));
      record[field] = String(column?.displayValue || '');
      record.__attendanceCellMeta[field] = {
        dateKey: String(column?.dateKey || ''),
        title: String(column?.title || ''),
        liveValue: Number(column?.liveValue || 0),
        manualValue: Number(column?.manualValue || 0),
        effectiveValue: Number(column?.effectiveValue || 0),
        hasManualOverride: Boolean(column?.hasManualOverride),
        countsTowardAbsence: String(column?.dateKey || '') <= String(todayDateKey || ''),
        isFuture: String(column?.dateKey || '') > String(todayDateKey || ''),
      };
    });

    record.__search = buildSearchBlob([
      record.firstName,
      record.lastName,
      record.turno,
      record.grupo,
      `${attendanceRate}%`,
      attendedUnits,
      scheduledDayCount,
      record.email,
      record.absenceDisplay,
    ]);

    return record;
  });

  const logColumns = [
    { title: 'Dia', field: 'dayLabel', minWidth: 120 },
    { title: 'Usuario', field: 'displayName', minWidth: 180 },
    { title: 'Email', field: 'email', minWidth: 220 },
    { title: 'Clase', field: 'lessonLabel', minWidth: 180 },
    { title: 'Rol', field: 'roleLabel', width: 90, hozAlign: 'center' as const, headerHozAlign: 'center' as const },
    { title: 'Conex.', field: 'joinCount', width: 80, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'metric' },
    { title: 'Salidas', field: 'leaveCount', width: 86, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'metric' },
    { title: 'Tiempo', field: 'durationLabel', width: 96, hozAlign: 'center' as const, headerHozAlign: 'center' as const },
    { title: 'Ultima actividad', field: 'lastSeenLabel', minWidth: 150 },
  ];

  const logRows = (attendanceLogRows || []).map((row: any) => ({
    id: String(row?.id || `${row?.sessionId || 'session'}::${row?.displayName || row?.email || 'row'}`),
    dayLabel: String(row?.dayLabel || '—'),
    displayName: String(row?.displayName || '—'),
    email: String(row?.email || row?.identity || '—'),
    lessonLabel: String(row?.lessonLabel || '—'),
    roleLabel: String(row?.role === 'teacher' ? 'Teacher' : 'Student'),
    joinCount: Number(row?.joinCount || 0),
    leaveCount: Number(row?.leaveCount || 0),
    durationLabel: String(row?.durationLabel || '—'),
    lastSeenLabel: String(row?.lastSeenLabel || '—'),
    __search: buildSearchBlob([
      row?.dayLabel,
      row?.displayName,
      row?.email,
      row?.identity,
      row?.lessonLabel,
      row?.role,
      row?.joinCount,
      row?.leaveCount,
      row?.durationLabel,
      row?.lastSeenLabel,
    ]),
  }));

  return {
    summary: {
      columns: summaryColumns,
      rows: summaryRows,
      emptyMessage: 'No hay registros de asistencia para el curso y año seleccionados.',
    },
    log: {
      columns: logColumns,
      rows: logRows,
      emptyMessage: 'No hay eventos de conexión para el curso y año seleccionados.',
    },
  };
}
