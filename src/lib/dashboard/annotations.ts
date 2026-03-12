export const DASHBOARD_ANNOTATION_COLORS = [
  'red',
  'coral',
  'orange',
  'yellow',
  'lime',
  'green',
  'cyan',
  'blue',
] as const;

export const DASHBOARD_ANNOTATION_VISIBILITIES = ['private', 'teachers'] as const;

export const DASHBOARD_ANNOTATION_SCOPE_TYPES = [
  'overview_cell',
  'gradebook_cell',
  'attendance_cell',
  'admin_cell',
] as const;

export type DashboardAnnotationColor = (typeof DASHBOARD_ANNOTATION_COLORS)[number];
export type DashboardAnnotationVisibility = (typeof DASHBOARD_ANNOTATION_VISIBILITIES)[number];
export type DashboardAnnotationScopeType = (typeof DASHBOARD_ANNOTATION_SCOPE_TYPES)[number];

export interface DashboardAnnotationRecord {
  id: string;
  courseId: string;
  year: string;
  subjectUserId: string;
  field: string;
  tab: string;
  scopeType: DashboardAnnotationScopeType;
  scopeRef: string;
  color: DashboardAnnotationColor | '';
  comment: string;
  visibility: DashboardAnnotationVisibility;
  authorUserId: string;
  authorName: string;
  authorEmail: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, any>;
}

export const normalizeDashboardAnnotationColor = (value: unknown): DashboardAnnotationColor | '' => {
  const normalized = String(value || '').trim().toLowerCase();
  return DASHBOARD_ANNOTATION_COLORS.includes(normalized as DashboardAnnotationColor)
    ? (normalized as DashboardAnnotationColor)
    : '';
};

export const normalizeDashboardAnnotationVisibility = (
  value: unknown,
): DashboardAnnotationVisibility => {
  const normalized = String(value || '').trim().toLowerCase();
  return DASHBOARD_ANNOTATION_VISIBILITIES.includes(normalized as DashboardAnnotationVisibility)
    ? (normalized as DashboardAnnotationVisibility)
    : 'teachers';
};

export const normalizeDashboardAnnotationScopeType = (
  value: unknown,
): DashboardAnnotationScopeType | '' => {
  const normalized = String(value || '').trim().toLowerCase();
  return DASHBOARD_ANNOTATION_SCOPE_TYPES.includes(normalized as DashboardAnnotationScopeType)
    ? (normalized as DashboardAnnotationScopeType)
    : '';
};

export const normalizeDashboardAnnotationComment = (value: unknown, maxLength = 4000) =>
  String(value || '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);

export const buildDashboardAnnotationScopeKey = (
  scopeType: DashboardAnnotationScopeType | string,
  scopeRef: string,
) => `${String(scopeType || '').trim()}::${String(scopeRef || '').trim()}`;

export const dashboardAnnotationColorLabel = (color: DashboardAnnotationColor | '') => {
  switch (color) {
    case 'red':
      return 'Rojo';
    case 'coral':
      return 'Coral';
    case 'orange':
      return 'Naranja';
    case 'yellow':
      return 'Amarillo';
    case 'lime':
      return 'Lima';
    case 'green':
      return 'Verde';
    case 'cyan':
      return 'Cian';
    case 'blue':
      return 'Azul';
    default:
      return 'Sin color';
  }
};

export const dashboardAnnotationVisibilityLabel = (value: DashboardAnnotationVisibility | string) =>
  String(value || '').trim().toLowerCase() === 'private' ? 'Privado' : 'Teachers';
