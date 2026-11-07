import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCohortTree, rowMatchesCohortFilter, cohortStats } from './admin-cohorts.mjs';

const courses = [
  { courseId: 'i2', title: 'Instrumento II' },
  { courseId: 'i1', title: 'Instrumento I' },
];
const cohorts = [
  { id: 1, courseId: 'i1', label: 'Histórica', isActive: false },
  { id: 2, courseId: 'i1', label: '2027', isActive: true },
  { id: 3, courseId: 'i2', label: 'Histórica', isActive: true },
];
const enrollments = [
  { id: 'e1', userId: 'u1', courseId: 'i1', roleInCourse: 'student', cohortId: 1 },
  { id: 'e2', userId: 'u2', courseId: 'i1', roleInCourse: 'student', cohortId: 2 },
  { id: 'e3', userId: 't1', courseId: 'i1', roleInCourse: 'teacher', cohortId: 2 },
  { id: 'e4', userId: 'u3', courseId: 'i1', roleInCourse: 'student', cohortId: null },
  { id: 'e5', userId: 'u1', courseId: 'i2', roleInCourse: 'student', cohortId: '3' },
];

describe('buildCohortTree', () => {
  const tree = buildCohortTree({ courses, cohorts, enrollments });

  test('materias ordenadas por título, con sus alumnos', () => {
    assert.deepEqual(tree.map((c) => c.courseId), ['i1', 'i2']);
    assert.equal(tree[0].students, 3);
    assert.equal(tree[1].students, 1);
  });

  test('cohortes: la activa primero, y sólo cuentan alumnos', () => {
    assert.deepEqual(tree[0].cohorts.map((c) => c.label), ['2027', 'Histórica']);
    assert.equal(tree[0].cohorts[0].students, 1);
    assert.equal(tree[0].cohorts[0].staff, 1);
  });

  test('las inscripciones sin cohorte se cuentan aparte, no se pierden', () => {
    assert.equal(tree[0].unassigned, 1);
    assert.equal(tree[1].unassigned, 0);
  });

  test('cohortId llega como texto o número desde la base y se compara igual', () => {
    assert.equal(tree[1].cohorts[0].students, 1);
  });

  test('una materia sin cohortes ni inscripciones igual aparece', () => {
    const t = buildCohortTree({ courses: [{ courseId: 'cym', title: 'CyM' }], cohorts: [], enrollments: [] });
    assert.deepEqual(t, [{ courseId: 'cym', title: 'CyM', students: 0, unassigned: 0, cohorts: [] }]);
  });
});

describe('rowMatchesCohortFilter', () => {
  const row = { enrollmentCourses: [{ courseId: 'i1', cohortId: '2' }, { courseId: 'i2', cohortId: '3' }] };

  test('sin filtro pasa todo', () => {
    assert.equal(rowMatchesCohortFilter(row, null), true);
  });
  test('por materia', () => {
    assert.equal(rowMatchesCohortFilter(row, { courseId: 'i1' }), true);
    assert.equal(rowMatchesCohortFilter(row, { courseId: 'cym' }), false);
  });
  test('por materia y cohorte, que tienen que coincidir en la misma inscripción', () => {
    assert.equal(rowMatchesCohortFilter(row, { courseId: 'i1', cohortId: 2 }), true);
    assert.equal(rowMatchesCohortFilter(row, { courseId: 'i1', cohortId: 3 }), false);
  });
  test('usa cohortMemberships, que no pierde a quien cursó dos años la misma materia', () => {
    const recursante = {
      enrollmentCourses: [{ courseId: 'i1', cohortId: '2' }],
      cohortMemberships: [{ courseId: 'i1', cohortId: '1' }, { courseId: 'i1', cohortId: '2' }],
    };
    assert.equal(rowMatchesCohortFilter(recursante, { courseId: 'i1', cohortId: 1 }), true);
  });
  test('"sin cohorte" encuentra las inscripciones huérfanas', () => {
    const huerfana = { enrollmentCourses: [{ courseId: 'i1', cohortId: '' }] };
    assert.equal(rowMatchesCohortFilter(huerfana, { courseId: 'i1', cohortId: 'none' }), true);
    assert.equal(rowMatchesCohortFilter(row, { courseId: 'i1', cohortId: 'none' }), false);
  });
});

describe('cohortStats', () => {
  const assignments = [
    { id: 'a1', courseId: 'i1', slug: 'x' },
    { id: 'a2', courseId: '', slug: 'i1/tp-2' },
    { id: 'a3', courseId: 'i2', slug: 'y' },
  ];
  const submissions = [
    { userId: 'u2', assignmentId: 'a1', submittedAt: '2027-03-10T10:00:00Z' },
    { userId: 'u2', assignmentId: 'a2', submittedAt: '2027-03-20T10:00:00Z' },
    { userId: 'u2', assignmentId: 'a3', submittedAt: '2027-04-01T10:00:00Z' },
    { userId: 'u1', assignmentId: 'a1', submittedAt: '2026-05-01T10:00:00Z' },
  ];
  const attendance = [
    { userId: 'u2', courseId: 'i1', sessionId: 's1', lastEventAt: '2027-03-25T10:00:00Z' },
    { userId: 'u2', courseId: 'i1', sessionId: 's2', lastEventAt: '2027-03-12T10:00:00Z' },
    { userId: 'u2', courseId: 'i2', sessionId: 's9', lastEventAt: '2027-05-01T10:00:00Z' },
  ];
  const stats = cohortStats({
    cohort: cohorts[1], enrollments, submissions, assignments, attendance,
  });

  test('cuenta gente de la cohorte', () => {
    assert.equal(stats.students, 1);
    assert.equal(stats.staff, 1);
  });
  test('entregas sólo de esta materia, resolviendo la materia por slug si falta courseId', () => {
    assert.equal(stats.submissions, 2);
    assert.equal(stats.studentsWithSubmission, 1);
  });
  test('clases con asistencia de la cohorte, sin repetir sesión', () => {
    assert.equal(stats.attendanceSessions, 2);
  });
  test('última actividad: lo más reciente entre entregas y asistencia de la materia', () => {
    assert.equal(stats.lastActivityAt, '2027-03-25T10:00:00Z');
  });
});
