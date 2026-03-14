import {
  asDashboardNumber,
  buildSearchBlob,
  fieldKeyFromId,
  splitDashboardName,
  type DashboardGridProjection,
} from './shared';

interface GradebookProjectionInput {
  activeCourseId: string;
  activeYear: string;
  teacherCourseGradeGroups: any[];
}

export function buildGradebookProjection({
  activeCourseId,
  activeYear,
  teacherCourseGradeGroups,
}: GradebookProjectionInput): DashboardGridProjection {
  if (!activeCourseId) {
    return {
      columns: [],
      rows: [],
      emptyMessage: 'Selecciona un curso para ver el gradebook.',
    };
  }

  const activeCourseGroup = (teacherCourseGradeGroups || []).find(
    (group: any) => String(group?.courseId || '') === String(activeCourseId || ''),
  );
  const activeYearGroup = (activeCourseGroup?.yearGroups || []).find(
    (group: any) => String(group?.year || '') === String(activeYear || ''),
  );
  const lessonGroups = Array.isArray(activeCourseGroup?.lessonGroups) ? activeCourseGroup.lessonGroups : [];

  const studentColumns = {
    title: 'Estudiante',
    field: '__group_student',
    columns: [
      { title: 'Apellido', field: 'lastName', width: 120, frozen: true, hozAlign: 'left' as const, headerHozAlign: 'left' as const },
      { title: 'Nombre', field: 'firstName', width: 120, hozAlign: 'left' as const, headerHozAlign: 'left' as const },
      { title: 'Email', field: 'email', width: 180, hozAlign: 'left' as const, headerHozAlign: 'left' as const },
      { title: 'Prom.', field: 'average', width: 65, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'score' },
      { title: 'Concepto', field: 'conceptValue', width: 85, hozAlign: 'center' as const, headerHozAlign: 'center' as const },
      { title: 'Turno', field: 'turno', width: 85, hozAlign: 'center' as const, headerHozAlign: 'center' as const },
      { title: 'Grupo', field: 'grupo', width: 85, hozAlign: 'center' as const, headerHozAlign: 'center' as const },
      { title: 'Asist.', field: 'attendanceCount', width: 65, hozAlign: 'center' as const, headerHozAlign: 'center' as const, kind: 'metric' },
    ]
  };

  const assignmentColumns = lessonGroups.map((lesson: any, lessonIndex: number) => {
    const lessonField = `__avg_lesson_${lessonIndex}`;
    
    const taskGroups: Record<string, any[]> = {};
    (lesson?.assignments || []).forEach((assignment: any) => {
      const g = String(assignment?.group || '').trim() || 'General';
      if (!taskGroups[g]) taskGroups[g] = [];
      taskGroups[g].push(assignment);
    });

    const groupColumns = Object.entries(taskGroups).map(([groupName, assignments], groupIndex) => {
      const groupField = `__avg_lesson_${lessonIndex}_group_${groupIndex}`;
      return {
        title: groupName,
        field: `__group_lesson_${lessonIndex}_task_${groupIndex}`,
        columns: [
          ...assignments.map((assignment: any) => ({
            title: String(assignment?.label || assignment?.id || 'Eval'),
            field: fieldKeyFromId('eval', assignment?.id),
            minWidth: 88,
            hozAlign: 'center' as const,
            headerHozAlign: 'center' as const,
            kind: 'grade-score',
            cssClass: lessonIndex % 2 === 0 ? 'dashboard-grade-col-even' : 'dashboard-grade-col-odd',
          })),
          {
            title: 'Sub-Prom.',
            field: groupField,
            width: 80,
            hozAlign: 'center' as const,
            headerHozAlign: 'center' as const,
            kind: 'score',
            cssClass: 'dashboard-grade-sub-avg',
          }
        ]
      };
    });

    return {
      title: String(lesson?.lessonLabel || 'Clase'),
      field: `__group_lesson_${lessonIndex}`,
      columns: [
        ...groupColumns,
        {
          title: 'Prom. Clase',
          field: lessonField,
          width: 90,
          hozAlign: 'center' as const,
          headerHozAlign: 'center' as const,
          kind: 'score',
          cssClass: 'dashboard-grade-lesson-avg',
        }
      ],
    };
  });

  const rows = (activeYearGroup?.rows || [])
    .map((row: any) => {
      const { firstName, lastName } = splitDashboardName(row?.name || row?.email || row?.studentId);
      const record: Record<string, any> = {
        id: String(row?.studentId || ''),
        studentId: String(row?.studentId || ''),
        firstName,
        lastName,
        name: String(row?.name || row?.email || row?.studentId || 'Estudiante'),
        email: String(row?.email || row?.studentId || ''),
        turno: String(row?.turnoValue || '—'),
        grupo: String(row?.groupValue || '—') || '—',
        attendanceCount: Number(row?.attendanceCount || 0),
        conceptValue: String(row?.conceptValue || '') || '—',
        average: asDashboardNumber(row?.average),
        __gradeState: {},
      };

      lessonGroups.forEach((lesson: any, lessonIndex: number) => {
        let lessonSum = 0;
        let lessonCount = 0;

        const taskGroups: Record<string, any[]> = {};
        (lesson?.assignments || []).forEach((assignment: any) => {
          const g = String(assignment?.group || '').trim() || 'General';
          if (!taskGroups[g]) taskGroups[g] = [];
          taskGroups[g].push(assignment);
        });

        Object.entries(taskGroups).forEach(([groupName, assignments], groupIndex) => {
          let groupSum = 0;
          let groupCount = 0;

          assignments.forEach((assignment: any) => {
            const field = fieldKeyFromId('eval', assignment?.id);
            const cell = row?.cells?.[assignment?.id] || null;
            const score = cell?.score !== null && cell?.score !== undefined && cell?.score !== ''
              ? Number(cell.score)
              : null;
            
            record[field] = score !== null ? asDashboardNumber(score) : null;
            record.__gradeState[field] = {
              statusLabel: String(cell?.statusLabel || ''),
              assignmentId: String(assignment?.id || ''),
            };

            if (score !== null) {
              groupSum += score;
              groupCount += 1;
              lessonSum += score;
              lessonCount += 1;
            }
          });

          const groupField = `__avg_lesson_${lessonIndex}_group_${groupIndex}`;
          record[groupField] = groupCount > 0 ? asDashboardNumber(groupSum / groupCount) : null;
        });

        const lessonField = `__avg_lesson_${lessonIndex}`;
        record[lessonField] = lessonCount > 0 ? asDashboardNumber(lessonSum / lessonCount) : null;
      });

      record.__search = buildSearchBlob([
        record.name,
        record.email,
        record.turno,
        record.grupo,
        record.conceptValue,
        record.attendanceCount,
        row?.average,
        ...lessonGroups.map((lesson: any) => lesson?.lessonLabel),
        ...lessonGroups.flatMap((lesson: any) =>
          (lesson?.assignments || []).map((assignment: any) => assignment?.label || assignment?.id),
        ),
      ]);

      return record;
    })
    .sort((left: any, right: any) => {
      const lastNameDiff = String(left.lastName || '').localeCompare(String(right.lastName || ''), 'es');
      if (lastNameDiff !== 0) return lastNameDiff;
      return String(left.firstName || '').localeCompare(String(right.firstName || ''), 'es');
    });

  return {
    columns: [
      studentColumns,
      ...assignmentColumns,
    ],
    rows,
    emptyMessage: 'No hay evaluaciones visibles para el curso y año seleccionados.',
  };
}
