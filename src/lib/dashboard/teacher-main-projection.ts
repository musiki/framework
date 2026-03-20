import {
  buildSearchBlob,
  normalizeDashboardText,
  type DashboardAttendanceProjection,
  type DashboardGridColumn,
  type DashboardGridProjection,
} from './shared';

interface TeacherMainProjectionInput {
  overview: DashboardGridProjection;
  attendance: DashboardAttendanceProjection;
  gradebook: DashboardGridProjection;
}

const cloneColumn = (column: DashboardGridColumn): DashboardGridColumn => ({
  ...column,
  columns: Array.isArray(column.columns) ? column.columns.map(cloneColumn) : undefined,
  titleFormatterParams: column.titleFormatterParams
    ? { ...column.titleFormatterParams }
    : undefined,
});

const findFirstLeafField = (column: DashboardGridColumn | undefined): string => {
  if (!column) return '';
  if (column.field) return String(column.field);
  const children = Array.isArray(column.columns) ? column.columns : [];
  for (const child of children) {
    const field = findFirstLeafField(child);
    if (field) return field;
  }
  return '';
};

const getTeacherMainLessonSummaryField = (lessonIndex: number) =>
  `teacherMainGradebookSummary_${lessonIndex}`;

const formatProjectionAbletonLabel = (label: string): string => {
  const raw = String(label || '').trim();
  if (!raw) return '';
  const alphaChunks = raw.match(/[A-Za-zÀ-ÿ]+/g) || [];
  const lastNumberMatch = raw.match(/(\d+)(?!.*\d)/);
  const initials = alphaChunks.map((chunk) => chunk[0]?.toUpperCase() || '').join('');
  const suffix = lastNumberMatch ? String(parseInt(lastNumberMatch[1] || '0', 10)) : '';
  return `${initials}${suffix}`;
};

const makeFoldMeta = (
  column: DashboardGridColumn,
  params: {
    key: string;
    level: number;
    visibleChildren?: string[];
    disabled?: boolean;
    summaryOnly?: boolean;
    shortLabel?: string;
    fullLabel?: string;
  },
): DashboardGridColumn => ({
  ...column,
  titleFormatterParams: {
    ...(column.titleFormatterParams || {}),
    foldMeta: {
      // Keep leaf fold keys equal to their real field names so visibleChildren
      // can reference the stable data contract instead of synthetic ids.
      key: column.field ? String(column.field) : params.key,
      level: params.level,
      visibleChildren: Array.isArray(params.visibleChildren) ? params.visibleChildren : [],
      disabled: Boolean(params.disabled),
      summaryOnly: Boolean(params.summaryOnly),
      shortLabel: params.shortLabel ? String(params.shortLabel) : undefined,
      fullLabel: params.fullLabel ? String(params.fullLabel) : undefined,
    },
  },
});

const buildProfileColumns = (overviewColumns: DashboardGridColumn[]): DashboardGridColumn => {
  const extraWelcomeColumns = (overviewColumns || [])
    .filter((column) => String(column?.field || '').startsWith('welcome__'))
    .map((column, index) =>
      makeFoldMeta(
        {
          ...cloneColumn(column),
          kind: column.kind || 'text',
        },
        {
          key: `teacher_main_profile_welcome_${String(column.field || index)}`,
          level: 0,
        },
      ),
    );

  const profileFields: DashboardGridColumn[] = [
    { title: 'Apellido', field: 'lastName', minWidth: 132, kind: 'editable-text' },
    { title: 'Nombre', field: 'firstName', minWidth: 124, kind: 'editable-text' },
    { title: 'Email', field: 'email', minWidth: 220, kind: 'editable-text' },
    { title: 'Turno', field: 'turno', width: 38, minWidth: 38, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'turno' },
    { title: 'Grupo', field: 'grupo', width: 42, minWidth: 42, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'grupo' },
    ...extraWelcomeColumns,
    { title: 'Asist.%', field: 'attendanceRate', width: 104, minWidth: 96, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'attendance-progress' },
    { title: 'Entreg.', field: 'deliveriesDone', width: 84, minWidth: 78, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'metric' },
    { title: 'Pend.', field: 'deliveriesPending', width: 78, minWidth: 74, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'metric' },
    { title: 'Ult. act.', field: 'lastActivityAt', minWidth: 150, kind: 'datetime' },
  ].map((column, index) =>
    makeFoldMeta(column, {
      key: `profile_${column.field || index}`,
      level: 0,
    }),
  );

  return makeFoldMeta(
    {
      title: 'PROFILE',
      columns: profileFields,
    },
    {
      key: 'teacher_main_profile',
      level: 3,
      visibleChildren: ['lastName', 'turno', 'grupo'],
    },
  );
};

const buildAttendanceColumns = (summaryColumns: DashboardGridColumn[]): DashboardGridColumn => {
  const dayColumns = summaryColumns
    .filter((column) => String(column.field || '').startsWith('day_'))
    .map((column) =>
      makeFoldMeta(cloneColumn(column), {
        key: `attendance_${String(column.field || '')}`,
        level: 0,
      }),
    );

  const monthGroups = summaryColumns
    .filter((column) => Array.isArray(column.columns) && column.columns.length > 0)
    .map((column, index) =>
      makeFoldMeta(
        {
          ...cloneColumn(column),
          columns: (column.columns || []).map((child, childIndex) =>
            makeFoldMeta(cloneColumn(child), {
              key: `attendance_month_${index}_${String(child.field || childIndex)}`,
              level: 0,
            }),
          ),
        },
        {
          key: `teacher_main_attendance_month_${index}`,
          level: 1,
          disabled: true,
        },
      ),
    );

  const monthLeafFields = new Set(
    monthGroups.flatMap((group) =>
      (group.columns || []).map((child) => String(child.field || '')),
    ),
  );

  const remainingDays = dayColumns.filter((column) => {
    const field = String(column.field || '');
    return field && !monthLeafFields.has(field);
  });

  return makeFoldMeta(
    {
      title: 'ASISTENCIA',
      columns: [
        makeFoldMeta(
          {
            title: 'Inasistencias',
            field: 'absenceUnits',
            width: 120,
            minWidth: 112,
            maxWidth: 128,
            hozAlign: 'center' as const,
            headerHozAlign: 'center' as const,
            kind: 'absence',
          },
          {
            key: 'attendance_absence_units',
            level: 0,
            shortLabel: 'I',
          },
        ),
        ...monthGroups,
        ...remainingDays,
      ],
    },
    {
      key: 'teacher_main_attendance',
      level: 3,
      visibleChildren: ['absenceUnits'],
    },
  );
};

const buildGradebookColumns = (gradebookColumns: DashboardGridColumn[]): DashboardGridColumn => {
  const lessonColumns = gradebookColumns
    .slice(1)
    .map((lessonColumn, lessonIndex) => {
      const lessonChildren = Array.isArray(lessonColumn.columns) ? lessonColumn.columns : [];
      let lessonAnchorField = '';
      let preferredLessonAnchorField = '';

      const nextChildren = lessonChildren.map((childColumn, childIndex) => {
        const childClone = cloneColumn(childColumn);
        const isGroup = Array.isArray(childClone.columns) && childClone.columns.length > 0;
        if (!isGroup) {
          const childField = String(childClone.field || '');
          const isLessonAverage =
            String(childClone.cssClass || '').includes('dashboard-grade-lesson-avg')
            || childField === `__avg_lesson_${lessonIndex}`;
          if (isLessonAverage && childField) {
            preferredLessonAnchorField = childField;
          }
          if (!lessonAnchorField && childField) lessonAnchorField = childField;
          return makeFoldMeta(
            childClone,
            {
              key: `gradebook_lesson_${lessonIndex}_leaf_${childField || childIndex}`,
              level: 0,
              shortLabel: isLessonAverage
                ? formatProjectionAbletonLabel(`Promedio ${String(lessonColumn.title || `Clase ${lessonIndex + 1}`)}`)
                : undefined,
              fullLabel: childClone.title ? String(childClone.title) : undefined,
            },
          );
        }

        const groupLabel = normalizeDashboardText(childClone.title || childClone.headerTooltip || '');
        const groupChildren = (childClone.columns || []).map((grandChild, grandChildIndex) =>
          {
            const grandChildClone = cloneColumn(grandChild);
            const isGroupAverage = String(grandChildClone.cssClass || '').includes('dashboard-grade-sub-avg');
            const averageShortLabel = groupLabel
              ? formatProjectionAbletonLabel(groupLabel)
              : 'Pg';
            return makeFoldMeta(grandChildClone, {
              key: `gradebook_lesson_${lessonIndex}_group_${childIndex}_leaf_${String(grandChild.field || grandChildIndex)}`,
              level: 0,
              shortLabel: isGroupAverage ? averageShortLabel : undefined,
              fullLabel: isGroupAverage && groupLabel ? groupLabel : undefined,
            });
          },
        );
        const groupAnchorField = findFirstLeafField(
          groupChildren.find((grandChild) =>
            String(grandChild.cssClass || '').includes('dashboard-grade-sub-avg'),
          ) || groupChildren[0],
        );
        if (!lessonAnchorField && groupAnchorField) lessonAnchorField = groupAnchorField;

        return makeFoldMeta(
          {
            ...childClone,
            columns: groupChildren,
          },
          {
            key: `teacher_main_gradebook_lesson_${lessonIndex}_group_${childIndex}`,
            level: 1,
            visibleChildren: groupAnchorField ? [groupAnchorField] : [],
          },
        );
      });

      const fallbackLessonAnchor =
        preferredLessonAnchorField
        || lessonAnchorField
        || findFirstLeafField(nextChildren[0]);

      return makeFoldMeta(
        {
          ...cloneColumn(lessonColumn),
          columns: nextChildren,
        },
        {
          key: `teacher_main_gradebook_lesson_${lessonIndex}`,
          level: 2,
          visibleChildren: fallbackLessonAnchor ? [fallbackLessonAnchor] : [],
        },
        );
    });

  const lessonSummaryColumns = lessonColumns.map((lessonColumn, lessonIndex) =>
    makeFoldMeta(
      {
        title: `Promedio ${String(lessonColumn.title || `Clase ${lessonIndex + 1}`)}`,
        field: getTeacherMainLessonSummaryField(lessonIndex),
        width: 32,
        minWidth: 30,
        hozAlign: 'center' as const,
        headerHozAlign: 'center' as const,
        kind: 'score',
      },
      {
        key: `teacher_main_gradebook_summary_${lessonIndex}`,
        level: 0,
        summaryOnly: true,
        shortLabel:
          formatProjectionAbletonLabel(`Promedio ${String(lessonColumn.title || `Clase ${lessonIndex + 1}`)}`)
          || `P${lessonIndex + 1}`,
      },
    ),
  );

  const globalColumns = [
    makeFoldMeta(
      {
        title: 'Promedio total',
        field: 'average',
        width: 32,
        minWidth: 30,
        hozAlign: 'center' as const,
        headerHozAlign: 'center' as const,
        kind: 'score',
      },
      {
        key: 'teacher_main_gradebook_average',
        level: 0,
        shortLabel: 'PT',
      },
    ),
    makeFoldMeta(
      {
        title: 'Concepto',
        field: 'conceptValue',
        width: 32,
        minWidth: 30,
        hozAlign: 'center' as const,
        headerHozAlign: 'center' as const,
        kind: 'concepto',
      },
      {
        key: 'teacher_main_gradebook_concept',
        level: 0,
        shortLabel: 'Co',
      },
    ),
    makeFoldMeta(
      {
        title: 'Nota final',
        field: 'finalGrade',
        width: 32,
        minWidth: 30,
        hozAlign: 'center' as const,
        headerHozAlign: 'center' as const,
        kind: 'final-grade',
      },
      {
        key: 'teacher_main_gradebook_final_grade',
        level: 0,
        shortLabel: 'NF',
      },
    ),
    makeFoldMeta(
      {
        title: 'Notes',
        field: 'notesValue',
        minWidth: 138,
        width: 168,
        kind: 'notes',
      },
      {
        key: 'teacher_main_gradebook_notes',
        level: 0,
        shortLabel: 'N',
      },
    ),
  ];

  const topVisibleChildren = [
    ...globalColumns.map((column) => String(column.field || '')),
    ...lessonSummaryColumns.map((column) => String(column.field || '')),
  ].filter(Boolean);

  return makeFoldMeta(
    {
      title: 'GRADEBOOK',
      columns: [
        ...globalColumns,
        ...lessonSummaryColumns,
        ...lessonColumns,
      ],
    },
    {
      key: 'teacher_main_gradebook',
      level: 3,
      visibleChildren: topVisibleChildren,
    },
  );
};

const buildMergedRows = (
  overviewRows: Record<string, any>[],
  attendanceRows: Record<string, any>[],
  gradebookRows: Record<string, any>[],
) => {
  const rowsByStudentId = new Map<string, Record<string, any>>();
  const sourceRows = [overviewRows || [], attendanceRows || [], gradebookRows || []];

  sourceRows.forEach((rows) => {
    rows.forEach((row) => {
      const studentId = normalizeDashboardText(row?.studentId || row?.id || '');
      if (!studentId) return;

      const existing = rowsByStudentId.get(studentId) || {
        id: studentId,
        studentId,
        __searchParts: [] as string[],
        __gradeState: {},
        __attendanceCellMeta: {},
      };

      Object.assign(existing, row);
      if (row?.__gradeState && typeof row.__gradeState === 'object') {
        existing.__gradeState = {
          ...(existing.__gradeState || {}),
          ...row.__gradeState,
        };
      }
      if (row?.__attendanceCellMeta && typeof row.__attendanceCellMeta === 'object') {
        existing.__attendanceCellMeta = {
          ...(existing.__attendanceCellMeta || {}),
          ...row.__attendanceCellMeta,
        };
      }
      if (normalizeDashboardText(row?.__search)) {
        existing.__searchParts.push(normalizeDashboardText(row.__search));
      }

      rowsByStudentId.set(studentId, existing);
    });
  });

  return Array.from(rowsByStudentId.values())
    .map((row) => {
      const firstName = normalizeDashboardText(row.firstName || row.name || '—') || '—';
      const lastName = normalizeDashboardText(row.lastName || '');
      const email = normalizeDashboardText(row.email || '');
      const rowLabel = [lastName, firstName].filter(Boolean).join(' ').trim() || email || row.studentId;

      return {
        ...row,
        firstName,
        lastName,
        email,
        turno: normalizeDashboardText(row.turno || '—') || '—',
        grupo: normalizeDashboardText(row.grupo || '—') || '—',
        conceptValue: normalizeDashboardText(row.conceptValue || '—') || '—',
        notesValue: normalizeDashboardText(row.notesValue || '—') || '—',
        finalGrade: normalizeDashboardText(row.finalGrade || '—') || '—',
        wpoll: normalizeDashboardText(row.wpoll || '—') || '—',
        __search: buildSearchBlob([
          rowLabel,
          row.notesValue,
          row.finalGrade,
          ...(Array.isArray(row.__searchParts) ? row.__searchParts : []),
        ]),
      };
    })
    .sort((left, right) => {
      const lastNameDiff = String(left.lastName || '').localeCompare(String(right.lastName || ''), 'es');
      if (lastNameDiff !== 0) return lastNameDiff;
      return String(left.firstName || '').localeCompare(String(right.firstName || ''), 'es');
    });
};

export function buildTeacherMainProjection({
  overview,
  attendance,
  gradebook,
}: TeacherMainProjectionInput): DashboardGridProjection {
  const overviewColumns = Array.isArray(overview?.columns) ? overview.columns : [];
  const overviewRows = Array.isArray(overview?.rows) ? overview.rows : [];
  const attendanceSummaryColumns = Array.isArray(attendance?.summary?.columns) ? attendance.summary.columns : [];
  const attendanceSummaryRows = Array.isArray(attendance?.summary?.rows) ? attendance.summary.rows : [];
  const gradebookColumns = Array.isArray(gradebook?.columns) ? gradebook.columns : [];
  const gradebookRows = Array.isArray(gradebook?.rows) ? gradebook.rows : [];

  if (overviewRows.length === 0 && attendanceSummaryRows.length === 0 && gradebookRows.length === 0) {
    return {
      columns: [],
      rows: [],
      emptyMessage: overview?.emptyMessage || attendance?.summary?.emptyMessage || gradebook?.emptyMessage || 'No hay estudiantes para este curso y año.',
    };
  }

  const lessonCount = Math.max(0, gradebookColumns.length - 1);
  const rows = buildMergedRows(overviewRows, attendanceSummaryRows, gradebookRows).map((row) => {
    const nextRow = { ...row };
    for (let lessonIndex = 0; lessonIndex < lessonCount; lessonIndex += 1) {
      nextRow[getTeacherMainLessonSummaryField(lessonIndex)] = row[`__avg_lesson_${lessonIndex}`] ?? null;
    }
    return nextRow;
  });

  return {
    columns: [
      buildProfileColumns(overviewColumns),
      buildAttendanceColumns(attendanceSummaryColumns),
      buildGradebookColumns(gradebookColumns),
    ],
    rows,
    emptyMessage: overview?.emptyMessage || attendance?.summary?.emptyMessage || gradebook?.emptyMessage || 'No hay estudiantes para este curso y año.',
  };
}
