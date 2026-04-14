import {
  buildSearchBlob,
  type DashboardGridProjection,
  normalizeDashboardText,
} from './shared';

interface TeacherEvalProjectionInput {
  submissions: any[];
  allUsersById: Map<string, any>;
  allAssignmentsById: Map<string, any>;
}

export function buildTeacherEvalProjection({
  submissions,
  allUsersById,
  allAssignmentsById,
}: TeacherEvalProjectionInput): DashboardGridProjection {
  const rows = (submissions || [])
    .map((sub: any) => {
      const user = allUsersById.get(String(sub?.userId || ''));
      const assignment = allAssignmentsById.get(String(sub?.assignmentId || ''));
      const assignmentSlug = String(assignment?.slug || sub?.assignmentId || '');
      const assignmentLabel = assignmentSlug.split('/').pop() || assignmentSlug;
      
      return {
        id: sub.id,
        submittedAt: sub.submittedAt,
        userName: user?.name || user?.email || '—',
        email: user?.email || '—',
        assignmentLabel,
        assignmentId: sub.assignmentId,
        score: sub.score !== null && sub.score !== undefined ? sub.score : '—',
        feedback: sub.feedback || '—',
        __search: buildSearchBlob([
          user?.name,
          user?.email,
          assignmentLabel,
          sub.assignmentId,
          sub.feedback,
        ]),
      };
    })
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

  return {
    columns: [
      { title: 'Fecha', field: 'submittedAt', minWidth: 150, kind: 'datetime' },
      { title: 'Docente', field: 'userName', minWidth: 180 },
      { title: 'Email', field: 'email', minWidth: 200 },
      { title: 'Clase', field: 'assignmentLabel', minWidth: 150 },
      { title: 'ID Eval', field: 'assignmentId', minWidth: 120 },
      { title: 'Puntaje', field: 'score', width: 80, hozAlign: 'center', headerHozAlign: 'center' },
      { title: 'Feedback', field: 'feedback', minWidth: 200 },
    ],
    rows,
    emptyMessage: 'No hay actividad de docentes registrada en evals para este curso.',
  };
}
