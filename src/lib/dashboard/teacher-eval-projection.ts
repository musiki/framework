import {
  buildSearchBlob,
  type DashboardGridProjection,
  normalizeDashboardText,
} from './shared';
import { getSubmissionAnswerText } from '../submission-table';

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
      const answerText = getSubmissionAnswerText(sub, allAssignmentsById);

      const payload = (sub?.payload && typeof sub.payload === 'object') ? sub.payload : {};
      const courseId = String(
        assignment?.courseId || payload?.courseId || payload?.audit?.courseId || '',
      ) || '—';
      // Type: from the synced Assignment if present, else inferred from the eval id.
      const evalId = String(sub?.assignmentId || '');
      const inferredType = /-(mcq)-/i.test(evalId) ? 'mcq'
        : /-(msq)-/i.test(evalId) ? 'msq'
        : /-(combinatoria)-/i.test(evalId) ? 'combinatoria'
        : /-(short[-_]?ai|reference[-_]?ai)-/i.test(evalId) ? 'short_ai'
        : /-(mcc)-/i.test(evalId) ? 'mcc'
        : /-(poll)-/i.test(evalId) ? 'poll'
        : /-(wordcloud)-/i.test(evalId) ? 'wordcloud'
        : /-(patch[-_]?ai)-/i.test(evalId) ? 'patch_ai'
        : '';
      const evalType = String(assignment?.evalType || payload?.type || inferredType || '—');

      return {
        id: sub.id,
        submittedAt: sub.submittedAt,
        userName: user?.name || user?.email || '—',
        email: user?.email || '—',
        courseId,
        evalType,
        assignmentLabel,
        assignmentId: sub.assignmentId,
        answerText,
        score: sub.score !== null && sub.score !== undefined ? sub.score : '—',
        feedback: sub.feedback || '—',
        __search: buildSearchBlob([
          user?.name,
          user?.email,
          courseId,
          evalType,
          assignmentLabel,
          sub.assignmentId,
          answerText,
          sub.feedback,
        ]),
      };
    })
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

  return {
    columns: [
      { title: 'Fecha', field: 'submittedAt', minWidth: 150, kind: 'datetime' },
      { title: 'Usuario', field: 'userName', minWidth: 170 },
      { title: 'Email', field: 'email', minWidth: 190 },
      { title: 'Curso', field: 'courseId', minWidth: 90 },
      { title: 'Tipo', field: 'evalType', minWidth: 110 },
      { title: 'Nota', field: 'assignmentLabel', minWidth: 150 },
      { title: 'ID Eval', field: 'assignmentId', minWidth: 120 },
      { title: 'Respuesta', field: 'answerText', minWidth: 220 },
      { title: 'Puntaje', field: 'score', width: 80, hozAlign: 'center', headerHozAlign: 'center' },
      { title: 'Feedback', field: 'feedback', minWidth: 180 },
    ],
    rows,
    emptyMessage: 'No hay entregas de evals registradas todavía.',
  };
}
