// Lógica pura del panel de cohortes del Admin: el árbol materia → cohorte que
// filtra la tabla, y la ficha con estadísticas de cada cohorte. Sin base de
// datos ni DOM, para poder testearla.

const limpiar = (v) => String(v ?? '').trim();
// cohortId llega como bigint serializado (texto) o como número según el camino.
const mismoId = (a, b) => limpiar(a) !== '' && limpiar(a) === limpiar(b);
const esAlumno = (e) => limpiar(e?.roleInCourse || 'student').toLowerCase() === 'student';

/** Valor de filtro para las inscripciones que todavía no tienen cohorte. */
export const SIN_COHORTE = 'none';

/**
 * Materias con sus cohortes y cuántos alumnos tiene cada nivel.
 *
 * Las inscripciones sin cohorte se cuentan en `unassigned` en vez de perderse:
 * son las que todavía no pasaron por el backfill o se cargaron por un camino que
 * no asigna cohorte.
 */
export function buildCohortTree({ courses = [], cohorts = [], enrollments = [] } = {}) {
  return courses
    .map((course) => {
      const courseId = limpiar(course.courseId);
      const deLaMateria = enrollments.filter((e) => limpiar(e.courseId) === courseId);
      const alumnos = deLaMateria.filter(esAlumno);
      const susCohortes = cohorts
        .filter((c) => limpiar(c.courseId) === courseId)
        .map((c) => {
          const gente = deLaMateria.filter((e) => mismoId(e.cohortId, c.id));
          return {
            id: limpiar(c.id),
            label: limpiar(c.label),
            isActive: Boolean(c.isActive),
            students: gente.filter(esAlumno).length,
            staff: gente.filter((e) => !esAlumno(e)).length,
          };
        })
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.label.localeCompare(a.label, 'es'));
      return {
        courseId,
        title: limpiar(course.title) || courseId,
        students: new Set(alumnos.map((e) => limpiar(e.userId))).size,
        unassigned: alumnos.filter((e) => limpiar(e.cohortId) === '').length,
        cohorts: susCohortes,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'es'));
}

/**
 * Si una fila del Admin entra en el filtro. Materia y cohorte tienen que
 * coincidir en la misma inscripción: alguien en I1·2027 e I2·Histórica no
 * aparece al filtrar I1·Histórica.
 */
export function rowMatchesCohortFilter(row, filter) {
  if (!filter || !limpiar(filter.courseId)) return true;
  const courseId = limpiar(filter.courseId);
  const cohortId = limpiar(filter.cohortId);
  // cohortMemberships trae todas las inscripciones; enrollmentCourses está
  // deduplicada por materia y perdería a quien cursó dos años la misma.
  return (row?.cohortMemberships || row?.enrollmentCourses || []).some((e) => {
    if (limpiar(e.courseId) !== courseId) return false;
    if (!cohortId) return true;
    if (cohortId === SIN_COHORTE) return limpiar(e.cohortId) === '';
    return mismoId(e.cohortId, cohortId);
  });
}

// Misma resolución que el resto del dashboard: courseId, o el primer segmento
// del slug. Hay Assignment viejos sin courseId.
const materiaDe = (registro) =>
  limpiar(registro?.courseId) || limpiar(registro?.slug || registro?.pageSlug).split('/').filter(Boolean)[0] || '';

/** Ficha de una cohorte: gente, entregas, asistencia y última actividad. */
export function cohortStats({ cohort, enrollments = [], submissions = [], assignments = [], attendance = [] } = {}) {
  const courseId = limpiar(cohort?.courseId);
  const gente = enrollments.filter((e) => limpiar(e.courseId) === courseId && mismoId(e.cohortId, cohort?.id));
  const alumnos = new Set(gente.filter(esAlumno).map((e) => limpiar(e.userId)));

  const materiaPorAssignment = new Map(assignments.map((a) => [limpiar(a.id), materiaDe(a)]));
  const entregas = submissions.filter((s) =>
    alumnos.has(limpiar(s.userId)) && materiaPorAssignment.get(limpiar(s.assignmentId)) === courseId);
  const asistencias = attendance.filter((a) => alumnos.has(limpiar(a.userId)) && materiaDe(a) === courseId);

  const fechas = [
    ...entregas.map((s) => limpiar(s.submittedAt)),
    ...asistencias.map((a) => limpiar(a.lastEventAt)),
  ].filter(Boolean).sort();

  return {
    students: alumnos.size,
    staff: gente.filter((e) => !esAlumno(e)).length,
    submissions: entregas.length,
    studentsWithSubmission: new Set(entregas.map((s) => limpiar(s.userId))).size,
    attendanceSessions: new Set(asistencias.map((a) => limpiar(a.sessionId))).size,
    lastActivityAt: fechas.at(-1) || '',
  };
}
