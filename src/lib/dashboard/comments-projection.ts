import {
  dashboardAnnotationColorLabel,
  dashboardAnnotationVisibilityLabel,
  type DashboardAnnotationRecord,
} from './annotations';
import { buildSearchBlob, type DashboardGridProjection } from './shared';

interface CommentsProjectionInput {
  annotations: DashboardAnnotationRecord[];
}

export function buildCommentsProjection({
  annotations,
}: CommentsProjectionInput): DashboardGridProjection {
  const rows = (annotations || [])
    .map((annotation) => {
      const scopeLabel = String(
        annotation?.metadata?.scopeLabel
          || annotation?.metadata?.columnLabel
          || annotation?.field
          || annotation?.scopeRef
          || '',
      ).trim();
      const studentLabel = String(
        annotation?.metadata?.rowLabel
          || annotation?.metadata?.studentName
          || annotation?.subjectUserId
          || '—',
      ).trim();
      const tabLabel = String(
        annotation?.metadata?.tabLabel
          || annotation?.tab
          || '',
      ).trim();

      return {
        id: String(annotation?.id || ''),
        studentLabel,
        tabLabel: tabLabel || '—',
        scopeLabel: scopeLabel || '—',
        colorLabel: dashboardAnnotationColorLabel(annotation?.color || ''),
        color: annotation?.color || '',
        comment: String(annotation?.comment || '').trim() || '—',
        visibilityLabel: dashboardAnnotationVisibilityLabel(annotation?.visibility || 'teachers'),
        authorName: String(annotation?.authorName || annotation?.authorEmail || annotation?.authorUserId || '—'),
        updatedAt: String(annotation?.updatedAt || annotation?.createdAt || ''),
        updatedAtLabel: String(annotation?.metadata?.updatedAtLabel || annotation?.updatedAt || '—'),
        __search: buildSearchBlob([
          studentLabel,
          tabLabel,
          scopeLabel,
          annotation?.color,
          annotation?.comment,
          annotation?.visibility,
          annotation?.authorName,
          annotation?.authorEmail,
          annotation?.updatedAt,
        ]),
      };
    })
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''), 'es'));

  return {
    columns: [
      { title: 'Estudiante', field: 'studentLabel', frozen: true, minWidth: 180 },
      { title: 'Tab', field: 'tabLabel', width: 110, hozAlign: 'center', headerHozAlign: 'center' },
      { title: 'Scope', field: 'scopeLabel', minWidth: 180 },
      { title: 'Color', field: 'color', width: 96, hozAlign: 'center', headerHozAlign: 'center', kind: 'annotation-color' },
      { title: 'Comentario', field: 'comment', minWidth: 280 },
      { title: 'Visibilidad', field: 'visibilityLabel', width: 120, hozAlign: 'center', headerHozAlign: 'center' },
      { title: 'Autor', field: 'authorName', minWidth: 160 },
      { title: 'Actualizado', field: 'updatedAtLabel', minWidth: 152 },
    ],
    rows,
    emptyMessage: 'Todavía no hay comentarios operativos para este curso y año.',
  };
}
