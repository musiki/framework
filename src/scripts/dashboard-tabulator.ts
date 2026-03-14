import { createClient } from '@supabase/supabase-js';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import {
  buildDashboardAnnotationScopeKey,
  DASHBOARD_ANNOTATION_COLORS,
  dashboardAnnotationColorLabel,
  dashboardAnnotationVisibilityLabel,
  normalizeDashboardAnnotationColor,
  normalizeDashboardAnnotationComment,
  normalizeDashboardAnnotationVisibility,
  type DashboardAnnotationColor,
  type DashboardAnnotationRecord,
  type DashboardAnnotationScopeType,
  type DashboardAnnotationVisibility,
} from '../lib/dashboard/annotations';

type GridProjection = {
  columns: any[];
  rows: Record<string, any>[];
  emptyMessage?: string;
};

type AttendanceProjection = {
  summary: GridProjection;
  log: GridProjection;
};

type DashboardMeta = {
  userId?: string;
  courseId?: string;
  year?: string;
  initialTeacherTab?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
};

type GridKind =
  | 'overview'
  | 'gradebook'
  | 'attendance-summary'
  | 'attendance-log'
  | 'comments'
  | 'admin';

type CellScopeContext = {
  tab: 'overview' | 'gradebook' | 'attendance' | 'admin';
  tabLabel: string;
  scopeType: DashboardAnnotationScopeType;
  scopeRef: string;
  subjectUserId: string;
  field: string;
  rowLabel: string;
  columnLabel: string;
  metadata: Record<string, any>;
};

type AnnotationState = {
  annotations: DashboardAnnotationRecord[];
  annotationsByScope: Map<string, DashboardAnnotationRecord[]>;
  registry: Map<string, Tabulator>;
  selectedContext: CellScopeContext | null;
  selectedCellEl: HTMLElement | null;
  currentUserId: string;
  meta: DashboardMeta;
};

type AnnotationModalApi = {
  open: (context: CellScopeContext) => void;
  destroy: () => void;
};

type RangeSelectionState = {
  anchorCell: any | null;
  dragging: boolean;
  movedDuringDrag: boolean;
  preserveExisting: boolean;
  suppressClickUntil: number;
  selectedCells: Set<any>;
  selectedElements: Set<HTMLElement>;
  bodyClassApplied: boolean;
};

const SEARCH_DEBOUNCE_MS = 150;
const VALID_TEACHER_TABS = ['overview', 'gradebook', 'attendance', 'comments', 'admin'];
const DASHBOARD_PROJECTION_SCRIPT_IDS = [
  'dashboard-teacher-tabulator-meta',
  'dashboard-teacher-overview',
  'dashboard-teacher-gradebook',
  'dashboard-teacher-attendance',
  'dashboard-teacher-comments',
  'dashboard-teacher-admin',
  'dashboard-teacher-annotations',
];

declare global {
  interface Window {
    __musikiDashboardRemount?: () => void;
  }
}

const parseJsonScript = <T>(id: string, fallback: T): T => {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLScriptElement)) return fallback;

  try {
    return (JSON.parse(node.textContent || 'null') ?? fallback) as T;
  } catch {
    return fallback;
  }
};

const normalizeText = (value: unknown) => String(value ?? '').trim();
const normalizeTextLower = (value: unknown) => normalizeText(value).toLowerCase();

const formatScore = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1).replace(/\.0$/, '');
};

const formatAbsence = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '0';
  const normalized = Math.round(parsed * 2) / 2;
  return Number.isInteger(normalized)
    ? String(normalized)
    : normalized.toFixed(1).replace(/\.0$/, '');
};

const formatDateTime = (value: unknown) => {
  const raw = normalizeText(value);
  if (!raw) return '—';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatPercentLabel = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0%';
  const normalized = Math.max(0, Math.min(100, parsed));
  return Number.isInteger(normalized)
    ? `${normalized}%`
    : `${normalized.toFixed(1).replace(/\.0$/, '')}%`;
};

const formatAttendanceSymbol = (value: unknown, options: { isFuture?: boolean } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return options.isFuture ? '' : '✖';
  }
  if (options.isFuture && parsed <= 0) return '';
  if (parsed >= 1) return '✔';
  if (parsed > 0) return '~';
  return '✖';
};

const normalizeAttendanceInput = (value: unknown) => {
  const raw = normalizeText(String(value ?? '').replace(',', '.')).toLowerCase();
  if (!raw) {
    return {
      valid: true,
      count: null as number | null,
      displayValue: '',
      countRaw: '',
    };
  }

  if (raw === '/' || raw === '1' || raw === '✔') {
    return {
      valid: true,
      count: 1,
      displayValue: '✔',
      countRaw: '1',
    };
  }

  if (raw === '-' || raw === '~' || raw === '0.5' || raw === '.5') {
    return {
      valid: true,
      count: 0.5,
      displayValue: '~',
      countRaw: '0.5',
    };
  }

  if (raw === 'x' || raw === '0' || raw === '✖') {
    return {
      valid: true,
      count: 0,
      displayValue: '✖',
      countRaw: '0',
    };
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return {
      valid: false,
      count: null as number | null,
      displayValue: '',
      countRaw: raw,
    };
  }

  const clamped = Math.max(0, Math.min(1, parsed));
  const normalized = Math.round(clamped * 2) / 2;
  if (Math.abs(normalized - parsed) > 0.000001) {
    return {
      valid: false,
      count: null as number | null,
      displayValue: '',
      countRaw: raw,
    };
  }

  return {
    valid: true,
    count: normalized,
    displayValue: formatAttendanceSymbol(normalized),
    countRaw: String(normalized),
  };
};

const debounce = <T extends (...args: any[]) => void>(callback: T, waitMs: number) => {
  let timeoutId: number | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      callback(...args);
    }, waitMs);
  };
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const buildPersistKey = (meta: DashboardMeta, tabName: string) =>
  `musiki:dashboard:${normalizeText(meta?.userId || 'anon')}:${normalizeText(meta?.courseId || 'sin-curso')}:${normalizeText(meta?.year || 'sin-anio')}:${tabName}`;

const isApplePlatform = () =>
  /mac|iphone|ipad|ipod/i.test(
    String(window.navigator.platform || window.navigator.userAgent || ''),
  );

const getCommentShortcutLabel = () =>
  isApplePlatform() ? 'M' : 'Ctrl + Alt + M';

const getTurnoTitle = (value: unknown) => {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === 'T') return 'Tarde';
  if (normalized === 'N') return 'Noche';
  return 'Mañana';
};

const normalizeGrupoDigits = (value: unknown) => {
  const digits = String(value ?? '').replace(/\D+/g, '').slice(0, 2);
  if (!digits) return '';
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return '';
  return String(Math.min(99, Math.max(0, Math.trunc(parsed)))).padStart(2, '0');
};

const getStoredSearchQuery = (persistKey: string) => {
  try {
    return window.localStorage.getItem(`${persistKey}:search`) || '';
  } catch {
    return '';
  }
};

const setStoredSearchQuery = (persistKey: string, value: string) => {
  try {
    window.localStorage.setItem(`${persistKey}:search`, value);
  } catch {
    // ignore storage write failures
  }
};

const buildCommentsRowsFromAnnotations = (annotations: DashboardAnnotationRecord[]) =>
  [...(annotations || [])]
    .map((annotation) => ({
      id: String(annotation?.id || ''),
      studentLabel: normalizeText(
        annotation?.metadata?.rowLabel
          || annotation?.metadata?.studentName
          || annotation?.subjectUserId
          || '—',
      ) || '—',
      tabLabel: normalizeText(annotation?.metadata?.tabLabel || annotation?.tab || '—') || '—',
      scopeLabel: normalizeText(
        annotation?.metadata?.scopeLabel
          || annotation?.metadata?.columnLabel
          || annotation?.field
          || annotation?.scopeRef
          || '—',
      ) || '—',
      color: normalizeDashboardAnnotationColor(annotation?.color),
      comment: normalizeText(annotation?.comment) || '—',
      visibilityLabel: dashboardAnnotationVisibilityLabel(annotation?.visibility || 'teachers'),
      authorName: normalizeText(annotation?.authorName || annotation?.authorEmail || annotation?.authorUserId || '—') || '—',
      updatedAt: normalizeText(annotation?.updatedAt || annotation?.createdAt),
      updatedAtLabel: normalizeText(
        annotation?.metadata?.updatedAtLabel
          || formatDateTime(annotation?.updatedAt || annotation?.createdAt),
      ) || '—',
      __search: [
        annotation?.metadata?.rowLabel,
        annotation?.metadata?.scopeLabel,
        annotation?.metadata?.columnLabel,
        annotation?.tab,
        annotation?.color,
        annotation?.comment,
        annotation?.visibility,
        annotation?.authorName,
        annotation?.authorEmail,
      ]
        .map((value) => normalizeTextLower(value))
        .filter(Boolean)
        .join(' '),
    }))
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''), 'es'));

const isAnnotationContextKind = (kind: GridKind) =>
  ['overview', 'gradebook', 'attendance-summary', 'admin'].includes(kind);

const tabLabelByKind = (kind: GridKind) => {
  switch (kind) {
    case 'overview':
      return 'Overview';
    case 'gradebook':
      return 'Gradebook';
    case 'attendance-summary':
      return 'Attendance';
    case 'admin':
      return 'Admin';
    default:
      return kind;
  }
};

const buildScopeContextFromCell = (cell: any, tableKind: GridKind): CellScopeContext | null => {
  if (!isAnnotationContextKind(tableKind)) return null;

  const rowData = cell.getData?.() || {};
  const field = normalizeText(cell.getField?.() || '');
  if (!field || field.startsWith('__')) return null;

  const columnDef = cell.getColumn?.()?.getDefinition?.() || {};
  const columnLabel = normalizeText(columnDef?.title || field) || field;
  const rowLabel = normalizeText(
    rowData?.name
      || rowData?.displayName
      || `${normalizeText(rowData?.firstName)} ${normalizeText(rowData?.lastName)}`.trim()
      || rowData?.studentLabel
      || rowData?.email
      || rowData?.userId
      || rowData?.studentId
      || rowData?.subjectUserId,
  ) || 'Registro';
  const subjectUserId = normalizeText(rowData?.studentId || rowData?.userId || rowData?.subjectUserId || '');

  if (!subjectUserId) return null;

  if (tableKind === 'overview') {
    return {
      tab: 'overview',
      tabLabel: 'Overview',
      scopeType: 'overview_cell',
      scopeRef: `${subjectUserId}::${field}`,
      subjectUserId,
      field,
      rowLabel,
      columnLabel,
      metadata: {},
    };
  }

  if (tableKind === 'gradebook') {
    const assignmentId = normalizeText(rowData?.__gradeState?.[field]?.assignmentId || field);
    return {
      tab: 'gradebook',
      tabLabel: 'Gradebook',
      scopeType: 'gradebook_cell',
      scopeRef: `${subjectUserId}::${assignmentId || field}`,
      subjectUserId,
      field,
      rowLabel,
      columnLabel,
      metadata: {
        assignmentId,
      },
    };
  }

  if (tableKind === 'attendance-summary') {
    const dateKey = normalizeText(columnDef?.dateKey || rowData?.__attendanceCellMeta?.[field]?.dateKey || field);
    return {
      tab: 'attendance',
      tabLabel: 'Attendance',
      scopeType: 'attendance_cell',
      scopeRef: `${subjectUserId}::${dateKey || field}`,
      subjectUserId,
      field,
      rowLabel,
      columnLabel,
      metadata: {
        dateKey,
      },
    };
  }

  if (tableKind === 'admin') {
    return {
      tab: 'admin',
      tabLabel: 'Admin',
      scopeType: 'admin_cell',
      scopeRef: `${subjectUserId}::${field}`,
      subjectUserId,
      field,
      rowLabel,
      columnLabel,
      metadata: {},
    };
  }

  return null;
};

const indexAnnotationsByScope = (
  annotations: DashboardAnnotationRecord[],
  currentUserId: string,
) => {
  const map = new Map<string, DashboardAnnotationRecord[]>();
  (annotations || []).forEach((annotation) => {
    const key = buildDashboardAnnotationScopeKey(annotation.scopeType, annotation.scopeRef);
    if (!map.has(key)) map.set(key, []);
    map.get(key)?.push(annotation);
  });

  map.forEach((list, key) => {
    list.sort((left, right) => {
      const leftOwn = normalizeText(left.authorUserId) === normalizeText(currentUserId) ? 1 : 0;
      const rightOwn = normalizeText(right.authorUserId) === normalizeText(currentUserId) ? 1 : 0;
      if (leftOwn !== rightOwn) return rightOwn - leftOwn;
      return String(right.updatedAt || right.createdAt || '').localeCompare(
        String(left.updatedAt || left.createdAt || ''),
        'es',
      );
    });
    map.set(key, list);
  });

  return map;
};

const getScopeAnnotations = (state: AnnotationState, context: CellScopeContext) =>
  state.annotationsByScope.get(buildDashboardAnnotationScopeKey(context.scopeType, context.scopeRef)) || [];

const getOwnAnnotation = (state: AnnotationState, context: CellScopeContext) =>
  getScopeAnnotations(state, context).find(
    (annotation) => normalizeText(annotation.authorUserId) === normalizeText(state.currentUserId),
  ) || null;

const getDisplayAnnotation = (state: AnnotationState, context: CellScopeContext) =>
  getScopeAnnotations(state, context)[0] || null;

const setAnnotations = (state: AnnotationState, annotations: DashboardAnnotationRecord[]) => {
  state.annotations = [...annotations];
  state.annotationsByScope = indexAnnotationsByScope(state.annotations, state.currentUserId);
};

const refreshAnnotationViews = (state: AnnotationState) => {
  state.registry.forEach((table, key) => {
    if (key === 'comments') {
      void table.replaceData(buildCommentsRowsFromAnnotations(state.annotations));
      return;
    }
    table.redraw(true);
  });
};

const upsertAnnotationInState = (state: AnnotationState, annotation: DashboardAnnotationRecord | null) => {
  if (!annotation) return;
  const next = state.annotations.filter((item) => String(item.id || '') !== String(annotation.id || ''));
  next.unshift(annotation);
  setAnnotations(state, next);
};

const removeAnnotationFromState = (state: AnnotationState, annotationId: string) => {
  setAnnotations(
    state,
    state.annotations.filter((item) => String(item.id || '') !== String(annotationId || '')),
  );
};

const setActiveSelection = (state: AnnotationState, cell: any, context: CellScopeContext | null) => {
  if (state.selectedCellEl instanceof HTMLElement) {
    state.selectedCellEl.classList.remove('dashboard-cell--selected');
  }

  state.selectedContext = context;
  const nextEl = cell?.getElement?.();
  if (nextEl instanceof HTMLElement && context) {
    nextEl.classList.add('dashboard-cell--selected');
    state.selectedCellEl = nextEl;
  } else {
    state.selectedCellEl = null;
  }
};

const annotationColorFormatter = (cell: any) => {
  const color = normalizeDashboardAnnotationColor(cell.getValue());
  if (!color) return '<span class="dashboard-muted">—</span>';
  return `
    <span class="dashboard-annotation-color-pill dashboard-annotation-color-pill--${escapeHtml(color)}">
      <span class="dashboard-annotation-color-pill__swatch" aria-hidden="true"></span>
      ${escapeHtml(dashboardAnnotationColorLabel(color))}
    </span>
  `;
};

const roleFormatter = (cell: any) => {
  const role = normalizeTextLower(cell.getValue()) || 'student';
  const label = role === 'teacher' ? 'Teacher' : 'Student';
  return `<span class="role-badge ${role === 'teacher' ? 'role-teacher' : 'role-student'}">${escapeHtml(label)}</span>`;
};

const renderCourseRoleSelectMarkup = (cell: any) => {
  const row = cell.getData?.() || {};
  const role = normalizeTextLower(cell.getValue()) === 'teacher' ? 'teacher' : 'student';
  const enrollmentId = normalizeText(row?.enrollmentId || '');
  const rowId = normalizeText(row?.id || row?.userId || '');
  const disabledAttr = enrollmentId ? '' : ' disabled';
  const stateAttr = enrollmentId ? 'idle' : 'disabled';

  return `
    <span class="dashboard-inline-select-wrap">
      <select
        class="dashboard-inline-select dashboard-inline-select--role"
        data-dashboard-course-role-select
        data-row-id="${escapeHtml(rowId)}"
        data-enrollment-id="${escapeHtml(enrollmentId)}"
        data-state="${escapeHtml(stateAttr)}"
        aria-label="Rol curso"
        ${disabledAttr}
      >
        <option value="student"${role === 'student' ? ' selected' : ''}>Student</option>
        <option value="teacher"${role === 'teacher' ? ' selected' : ''}>Teacher</option>
      </select>
    </span>
  `;
};

const renderTurnoSelectMarkup = (cell: any) => {
  const row = cell.getData?.() || {};
  const turno = ['M', 'T', 'N'].includes(normalizeText(cell.getValue()).toUpperCase())
    ? normalizeText(cell.getValue()).toUpperCase()
    : 'M';
  const studentId = normalizeText(row?.studentId || row?.userId || row?.id || '');
  const rowId = normalizeText(row?.id || row?.studentId || row?.userId || '');
  const title = getTurnoTitle(turno);

  return `
    <span class="dashboard-inline-select-wrap">
      <select
        class="dashboard-inline-select dashboard-inline-select--turno"
        data-dashboard-turno-select
        data-row-id="${escapeHtml(rowId)}"
        data-student-id="${escapeHtml(studentId)}"
        data-state="idle"
        aria-label="Turno"
        title="${escapeHtml(title)}"
      >
        <option value="M"${turno === 'M' ? ' selected' : ''}>M</option>
        <option value="T"${turno === 'T' ? ' selected' : ''}>T</option>
        <option value="N"${turno === 'N' ? ' selected' : ''}>N</option>
      </select>
    </span>
  `;
};

const renderGrupoInputMarkup = (cell: any) => {
  const row = cell.getData?.() || {};
  const grupo = normalizeGrupoDigits(cell.getValue());
  const studentId = normalizeText(row?.studentId || row?.userId || row?.id || '');
  const rowId = normalizeText(row?.id || row?.studentId || row?.userId || '');

  return `
    <span class="dashboard-inline-input-wrap">
      <input
        type="text"
        inputmode="numeric"
        maxlength="2"
        class="dashboard-inline-input dashboard-inline-input--grupo"
        data-dashboard-grupo-input
        data-row-id="${escapeHtml(rowId)}"
        data-student-id="${escapeHtml(studentId)}"
        data-state="idle"
        aria-label="Grupo"
        placeholder="--"
        value="${escapeHtml(grupo)}"
      />
    </span>
  `;
};

const renderAdminActionsMarkup = (cell: any) => {
  const row = cell.getData?.() || {};
  const userId = normalizeText(row?.userId || row?.id || '');
  if (!userId) {
    return '<span class="dashboard-muted">—</span>';
  }

  const userName = normalizeText(row?.name || row?.email || userId) || userId;
  const userEmail = normalizeText(row?.email || '');
  const globalRole = normalizeTextLower(row?.globalRole || '');
  const courseRole = normalizeTextLower(row?.courseRole || '');

  return `
    <span class="dashboard-admin-actions">
      <a
        class="dashboard-grid-icon-btn"
        href="/admin/user/${encodeURIComponent(userId)}"
        data-dashboard-user-detail
        aria-label="Abrir detalle de ${escapeHtml(userName)}"
        title="Abrir detalle"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11Zm18-11.5a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.05 1.05L19.95 6.8 21 5.75Z"></path>
        </svg>
      </a>
      <button
        type="button"
        class="dashboard-grid-icon-btn dashboard-grid-icon-btn--danger"
        data-dashboard-user-delete
        data-user-id="${escapeHtml(userId)}"
        data-user-name="${escapeHtml(userName)}"
        data-user-email="${escapeHtml(userEmail)}"
        data-user-global-role="${escapeHtml(globalRole)}"
        data-user-course-role="${escapeHtml(courseRole)}"
        aria-label="Borrar usuario ${escapeHtml(userName)}"
        title="Borrar usuario"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M9 3h6l1 2h5v2H3V5h5l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Z"></path>
        </svg>
      </button>
    </span>
  `;
};

const renderRiskMarkup = (cell: any) => {
  const risk = normalizeTextLower(cell.getValue()) || 'bajo';
  const label = risk === 'alto' ? 'Alto' : risk === 'medio' ? 'Medio' : 'Bajo';
  return `<span class="dashboard-pill dashboard-pill--risk dashboard-pill--risk-${escapeHtml(risk)}">${escapeHtml(label)}</span>`;
};

const renderScoreMarkup = (cell: any) => {
  const display = formatScore(cell.getValue());
  return display
    ? `<span class="dashboard-pill dashboard-pill--score">${escapeHtml(display)}</span>`
    : '<span class="dashboard-muted">—</span>';
};

const renderPercentMarkup = (cell: any) => {
  const parsed = Number(cell.getValue());
  if (!Number.isFinite(parsed)) {
    return '<span class="dashboard-muted">—</span>';
  }
  const tone = parsed >= 85 ? 'high' : parsed >= 70 ? 'mid' : 'low';
  const label = Number.isInteger(parsed) ? `${parsed}%` : `${parsed.toFixed(1).replace(/\.0$/, '')}%`;
  return `<span class="dashboard-pill dashboard-pill--percent dashboard-pill--percent-${tone}">${escapeHtml(label)}</span>`;
};

const renderDateTimeCellMarkup = (cell: any) => {
  const field = String(cell.getField() || '');
  const row = cell.getData?.() || {};
  const label = normalizeText(row?.[`${field}Label`] || formatDateTime(cell.getValue()));
  return label
    ? `<span class="dashboard-date-cell">${escapeHtml(label)}</span>`
    : '<span class="dashboard-muted">—</span>';
};

const renderAbsenceMarkup = (cell: any) => {
  const parsed = Number(cell.getValue());
  const display = formatAbsence(cell.getValue());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '<span class="dashboard-muted">0</span>';
  }
  if (parsed >= 4) {
    return `<span class="dashboard-pill dashboard-pill--absence dashboard-pill--absence-critical">${escapeHtml(display)}</span>`;
  }
  if (parsed >= 3) {
    return `<span class="dashboard-pill dashboard-pill--absence dashboard-pill--absence-warning">${escapeHtml(display)}</span>`;
  }
  return `<span class="dashboard-pill dashboard-pill--absence">${escapeHtml(display)}</span>`;
};

const renderGradeMarkup = (cell: any) => {
  const display = formatScore(cell.getValue());
  const field = String(cell.getField() || '');
  const statusLabel = normalizeText(cell.getData?.()?.__gradeState?.[field]?.statusLabel || '');
  if (display) {
    return `<span class="dashboard-pill dashboard-pill--score">${escapeHtml(display)}</span>`;
  }
  if (normalizeTextLower(statusLabel) === 'pendiente') {
    return '<span class="dashboard-muted">Pend.</span>';
  }
  return '<span class="dashboard-muted">—</span>';
};

const renderAttendanceMarkup = (cell: any) => {
  const field = String(cell.getField() || '');
  const meta = cell.getData?.()?.__attendanceCellMeta?.[field] || {};
  const effectiveValue = Number(meta?.effectiveValue || 0);
  const isFuture = Boolean(meta?.isFuture);
  const hasManualOverride = Boolean(meta?.hasManualOverride);
  const displayValue = formatAttendanceSymbol(effectiveValue, { isFuture });

  let tone = 'empty';
  if (effectiveValue >= 1) {
    tone = 'present';
  } else if (effectiveValue > 0) {
    tone = 'partial';
  } else if (isFuture) {
    tone = 'future';
  }

  return `<span class="dashboard-attendance-chip dashboard-attendance-chip--${escapeHtml(tone)}${hasManualOverride ? ' dashboard-attendance-chip--manual' : ''}">${escapeHtml(displayValue)}</span>`;
};

const renderAttendanceProgressMarkup = (cell: any) => {
  const parsed = Number(cell.getValue());
  const normalized = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
  const tone = normalized >= 85 ? 'high' : normalized >= 70 ? 'mid' : 'low';
  const label = formatPercentLabel(normalized);
  return `
    <span class="dashboard-progress dashboard-progress--${escapeHtml(tone)}" aria-label="Attendance ${escapeHtml(label)}">
      <span class="dashboard-progress__track" aria-hidden="true">
        <span class="dashboard-progress__fill" style="width:${escapeHtml(String(normalized))}%"></span>
      </span>
      <span class="dashboard-progress__label">${escapeHtml(label)}</span>
    </span>
  `;
};

const renderPlainMarkup = (cell: any) => {
  const value = cell.getValue();
  const normalized = normalizeText(value);
  if (!normalized && value !== 0) {
    return '<span class="dashboard-muted">—</span>';
  }
  return escapeHtml(value === null || value === undefined ? '—' : String(value));
};

const buildCellMarkup = (
  cell: any,
  contextKind: GridKind,
  annotationState: AnnotationState,
  baseRenderer: (cell: any) => string,
) => {
  const baseHtml = baseRenderer(cell);
  const cellContext = buildScopeContextFromCell(cell, contextKind);
  const element = cell.getElement?.();

  if (!cellContext) {
    if (element instanceof HTMLElement) {
      element.removeAttribute('data-annotation-color');
    }
    return baseHtml;
  }

  const annotation = getDisplayAnnotation(annotationState, cellContext);
  const annotationColor = normalizeDashboardAnnotationColor(annotation?.color);
  const annotationComment = normalizeDashboardAnnotationComment(annotation?.comment);
  const commentCount = getScopeAnnotations(annotationState, cellContext).filter((entry) => normalizeText(entry.comment)).length;
  const commentIndicator = annotationComment
    ? `<span class="dashboard-annotation-dot" title="${escapeHtml(annotationComment)}">${commentCount > 1 ? escapeHtml(String(commentCount)) : ''}</span>`
    : '';

  if (element instanceof HTMLElement) {
    const titleParts = [
      normalizeText(cell.getData?.()?.__attendanceCellMeta?.[String(cell.getField() || '')]?.title || ''),
      annotationComment ? `Comentario: ${annotationComment}` : '',
    ].filter(Boolean);
    element.title = titleParts.join(' • ');
    element.setAttribute(
      'aria-label',
      [cellContext.rowLabel, cellContext.columnLabel, annotationComment].filter(Boolean).join(' • '),
    );
    if (annotationColor) {
      element.setAttribute('data-annotation-color', annotationColor);
    } else {
      element.removeAttribute('data-annotation-color');
    }
  }

  return `
    <span class="dashboard-annotation-shell${annotationColor ? ` dashboard-annotation-shell--${escapeHtml(annotationColor)}` : ''}">
      <span class="dashboard-annotation-shell__content">${baseHtml}</span>
      ${commentIndicator}
    </span>
  `;
};

const buildCellContextMenu = (contextKind: GridKind, annotationState: AnnotationState, modalRef: { current: AnnotationModalApi | null }) =>
  (_event: MouseEvent, cell: any) => {
    const context = buildScopeContextFromCell(cell, contextKind);
    if (!context) return [];

    setActiveSelection(annotationState, cell, context);
    const ownAnnotation = getOwnAnnotation(annotationState, context);
    const displayAnnotation = getDisplayAnnotation(annotationState, context);

    return [
      {
        label: `<strong>Comentar…</strong> <span class="dashboard-menu-shortcut">${escapeHtml(getCommentShortcutLabel())}</span>`,
        action: () => {
          modalRef.current?.open(context);
        },
      },
      { separator: true },
      {
        label: 'Resaltar',
        menu: DASHBOARD_ANNOTATION_COLORS.map((color) => ({
          label: `<span class="dashboard-menu-color dashboard-menu-color--${escapeHtml(color)}"></span>${escapeHtml(dashboardAnnotationColorLabel(color))}`,
          action: async () => {
            const nextColor = normalizeDashboardAnnotationColor(color);
            await saveAnnotation(annotationState, context, {
              color: nextColor,
              comment: ownAnnotation?.comment || '',
              visibility: ownAnnotation?.visibility || displayAnnotation?.visibility || 'teachers',
            });
          },
        })),
      },
      {
        label: 'Quitar highlight',
        disabled: !normalizeDashboardAnnotationColor(ownAnnotation?.color),
        action: async () => {
          await saveAnnotation(annotationState, context, {
            color: '',
            comment: ownAnnotation?.comment || '',
            visibility: ownAnnotation?.visibility || 'teachers',
          });
        },
      },
      {
        label: 'Borrar anotación',
        disabled: !ownAnnotation,
        action: async () => {
          if (!ownAnnotation?.id) return;
          await removeAnnotation(annotationState, ownAnnotation.id);
        },
      },
    ];
  };

const toggleGroupFolding = (column: any) => {
  const subCols = column.getColumns();
  if (subCols.length === 0) return;

  // Determine if we are currently folded
  // A group is "folded" if at least one non-average column is hidden
  const isFolded = subCols.some((c: any) => !c.isVisible() && !c.getDefinition().field?.startsWith('__avg'));

  subCols.forEach((c: any) => {
    const def = c.getDefinition();
    const isAvg = def.field?.startsWith('__avg');
    const isLastName = def.field === 'lastName';
    
    if (isFolded) {
      c.show();
    } else {
      // When folding: keep averages and last name (for student group) visible
      if (!isAvg && !isLastName) {
        c.hide();
      }
    }
  });

  // Update icon class on header element
  const headerEl = column.getElement();
  if (headerEl) {
    headerEl.classList.toggle('group-folded', !isFolded);
  }
};

const configureColumns = (
  columns: any[],
  context: { kind: GridKind; meta: DashboardMeta },
  annotationState: AnnotationState,
  modalRef: { current: AnnotationModalApi | null },
): any[] => {
  const headerMenu = [
    {
      label: "Fold/Unfold Group",
      action: function (e: any, column: any) {
        toggleGroupFolding(column);
      }
    }
  ];

  return (columns || []).map((column) => {
    if (Array.isArray(column?.columns) && column.columns.length > 0) {
      return {
        ...column,
        headerContextMenu: headerMenu,
        headerClick: function(e: any, col: any) {
          // If clicking near the right edge (where the triangle is)
          const rect = col.getElement().getBoundingClientRect();
          if (e.clientX > rect.right - 30) {
            toggleGroupFolding(col);
          }
        },
        titleFormatter: function(col: any) {
          const title = col.getValue();
          return `<div class="group-header-content">
            <span class="group-header-title">${title}</span>
            <span class="group-header-icon"></span>
          </div>`;
        },
        columns: configureColumns(column.columns, context, annotationState, modalRef),
      };
    }

    const {
      kind,
      dateKey: _dateKey,
      ...restColumn
    } = column || {};
    const nextColumn: Record<string, any> = {
      ...restColumn,
    };

    let baseFormatter: ((cell: any) => string) | null = renderPlainMarkup;

    if (kind === 'risk') {
      baseFormatter = renderRiskMarkup;
    } else if (kind === 'score') {
      nextColumn.sorter = 'number';
      baseFormatter = renderScoreMarkup;
    } else if (kind === 'grade-score') {
      nextColumn.sorter = 'number';
      baseFormatter = renderGradeMarkup;
    } else if (kind === 'metric') {
      nextColumn.sorter = 'number';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
    } else if (kind === 'absence') {
      nextColumn.sorter = 'number';
      baseFormatter = renderAbsenceMarkup;
    } else if (kind === 'percent') {
      nextColumn.sorter = 'number';
      baseFormatter = renderPercentMarkup;
    } else if (kind === 'attendance-progress') {
      nextColumn.sorter = 'number';
      baseFormatter = renderAttendanceProgressMarkup;
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
    } else if (kind === 'datetime') {
      baseFormatter = renderDateTimeCellMarkup;
    } else if (kind === 'attendance-day' && context.kind === 'attendance-summary') {
      nextColumn.editor = 'input';
      nextColumn.headerSort = false;
      baseFormatter = renderAttendanceMarkup;
    } else if (kind === 'annotation-color') {
      baseFormatter = annotationColorFormatter;
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
    } else if (kind === 'role') {
      baseFormatter = roleFormatter;
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
    } else if (kind === 'course-role') {
      baseFormatter = renderCourseRoleSelectMarkup;
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
      nextColumn.headerSort = false;
    } else if (kind === 'turno') {
      baseFormatter = renderTurnoSelectMarkup;
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
      nextColumn.headerSort = false;
    } else if (kind === 'grupo') {
      baseFormatter = renderGrupoInputMarkup;
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
    } else if (kind === 'admin-actions') {
      baseFormatter = renderAdminActionsMarkup;
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
      nextColumn.headerSort = false;
    }

    if (isAnnotationContextKind(context.kind) && normalizeText(nextColumn.field)) {
      nextColumn.contextMenu = buildCellContextMenu(context.kind, annotationState, modalRef);
      nextColumn.formatter = (cell: any) =>
        buildCellMarkup(cell, context.kind, annotationState, baseFormatter || renderPlainMarkup);
    } else if (baseFormatter) {
      nextColumn.formatter = baseFormatter;
    }

    return nextColumn;
  });
};

const installGlobalSearch = (tables: Tabulator[], input: HTMLInputElement, persistKey: string) => {
  const filterState = { query: normalizeTextLower(getStoredSearchQuery(persistKey)) };
  const initializedTables = new WeakSet<Tabulator>();
  const filterFn = (data: any) => {
    if (!filterState.query) return true;
    return String(data?.__search || '').includes(filterState.query);
  };
  const filterWrapper = (data: any) => filterFn(data);

  const applyTableFilter = (table: Tabulator) => {
    if (!filterState.query) {
      table.clearFilter(true);
      return;
    }
    table.setFilter(filterWrapper);
  };

  const initializeTableFilter = (table: Tabulator) => {
    if (initializedTables.has(table)) return;
    initializedTables.add(table);
    applyTableFilter(table);
  };

  tables.forEach((table) => {
    table.on('tableBuilt', () => {
      initializeTableFilter(table);
    });
  });

  const applySearch = debounce((rawValue: string) => {
    const nextRaw = normalizeText(rawValue);
    filterState.query = normalizeTextLower(nextRaw);
    setStoredSearchQuery(persistKey, nextRaw);
    tables.forEach((table) => {
      if (!initializedTables.has(table)) return;
      applyTableFilter(table);
    });
  }, SEARCH_DEBOUNCE_MS);

  const initialValue = getStoredSearchQuery(persistKey);
  if (input.value !== initialValue) {
    input.value = initialValue;
  }
  filterState.query = normalizeTextLower(initialValue);

  if (input.dataset.bound === 'true') return;
  input.dataset.bound = 'true';
  input.addEventListener('input', () => {
    applySearch(input.value || '');
  });
};

const buildTable = (
  root: HTMLElement,
  element: HTMLElement,
  projection: GridProjection,
  persistKey: string,
  context: { kind: GridKind; meta: DashboardMeta },
  annotationState: AnnotationState,
  modalRef: { current: AnnotationModalApi | null },
) => {
  return new Tabulator(element, {
    index: 'id',
    data: Array.isArray(projection?.rows) ? projection.rows : [],
    columns: configureColumns(Array.isArray(projection?.columns) ? projection.columns : [], context, annotationState, modalRef),
    layout: context.kind === 'gradebook' ? 'fitDataTable' : 'fitColumns',
    editTriggerEvent: context.kind === 'attendance-summary' ? 'dblclick' : 'focus',
    columnHeaderVertAlign: 'bottom',
    pagination: 'local',
    paginationSize: 25,
    movableColumns: true,
    resizableColumnFit: false,
    selectableRows: false,
    placeholder: projection?.emptyMessage || 'Sin datos.',
    persistence: {
      sort: true,
      page: true,
      columns: ['title', 'width', 'visible'],
    },
    persistenceMode: 'local',
    persistenceID: persistKey,
    popupContainer: root,
    rowHeight: context.kind === 'attendance-summary' ? 36 : 38,
  });
};

const bindFoldingShortcuts = (registry: Map<string, Tabulator>) => {
  const handler = (e: KeyboardEvent) => {
    if (!e.metaKey && !e.ctrlKey) return;
    
    const isShift = e.shiftKey;
    const key = e.key;
    
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    
    const table = registry.get('gradebook');
    if (!table) return;

    e.preventDefault();

    if (isShift) {
      // Unfold/Fold ALL levels
      const topCols = table.getColumns();
      topCols.forEach((group: any) => {
        const subGroups = group.getColumns().filter((c: any) => Array.isArray(c.getDefinition().columns));
        if (subGroups.length > 0) {
          subGroups.forEach((sg: any) => {
            const shouldFold = key === 'ArrowLeft';
            const isSGFolded = sg.getColumns().some((c: any) => !c.isVisible() && !c.getDefinition().field?.startsWith('__avg'));
            if (shouldFold !== isSGFolded) toggleGroupFolding(sg);
          });
        }
        const shouldFold = key === 'ArrowLeft';
        const isFolded = group.getColumns().some((c: any) => !c.isVisible() && !c.getDefinition().field?.startsWith('__avg'));
        if (shouldFold !== isFolded) toggleGroupFolding(group);
      });
    } else {
      // Tiered folding:
      // If ArrowLeft: fold sub-groups first. If already folded, fold classes.
      // If ArrowRight: unfold classes first. If already unfolded, unfold sub-groups.
      const topCols = table.getColumns();
      
      if (key === 'ArrowLeft') {
        let anySubGroupFolded = false;
        topCols.forEach((group: any) => {
          const subGroups = group.getColumns().filter((c: any) => Array.isArray(c.getDefinition().columns));
          subGroups.forEach((sg: any) => {
            const isSGFolded = sg.getColumns().some((c: any) => !c.isVisible() && !c.getDefinition().field?.startsWith('__avg'));
            if (!isSGFolded) {
              toggleGroupFolding(sg);
              anySubGroupFolded = true;
            }
          });
        });
        
        if (!anySubGroupFolded) {
          topCols.forEach((group: any) => {
            const isFolded = group.getColumns().some((c: any) => !c.isVisible() && !c.getDefinition().field?.startsWith('__avg'));
            if (!isFolded) toggleGroupFolding(group);
          });
        }
      } else {
        let anyClassUnfolded = false;
        topCols.forEach((group: any) => {
          const isFolded = group.getColumns().some((c: any) => !c.isVisible() && !c.getDefinition().field?.startsWith('__avg'));
          if (isFolded) {
            toggleGroupFolding(group);
            anyClassUnfolded = true;
          }
        });

        if (!anyClassUnfolded) {
          topCols.forEach((group: any) => {
            const subGroups = group.getColumns().filter((c: any) => Array.isArray(c.getDefinition().columns));
            subGroups.forEach((sg: any) => {
              const isSGFolded = sg.getColumns().some((c: any) => !c.isVisible() && !c.getDefinition().field?.startsWith('__avg'));
              if (isSGFolded) toggleGroupFolding(sg);
            });
          });
        }
      }
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
};
const trackTableBuilt = (table: Tabulator, readyTables: WeakSet<Tabulator>) => {
  table.on('tableBuilt', () => {
    readyTables.add(table);
  });
};

const updateTeacherTabQuery = (tabName: string) => {
  const nextTab = VALID_TEACHER_TABS.includes(tabName) ? tabName : 'overview';
  const url = new URL(window.location.href);
  url.searchParams.set('tab', nextTab);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
};

const getActiveTeacherTab = (shell: ParentNode) => {
  const activeTab = shell.querySelector<HTMLElement>('[data-dashboard-tab].active');
  const nextTab = normalizeText(activeTab?.dataset.dashboardTab || '');
  return VALID_TEACHER_TABS.includes(nextTab) ? nextTab : 'overview';
};

const updateScopeQuery = (courseId: string, year: string, activeTab: string) => {
  const url = new URL(window.location.href);
  if (courseId) {
    url.searchParams.set('course', courseId);
  } else {
    url.searchParams.delete('course');
  }
  if (year) {
    url.searchParams.set('year', year);
  } else {
    url.searchParams.delete('year');
  }
  if (activeTab) {
    url.searchParams.set('tab', activeTab);
  } else {
    url.searchParams.delete('tab');
  }
  window.location.href = `${url.pathname}${url.search}${url.hash}`;
};

const bindAttendanceConfig = () => {
  const panel = document.querySelector('[data-attendance-config]');
  if (!(panel instanceof HTMLElement)) return;
  if (panel.dataset.bound === 'true') return;
  panel.dataset.bound = 'true';

  const startInput = panel.querySelector('[data-attendance-config-input="startDate"]');
  const endInput = panel.querySelector('[data-attendance-config-input="endDate"]');
  const stateNode = document.querySelector('[data-attendance-config-state]');
  if (
    !(startInput instanceof HTMLInputElement) ||
    !(endInput instanceof HTMLInputElement)
  ) {
    return;
  }

  const setState = (state: 'idle' | 'saving' | 'saved' | 'error', message: string) => {
    if (!(stateNode instanceof HTMLElement)) return;
    stateNode.dataset.state = state;
    stateNode.textContent = message;
  };

  let lastSerialized = JSON.stringify({
    startDate: startInput.value,
    endDate: endInput.value,
  });

  const submitConfig = debounce(async () => {
    const courseId = normalizeText(panel.getAttribute('data-course-id'));
    const year = normalizeText(panel.getAttribute('data-year'));
    if (!courseId || !year) return;
    const serialized = JSON.stringify({
      startDate: startInput.value,
      endDate: endInput.value,
    });
    if (serialized === lastSerialized) return;

    startInput.disabled = true;
    endInput.disabled = true;
    setState('saving', 'Guardando y reconstruyendo grilla...');
    try {
      const response = await fetch('/api/grade/course-attendance-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          year,
          startDate: startInput.value,
          endDate: endInput.value,
        }),
      });

      if (!response.ok) {
        throw new Error('No se pudo guardar la configuración de asistencia');
      }

      lastSerialized = serialized;
      setState('saved', 'Fechas guardadas. Recargando...');
      window.location.reload();
    } catch (error: any) {
      console.error('Error saving attendance config:', error);
      setState('error', error?.message || 'No se pudo guardar la configuración de asistencia');
      startInput.disabled = false;
      endInput.disabled = false;
    }
  }, 450);

  const handleChange = () => {
    submitConfig();
  };

  startInput.addEventListener('change', handleChange);
  endInput.addEventListener('change', handleChange);
};

const resolveDashboardShell = (root: HTMLElement) =>
  root.closest<HTMLElement>('.dashboard-shell') || document.body;

const buildCsvFilename = (key: string, meta: DashboardMeta) => {
  const course = normalizeText(meta?.courseId || 'curso').replace(/[^a-zA-Z0-9_-]+/g, '-');
  const year = normalizeText(meta?.year || 'year').replace(/[^a-zA-Z0-9_-]+/g, '-');
  switch (key) {
    case 'overview':
      return `musiki-overview-${course}-${year}.csv`;
    case 'gradebook':
      return `musiki-gradebook-${course}-${year}.csv`;
    case 'attendance-summary':
      return `musiki-attendance-summary-${course}-${year}.csv`;
    case 'attendance-log':
      return `musiki-attendance-log-${course}-${year}.csv`;
    case 'comments':
      return `musiki-comments-${course}-${year}.csv`;
    case 'admin':
      return `musiki-admin-${course}-${year}.csv`;
    default:
      return `musiki-dashboard-${key}-${course}-${year}.csv`;
  }
};

const bindCsvButtons = (root: HTMLElement, registry: Map<string, Tabulator>, meta: DashboardMeta) => {
  root.querySelectorAll('[data-dashboard-download]').forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';

    button.addEventListener('click', () => {
      const key = normalizeText(button.getAttribute('data-dashboard-download'));
      const table = registry.get(key);
      if (!table) return;
      table.download('csv', buildCsvFilename(key, meta));
    });
  });
};

const bindTeacherTabs = (
  shell: ParentNode,
  root: HTMLElement,
  initialTab: string,
  registry: Map<string, Tabulator>,
  readyTables: WeakSet<Tabulator>,
) => {
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-dashboard-tab-panel]'));
  const tabs = Array.from(shell.querySelectorAll<HTMLElement>('[data-dashboard-tab]'));
  if (tabs.length === 0 || panels.length === 0) return;

  const showTab = (tabName: string) => {
    const nextTab = VALID_TEACHER_TABS.includes(tabName) ? tabName : 'overview';
    tabs.forEach((tab) => {
      tab.classList.toggle('active', normalizeText(tab.dataset.dashboardTab) === nextTab);
    });
    let activePanel: HTMLElement | null = null;
    panels.forEach((panel) => {
      const isActive = normalizeText(panel.dataset.dashboardTabPanel) === nextTab;
      panel.hidden = !isActive;
      if (isActive) activePanel = panel;
    });
    updateTeacherTabQuery(nextTab);
    window.requestAnimationFrame(() => {
      registry.forEach((table) => {
        if (!readyTables.has(table)) return;
        const tableElement = (table as any)?.element;
        if (tableElement instanceof HTMLElement) {
          const panel = tableElement.closest<HTMLElement>('[data-dashboard-tab-panel]');
          if (activePanel && panel && panel !== activePanel) return;
        }
        try {
          table.redraw(true);
        } catch {
          // ignore redraw errors during tab switch
        }
      });
    });
  };

  tabs.forEach((tab) => {
    if (tab.dataset.bound === 'true') return;
    tab.dataset.bound = 'true';
    tab.addEventListener('click', () => {
      showTab(normalizeText(tab.dataset.dashboardTab));
    });
  });

  showTab(initialTab);
};

const bindScopeSelectors = (shell: ParentNode) => {
  const courseSelect = shell.querySelector('[data-dashboard-scope="course"]');
  const yearSelect = shell.querySelector('[data-dashboard-scope="year"]');
  if (!(courseSelect instanceof HTMLSelectElement) || !(yearSelect instanceof HTMLSelectElement)) return;

  if (courseSelect.dataset.boundScope !== 'true') {
    courseSelect.dataset.boundScope = 'true';
    courseSelect.addEventListener('change', () => {
      updateScopeQuery(courseSelect.value, yearSelect.value, getActiveTeacherTab(shell));
    });
  }

  if (yearSelect.dataset.boundScope !== 'true') {
    yearSelect.dataset.boundScope = 'true';
    yearSelect.addEventListener('change', () => {
      updateScopeQuery(courseSelect.value, yearSelect.value, getActiveTeacherTab(shell));
    });
  }
};

const saveAnnotation = async (
  state: AnnotationState,
  context: CellScopeContext,
  patch: {
    color?: DashboardAnnotationColor | '';
    comment?: string;
    visibility?: DashboardAnnotationVisibility;
  },
) => {
  const payload = {
    courseId: normalizeText(state.meta?.courseId || ''),
    year: normalizeText(state.meta?.year || ''),
    subjectUserId: context.subjectUserId,
    field: context.field,
    tab: context.tab,
    scopeType: context.scopeType,
    scopeRef: context.scopeRef,
    color: normalizeDashboardAnnotationColor(patch.color),
    comment: normalizeDashboardAnnotationComment(patch.comment),
    visibility: normalizeDashboardAnnotationVisibility(patch.visibility),
    metadata: {
      ...context.metadata,
      rowLabel: context.rowLabel,
      columnLabel: context.columnLabel,
      scopeLabel: `${context.rowLabel} / ${context.columnLabel}`,
      studentName: context.rowLabel,
      tabLabel: context.tabLabel,
    },
  };

  const response = await fetch('/api/dashboard/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || 'No se pudo guardar la anotación');
  }

  const ownExisting = getOwnAnnotation(state, context);
  if (!result?.annotation && ownExisting?.id) {
    removeAnnotationFromState(state, ownExisting.id);
  }

  if (result?.annotation) {
    upsertAnnotationInState(state, result.annotation as DashboardAnnotationRecord);
  }

  refreshAnnotationViews(state);
};

const removeAnnotation = async (state: AnnotationState, annotationId: string) => {
  const response = await fetch(`/api/dashboard/annotations/${encodeURIComponent(annotationId)}`, {
    method: 'DELETE',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || 'No se pudo borrar la anotación');
  }

  removeAnnotationFromState(state, annotationId);
  refreshAnnotationViews(state);
};

const createAnnotationModal = (
  root: HTMLElement,
  meta: DashboardMeta,
  state: AnnotationState,
): AnnotationModalApi => {
  const overlay = document.createElement('div');
  overlay.className = 'dashboard-annotation-modal';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="dashboard-annotation-modal__backdrop" data-annotation-modal-close></div>
    <div class="dashboard-annotation-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="dashboard-annotation-modal-title">
      <div class="dashboard-annotation-modal__header">
        <div>
          <h3 id="dashboard-annotation-modal-title">Comentario</h3>
          <p class="dashboard-annotation-modal__meta" data-annotation-modal-meta></p>
        </div>
        <button type="button" class="dashboard-annotation-modal__close" data-annotation-modal-close aria-label="Cerrar">×</button>
      </div>
      <p class="dashboard-annotation-modal__hint" data-annotation-modal-visible></p>
      <label class="dashboard-annotation-modal__field">
        <span>Comentario</span>
        <textarea rows="6" data-annotation-modal-comment placeholder="Comentario operativo para esta celda..."></textarea>
      </label>
      <div class="dashboard-annotation-modal__grid">
        <label class="dashboard-annotation-modal__field">
          <span>Highlight</span>
          <select data-annotation-modal-color>
            <option value="">Sin color</option>
            ${DASHBOARD_ANNOTATION_COLORS.map((color) => `<option value="${escapeHtml(color)}">${escapeHtml(dashboardAnnotationColorLabel(color))}</option>`).join('')}
          </select>
        </label>
        <label class="dashboard-annotation-modal__field">
          <span>Visibilidad</span>
          <select data-annotation-modal-visibility>
            <option value="teachers">Teachers</option>
            <option value="private">Privado</option>
          </select>
        </label>
      </div>
      <div class="dashboard-annotation-modal__actions">
        <button type="button" class="dashboard-grid-btn" data-annotation-modal-delete>Borrar</button>
        <div class="dashboard-annotation-modal__actions-spacer"></div>
        <button type="button" class="dashboard-grid-btn" data-annotation-modal-close>Cancelar</button>
        <button type="button" class="dashboard-grid-btn dashboard-grid-btn--primary" data-annotation-modal-save>Guardar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const metaNode = overlay.querySelector('[data-annotation-modal-meta]');
  const visibleNode = overlay.querySelector('[data-annotation-modal-visible]');
  const commentInput = overlay.querySelector('[data-annotation-modal-comment]');
  const colorSelect = overlay.querySelector('[data-annotation-modal-color]');
  const visibilitySelect = overlay.querySelector('[data-annotation-modal-visibility]');
  const deleteButton = overlay.querySelector('[data-annotation-modal-delete]');
  const saveButton = overlay.querySelector('[data-annotation-modal-save]');

  if (
    !(metaNode instanceof HTMLElement) ||
    !(visibleNode instanceof HTMLElement) ||
    !(commentInput instanceof HTMLTextAreaElement) ||
    !(colorSelect instanceof HTMLSelectElement) ||
    !(visibilitySelect instanceof HTMLSelectElement) ||
    !(deleteButton instanceof HTMLButtonElement) ||
    !(saveButton instanceof HTMLButtonElement)
  ) {
    return {
      open: () => {},
      destroy: () => {
        overlay.remove();
      },
    };
  }

  let currentContext: CellScopeContext | null = null;

  const close = () => {
    overlay.hidden = true;
    currentContext = null;
  };

  const open = (context: CellScopeContext) => {
    currentContext = {
      ...context,
      metadata: {
        ...(context.metadata || {}),
        courseId: normalizeText(meta.courseId),
        year: normalizeText(meta.year),
      },
    };

    const ownAnnotation = getOwnAnnotation(state, currentContext);
    const visibleAnnotation = getDisplayAnnotation(state, currentContext);

    metaNode.textContent = `${currentContext.rowLabel} / ${currentContext.columnLabel}`;
    visibleNode.textContent =
      visibleAnnotation && visibleAnnotation.authorUserId !== ownAnnotation?.authorUserId
        ? `Visible ahora: ${visibleAnnotation.authorName || visibleAnnotation.authorEmail || 'Teacher'} · ${dashboardAnnotationVisibilityLabel(visibleAnnotation.visibility)}`
        : `Shortcut: ${getCommentShortcutLabel()}`;

    commentInput.value = ownAnnotation?.comment || '';
    colorSelect.value = ownAnnotation?.color || '';
    visibilitySelect.value = ownAnnotation?.visibility || 'teachers';
    deleteButton.disabled = !ownAnnotation?.id;

    overlay.hidden = false;
    window.setTimeout(() => {
      commentInput.focus();
      commentInput.select();
    }, 0);
  };

  overlay.querySelectorAll('[data-annotation-modal-close]').forEach((button) => {
    button.addEventListener('click', () => close());
  });

  saveButton.addEventListener('click', async () => {
    if (!currentContext) return;
    saveButton.disabled = true;
    try {
      await saveAnnotation(state, currentContext, {
        color: normalizeDashboardAnnotationColor(colorSelect.value),
        comment: commentInput.value,
        visibility: normalizeDashboardAnnotationVisibility(visibilitySelect.value),
      });
      close();
    } catch (error: any) {
      console.error('Error saving dashboard annotation:', error);
      alert(error?.message || 'No se pudo guardar la anotación');
    } finally {
      saveButton.disabled = false;
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (!currentContext) return;
    const ownAnnotation = getOwnAnnotation(state, currentContext);
    if (!ownAnnotation?.id) return;

    deleteButton.disabled = true;
    try {
      await removeAnnotation(state, ownAnnotation.id);
      close();
    } catch (error: any) {
      console.error('Error deleting dashboard annotation:', error);
      alert(error?.message || 'No se pudo borrar la anotación');
    } finally {
      deleteButton.disabled = false;
    }
  });

  const keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !overlay.hidden) {
      close();
    }
  };
  document.addEventListener('keydown', keydownHandler);

  return {
    open,
    destroy: () => {
      document.removeEventListener('keydown', keydownHandler);
      overlay.remove();
    },
  };
};

const bindAnnotationShortcut = (
  state: AnnotationState,
  modalRef: { current: AnnotationModalApi | null },
) => {
  const handler = (event: KeyboardEvent) => {
    const key = String(event.key || '').toLowerCase();
    const isChordShortcut = (event.metaKey || event.ctrlKey) && event.altKey && key === 'm';
    const isFallbackShortcut =
      !event.metaKey
      && !event.ctrlKey
      && !event.altKey
      && !event.shiftKey
      && key === 'm';
    const isShortcut = isChordShortcut || isFallbackShortcut;
    if (!isShortcut) return;

    const target = event.target as HTMLElement | null;
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || target?.isContentEditable
    ) {
      return;
    }

    if (!state.selectedContext) return;

    event.preventDefault();
    modalRef.current?.open(state.selectedContext);
  };

  document.addEventListener('keydown', handler);
  return () => {
    document.removeEventListener('keydown', handler);
  };
};

const bindTableSelection = (
  table: Tabulator,
  kind: GridKind,
  state: AnnotationState,
) => {
  if (!isAnnotationContextKind(kind)) return;

  table.on('cellClick', (_event: MouseEvent, cell: any) => {
    setActiveSelection(state, cell, buildScopeContextFromCell(cell, kind));
  });

  table.on('cellContext', (_event: MouseEvent, cell: any) => {
    setActiveSelection(state, cell, buildScopeContextFromCell(cell, kind));
  });
};

const bindTurnoSelects = (host: HTMLElement, table: Tabulator, meta: DashboardMeta) => {
  const updateTurno = async (select: HTMLSelectElement) => {
    const rowId = normalizeText(select.dataset.rowId || '');
    const studentId = normalizeText(select.dataset.studentId || '');
    const turno = ['M', 'T', 'N'].includes(normalizeText(select.value).toUpperCase())
      ? normalizeText(select.value).toUpperCase()
      : 'M';
    const previousTurno = ['M', 'T', 'N'].includes(normalizeText(select.dataset.previousTurno).toUpperCase())
      ? normalizeText(select.dataset.previousTurno).toUpperCase()
      : 'M';
    if (!rowId || !studentId || !meta?.courseId || !meta?.year) {
      select.value = previousTurno;
      return;
    }
    if (turno === previousTurno) return;

    const setVisualState = (state: string, disabled: boolean) => {
      select.dataset.state = state;
      select.disabled = disabled;
      select.title = getTurnoTitle(select.value);
    };

    setVisualState('saving', true);
    try {
      const response = await fetch('/api/grade/course-student-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: meta.courseId,
          year: meta.year,
          studentId,
          turno,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'No se pudo actualizar el turno');
      }

      const resolvedTurno = ['M', 'T', 'N'].includes(normalizeText(payload?.meta?.turno).toUpperCase())
        ? normalizeText(payload.meta.turno).toUpperCase()
        : turno;
      const row = table.getRow(rowId);
      if (row) {
        await row.update({
          turno: resolvedTurno,
        });
      }
    } catch (error: any) {
      console.error('Error updating turno:', error);
      select.value = previousTurno;
      alert(error?.message || 'No se pudo actualizar el turno');
      setVisualState('error', false);
      return;
    }

    setVisualState('idle', false);
  };

  const focusHandler = (event: FocusEvent) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    if (!select.matches('[data-dashboard-turno-select]')) return;
    select.dataset.previousTurno = normalizeText(select.value).toUpperCase();
    select.title = getTurnoTitle(select.value);
  };

  const changeHandler = (event: Event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    if (!select.matches('[data-dashboard-turno-select]')) return;
    void updateTurno(select);
  };

  host.addEventListener('focusin', focusHandler);
  host.addEventListener('change', changeHandler);

  return () => {
    host.removeEventListener('focusin', focusHandler);
    host.removeEventListener('change', changeHandler);
  };
};

const bindGrupoInputs = (host: HTMLElement, table: Tabulator, meta: DashboardMeta) => {
  const syncInputValue = (input: HTMLInputElement) => {
    const normalized = normalizeGrupoDigits(input.value);
    if (input.value !== normalized) {
      input.value = normalized;
    }
    return normalized;
  };

  const updateGrupo = async (input: HTMLInputElement) => {
    const rowId = normalizeText(input.dataset.rowId || '');
    const studentId = normalizeText(input.dataset.studentId || '');
    const grupo = syncInputValue(input);
    const previousGrupo = normalizeGrupoDigits(input.dataset.previousGrupo || '');
    if (!rowId || !studentId || !meta?.courseId || !meta?.year) {
      input.value = previousGrupo;
      return;
    }
    if (grupo === previousGrupo) return;

    const setVisualState = (state: string, disabled: boolean) => {
      input.dataset.state = state;
      input.disabled = disabled;
    };

    setVisualState('saving', true);
    try {
      const response = await fetch('/api/grade/course-student-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: meta.courseId,
          year: meta.year,
          studentId,
          grupo,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'No se pudo actualizar el grupo');
      }

      const resolvedGrupo = normalizeGrupoDigits(payload?.meta?.grupo || grupo) || '';
      const row = table.getRow(rowId);
      if (row) {
        await row.update({
          grupo: resolvedGrupo || '—',
        });
      }
      input.value = resolvedGrupo;
      input.dataset.previousGrupo = resolvedGrupo;
    } catch (error: any) {
      console.error('Error updating grupo:', error);
      input.value = previousGrupo;
      alert(error?.message || 'No se pudo actualizar el grupo');
      setVisualState('error', false);
      return;
    }

    setVisualState('idle', false);
  };

  const focusHandler = (event: FocusEvent) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.matches('[data-dashboard-grupo-input]')) return;
    input.dataset.previousGrupo = normalizeGrupoDigits(input.value);
    input.select();
  };

  const inputHandler = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.matches('[data-dashboard-grupo-input]')) return;
    syncInputValue(input);
  };

  const changeHandler = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.matches('[data-dashboard-grupo-input]')) return;
    void updateGrupo(input);
  };

  const keydownHandler = (event: KeyboardEvent) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.matches('[data-dashboard-grupo-input]')) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
      return;
    }
    if (event.key === 'Escape') {
      const previousGrupo = normalizeGrupoDigits(input.dataset.previousGrupo || '');
      input.value = previousGrupo;
      input.blur();
    }
  };

  host.addEventListener('focusin', focusHandler);
  host.addEventListener('input', inputHandler);
  host.addEventListener('change', changeHandler);
  host.addEventListener('keydown', keydownHandler);

  return () => {
    host.removeEventListener('focusin', focusHandler);
    host.removeEventListener('input', inputHandler);
    host.removeEventListener('change', changeHandler);
    host.removeEventListener('keydown', keydownHandler);
  };
};

const supportsRangeSelection = (kind: GridKind) =>
  ['overview', 'gradebook', 'attendance-summary'].includes(kind);

const isInteractiveDashboardTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement
  || target instanceof HTMLTextAreaElement
  || target instanceof HTMLSelectElement
  || target instanceof HTMLButtonElement
  || target instanceof HTMLAnchorElement
  || (target instanceof HTMLElement && Boolean(
    target.closest(
      '.dashboard-inline-select-wrap, .dashboard-inline-input-wrap, .dashboard-admin-actions, .tabulator-editing',
    ),
  ));

const resolveCellComponentFromTarget = (table: Tabulator, target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return null;

  const cellElement = target.closest<HTMLElement>('.tabulator-cell');
  if (!cellElement) return null;

  const rowElement = cellElement.closest<HTMLElement>('.tabulator-row');
  const row = rowElement ? (table as any)?.rowManager?.findRow?.(rowElement) : null;
  const cell = row?.findCell?.(cellElement) || null;
  if (!cell) return null;

  const field = normalizeText(cell.getField?.() || '');
  if (!field || field.startsWith('__')) return null;

  const columnDefinition = cell.getColumn?.()?.getDefinition?.() || {};
  const cellKind = normalizeText(columnDefinition?.kind || '');
  if (['turno', 'grupo', 'course-role', 'admin-actions'].includes(cellKind)) {
    return null;
  }

  return cell;
};

const bindTableRangeSelection = (table: Tabulator, kind: GridKind, root: HTMLElement) => {
  if (!supportsRangeSelection(kind)) return () => {};

  const state: RangeSelectionState = {
    anchorCell: null,
    dragging: false,
    movedDuringDrag: false,
    preserveExisting: false,
    suppressClickUntil: 0,
    selectedCells: new Set<any>(),
    selectedElements: new Set<HTMLElement>(),
    bodyClassApplied: false,
  };
  (table as any).__musikiRangeSelectionState = state;
  const tableElement =
    ((table as any)?.rowManager?.element as HTMLElement | undefined)
    || ((table as any)?.element as HTMLElement | undefined)
    || null;
  const tableHost =
    ((table as any)?.element as HTMLElement | undefined)
    || tableElement?.closest<HTMLElement>('.dashboard-tabulator')
    || null;
  if (tableHost instanceof HTMLElement) {
    tableHost.dataset.rangeSelection = 'true';
  }

  const clearNativeSelection = () => {
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // ignore browser selection cleanup failures
    }
  };

  const setDraggingVisualState = (enabled: boolean) => {
    if (enabled && !state.bodyClassApplied) {
      document.body.classList.add('dashboard-range-dragging');
      state.bodyClassApplied = true;
      return;
    }

    if (!enabled && state.bodyClassApplied) {
      document.body.classList.remove('dashboard-range-dragging');
      state.bodyClassApplied = false;
    }
  };

  const clearSelection = () => {
    state.selectedCells.clear();
    state.selectedElements.forEach((element) => {
      element.classList.remove('dashboard-cell--range-selected', 'dashboard-cell--range-anchor');
    });
    state.selectedElements.clear();
  };

  const markCell = (cell: any, asAnchor = false) => {
    const element = cell?.getElement?.();
    if (!(element instanceof HTMLElement)) return;
    state.selectedCells.add(cell);
    element.classList.add('dashboard-cell--range-selected');
    if (asAnchor) {
      element.classList.add('dashboard-cell--range-anchor');
    } else {
      element.classList.remove('dashboard-cell--range-anchor');
    }
    state.selectedElements.add(element);
  };

  const applyRange = (startCell: any, endCell: any, preserveExisting: boolean) => {
    if (!startCell || !endCell) return;
    if (!preserveExisting) {
      clearSelection();
    }

    const startRow = Number(startCell.getRow?.()?.getPosition?.() || 0);
    const endRow = Number(endCell.getRow?.()?.getPosition?.() || 0);
    const startCol = Number(startCell.getColumn?.()?.getPosition?.() || 0);
    const endCol = Number(endCell.getColumn?.()?.getPosition?.() || 0);
    const top = Math.min(startRow, endRow);
    const bottom = Math.max(startRow, endRow);
    const left = Math.min(startCol, endCol);
    const right = Math.max(startCol, endCol);

    const rows = (table.getRows?.('active') || table.getRows?.() || []) as any[];
    const columns = (table.getColumns?.() || []) as any[];
    const columnsByPosition = new Map<number, any>();
    columns.forEach((column: any) => {
      const position = Number(column?.getPosition?.() || 0);
      if (position >= left && position <= right) {
        columnsByPosition.set(position, column);
      }
    });

    rows.forEach((row: any) => {
      const rowPosition = Number(row?.getPosition?.() || 0);
      if (rowPosition < top || rowPosition > bottom) return;

      columnsByPosition.forEach((column: any) => {
        const cell = row?.getCell?.(column);
        if (!cell) return;
        markCell(
          cell,
          rowPosition === startRow && Number(column?.getPosition?.() || 0) === startCol,
        );
      });
    });
  };

  const beginSelection = (event: MouseEvent, cell: any) => {
    state.dragging = true;
    state.movedDuringDrag = false;
    state.preserveExisting = Boolean(event.metaKey || event.ctrlKey);
    setDraggingVisualState(true);
    clearNativeSelection();
    if (!event.shiftKey) {
      state.anchorCell = cell;
    }
    applyRange(state.anchorCell || cell, cell, state.preserveExisting && !event.shiftKey);
  };

  const mouseUpHandler = () => {
    if (state.movedDuringDrag) {
      state.suppressClickUntil = Date.now() + 250;
    }
    state.dragging = false;
    state.movedDuringDrag = false;
    setDraggingVisualState(false);
    clearNativeSelection();
  };
  document.addEventListener('mouseup', mouseUpHandler);

  const mouseDownHandler = (event: MouseEvent) => {
    if (event.button !== 0 || isInteractiveDashboardTarget(event.target)) return;
    const cell = resolveCellComponentFromTarget(table, event.target);
    if (!cell) return;
    event.preventDefault();
    beginSelection(event, cell);
  };

  const mouseMoveHandler = (event: MouseEvent) => {
    if (!state.dragging || isInteractiveDashboardTarget(event.target)) return;
    const cell = resolveCellComponentFromTarget(table, event.target);
    if (!cell) return;
    event.preventDefault();
    clearNativeSelection();
    if (cell !== state.anchorCell) {
      state.movedDuringDrag = true;
    }
    applyRange(state.anchorCell || cell, cell, state.preserveExisting);
  };

  const selectStartHandler = (event: Event) => {
    if (isInteractiveDashboardTarget(event.target)) return;
    if (!resolveCellComponentFromTarget(table, event.target)) return;
    event.preventDefault();
    clearNativeSelection();
  };

  const dragStartHandler = (event: DragEvent) => {
    if (isInteractiveDashboardTarget(event.target)) return;
    if (!resolveCellComponentFromTarget(table, event.target)) return;
    event.preventDefault();
  };

  tableElement?.addEventListener('mousedown', mouseDownHandler, true);
  tableElement?.addEventListener('mousemove', mouseMoveHandler, true);
  tableElement?.addEventListener('mouseover', mouseMoveHandler, true);
  tableElement?.addEventListener('selectstart', selectStartHandler, true);
  tableElement?.addEventListener('dragstart', dragStartHandler, true);

  return () => {
    document.removeEventListener('mouseup', mouseUpHandler);
    tableElement?.removeEventListener('mousedown', mouseDownHandler, true);
    tableElement?.removeEventListener('mousemove', mouseMoveHandler, true);
    tableElement?.removeEventListener('mouseover', mouseMoveHandler, true);
    tableElement?.removeEventListener('selectstart', selectStartHandler, true);
    tableElement?.removeEventListener('dragstart', dragStartHandler, true);
    setDraggingVisualState(false);
    clearSelection();
    if (tableHost instanceof HTMLElement) {
      delete tableHost.dataset.rangeSelection;
    }
    delete (table as any).__musikiRangeSelectionState;
  };
};

const bindAttendanceManualEditing = (table: Tabulator, meta: DashboardMeta) => {
  const CLICK_TOGGLE_DELAY_MS = 180;
  const TOUCH_LONG_PRESS_DELAY_MS = 420;

  const resolveAttendanceCellContext = (cell: any) => {
    const field = normalizeText(cell.getField?.() || '');
    const rowData = cell.getData?.() || {};
    const cellMeta = rowData?.__attendanceCellMeta?.[field];
    const studentId = normalizeText(rowData?.studentId || '');
    const dateKey = normalizeText(cellMeta?.dateKey || '');
    if (!field || !cellMeta || !studentId || !dateKey || !meta?.courseId || !meta?.year) {
      return null;
    }

    return {
      field,
      rowData,
      cellMeta,
      studentId,
      dateKey,
    };
  };

  const persistAttendanceCellValue = async (cell: any, normalized: ReturnType<typeof normalizeAttendanceInput>) => {
    const context = resolveAttendanceCellContext(cell);
    if (!context) return false;

    const response = await fetch('/api/grade/course-attendance-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId: meta.courseId,
        year: meta.year,
        studentId: context.studentId,
        date: context.dateKey,
        countRaw: normalized.countRaw,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || 'No se pudo guardar la asistencia manual');
    }

    const payload = await response.json().catch(() => ({}));
    const nextCount = typeof payload?.meta?.count === 'number' ? payload.meta.count : null;
    const nextDisplay = nextCount === null ? '' : formatAttendanceSymbol(nextCount);
    const rowData = cell.getData?.() || {};
    const nextCellMeta = rowData?.__attendanceCellMeta?.[context.field];
    if (nextCellMeta) {
      nextCellMeta.hasManualOverride = nextCount !== null;
      nextCellMeta.manualValue = nextCount ?? 0;
      nextCellMeta.effectiveValue = nextCount ?? Number(nextCellMeta.liveValue || 0);
    }

    let absenceUnits = 0;
    let attendanceUnits = 0;
    let scheduledDayCount = 0;
    Object.values(rowData?.__attendanceCellMeta || {}).forEach((entry: any) => {
      scheduledDayCount += 1;
      attendanceUnits += Math.max(0, Number(entry?.effectiveValue || 0));
      if (!entry?.countsTowardAbsence) return;
      absenceUnits += Math.max(0, 1 - Number(entry?.effectiveValue || 0));
    });
    const attendanceRate = scheduledDayCount > 0
      ? Math.round((attendanceUnits / scheduledDayCount) * 1000) / 10
      : 0;

    await cell.getRow().update({
      [context.field]: nextDisplay,
      attendanceRate,
      attendanceCount: attendanceUnits,
      attendanceTotalCount: scheduledDayCount,
      absenceUnits,
      absenceDisplay: formatAbsence(absenceUnits),
    });

    return true;
  };

  const getSelectedAttendanceCells = (activeCell: any) => {
    const state = (table as any).__musikiRangeSelectionState as RangeSelectionState | undefined;
    if (!state?.selectedCells || state.selectedCells.size <= 1) return [] as any[];

    return Array.from(state.selectedCells).filter((candidate: any) => {
      if (!candidate || candidate === activeCell) return false;
      const context = resolveAttendanceCellContext(candidate);
      return Boolean(context);
    });
  };

  const getAttendanceCellKey = (cell: any) => {
    const context = resolveAttendanceCellContext(cell);
    if (!context) return '';
    return `${context.studentId}::${context.dateKey}`;
  };

  const persistAttendanceSelection = async (
    cell: any,
    normalized: ReturnType<typeof normalizeAttendanceInput>,
  ) => {
    await persistAttendanceCellValue(cell, normalized);

    const extraCells = getSelectedAttendanceCells(cell);
    const failures: string[] = [];
    for (const selectedCell of extraCells) {
      try {
        await persistAttendanceCellValue(selectedCell, normalized);
      } catch (error: any) {
        failures.push(error?.message || 'No se pudo guardar una celda del rango');
      }
    }

    if (failures.length > 0) {
      alert(`Se guardó la celda activa, pero fallaron ${failures.length} celdas del rango.`);
    }
  };

  const getNextToggleValue = (cell: any) => {
    const context = resolveAttendanceCellContext(cell);
    const effectiveValue = Number(context?.cellMeta?.effectiveValue || 0);
    return effectiveValue >= 1
      ? normalizeAttendanceInput('0')
      : normalizeAttendanceInput('1');
  };

  let pendingToggleTimer: number | null = null;
  let pendingToggleCellKey = '';
  let suppressClickCellKey = '';
  let suppressClickUntil = 0;
  let touchLongPressTimer: number | null = null;
  let touchLongPressCellKey = '';
  let touchLongPressTriggered = false;

  const clearPendingToggle = () => {
    if (pendingToggleTimer !== null) {
      window.clearTimeout(pendingToggleTimer);
      pendingToggleTimer = null;
    }
    pendingToggleCellKey = '';
  };

  const clearTouchLongPress = () => {
    if (touchLongPressTimer !== null) {
      window.clearTimeout(touchLongPressTimer);
      touchLongPressTimer = null;
    }
    touchLongPressCellKey = '';
    touchLongPressTriggered = false;
  };

  table.on('cellEditing', (cell: any) => {
    if (!resolveAttendanceCellContext(cell)) return;

    window.setTimeout(() => {
      const editor = cell.getElement?.()?.querySelector('input, textarea');
      if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
        editor.focus();
        editor.select();
      }
    }, 0);
  });

  table.on('cellEdited', async (cell: any) => {
    if (!resolveAttendanceCellContext(cell)) {
      cell.restoreOldValue();
      return;
    }

    const normalized = normalizeAttendanceInput(cell.getValue());
    if (!normalized.valid) {
      cell.restoreOldValue();
      alert('Usa solo / o 1, -, ~ o 0.5, x o 0, o deja vacío.');
      return;
    }

    try {
      await persistAttendanceSelection(cell, normalized);
    } catch (error: any) {
      console.error('Error saving manual attendance:', error);
      cell.restoreOldValue();
      alert(error?.message || 'No se pudo guardar la asistencia manual');
    }
  });

  table.on('cellClick', (event: MouseEvent, cell: any) => {
    if (!resolveAttendanceCellContext(cell)) return;
    if (isInteractiveDashboardTarget(event.target)) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;

    const rangeState = (table as any).__musikiRangeSelectionState as RangeSelectionState | undefined;
    if (rangeState?.suppressClickUntil && rangeState.suppressClickUntil > Date.now()) return;

    const cellKey = getAttendanceCellKey(cell);
    if (!cellKey) return;
    if (suppressClickCellKey === cellKey && suppressClickUntil > Date.now()) return;

    clearPendingToggle();
    pendingToggleCellKey = cellKey;
    pendingToggleTimer = window.setTimeout(async () => {
      pendingToggleTimer = null;
      pendingToggleCellKey = '';

      try {
        await persistAttendanceSelection(cell, getNextToggleValue(cell));
      } catch (error: any) {
        console.error('Error toggling attendance cell:', error);
        alert(error?.message || 'No se pudo actualizar la asistencia');
      }
    }, CLICK_TOGGLE_DELAY_MS);
  });

  table.on('cellDblClick', (_event: MouseEvent, cell: any) => {
    if (!resolveAttendanceCellContext(cell)) return;
    const cellKey = getAttendanceCellKey(cell);
    if (pendingToggleCellKey && pendingToggleCellKey === cellKey) {
      clearPendingToggle();
    }
  });

  const tableElement =
    ((table as any)?.rowManager?.element as HTMLElement | undefined)
    || ((table as any)?.element as HTMLElement | undefined)
    || null;

  const touchStartHandler = (event: TouchEvent) => {
    if (isInteractiveDashboardTarget(event.target)) return;
    const cell = resolveCellComponentFromTarget(table, event.target);
    if (!cell || !resolveAttendanceCellContext(cell)) return;

    clearTouchLongPress();
    touchLongPressCellKey = getAttendanceCellKey(cell);
    touchLongPressTimer = window.setTimeout(() => {
      touchLongPressTriggered = true;
      suppressClickCellKey = touchLongPressCellKey;
      suppressClickUntil = Date.now() + 900;
      clearPendingToggle();
      try {
        cell.getComponent?.().edit?.(true);
      } catch {
        // ignore touch edit failures
      }
    }, TOUCH_LONG_PRESS_DELAY_MS);
  };

  const touchEndHandler = () => {
    if (touchLongPressTimer !== null) {
      window.clearTimeout(touchLongPressTimer);
      touchLongPressTimer = null;
    }

    if (!touchLongPressTriggered) {
      touchLongPressCellKey = '';
      return;
    }

    touchLongPressCellKey = '';
    touchLongPressTriggered = false;
  };

  const touchMoveCancelHandler = () => {
    clearTouchLongPress();
  };

  tableElement?.addEventListener('touchstart', touchStartHandler, { passive: true });
  tableElement?.addEventListener('touchend', touchEndHandler, { passive: true });
  tableElement?.addEventListener('touchcancel', touchMoveCancelHandler, { passive: true });
  tableElement?.addEventListener('touchmove', touchMoveCancelHandler, { passive: true });

  return () => {
    clearPendingToggle();
    clearTouchLongPress();
    tableElement?.removeEventListener('touchstart', touchStartHandler);
    tableElement?.removeEventListener('touchend', touchEndHandler);
    tableElement?.removeEventListener('touchcancel', touchMoveCancelHandler);
    tableElement?.removeEventListener('touchmove', touchMoveCancelHandler);
  };
};

const bindAdminRoleSelects = (host: HTMLElement, table: Tabulator) => {
  const updateRole = async (select: HTMLSelectElement) => {
    const rowId = normalizeText(select.dataset.rowId || '');
    const enrollmentId = normalizeText(select.dataset.enrollmentId || '');
    const nextRole = normalizeTextLower(select.value);
    const previousRole = normalizeTextLower(select.dataset.previousRole || select.defaultValue || '');
    if (!rowId || !enrollmentId || !['student', 'teacher'].includes(nextRole)) {
      select.value = previousRole || 'student';
      return;
    }
    if (nextRole === previousRole) return;

    const setVisualState = (state: string, disabled: boolean) => {
      select.dataset.state = state;
      select.disabled = disabled;
    };

    setVisualState('saving', true);
    try {
      const response = await fetch('/api/enroll', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrollmentId,
          roleInCourse: nextRole,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'No se pudo actualizar el rol del curso');
      }

      const resolvedRole = normalizeTextLower(payload?.enrollment?.roleInCourse || nextRole) || 'student';
      const row = table.getRow(rowId);
      if (row) {
        await row.update({
          courseRole: resolvedRole,
          courseRoleLabel: resolvedRole === 'teacher' ? 'Teacher' : 'Student',
        });
      }
    } catch (error: any) {
      console.error('Error updating course role:', error);
      select.value = previousRole || 'student';
      alert(error?.message || 'No se pudo actualizar el rol del curso');
      setVisualState('error', false);
      return;
    }

    setVisualState('idle', false);
  };

  const focusHandler = (event: FocusEvent) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    if (!select.matches('[data-dashboard-course-role-select]')) return;
    select.dataset.previousRole = normalizeTextLower(select.value);
  };

  const changeHandler = (event: Event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    if (!select.matches('[data-dashboard-course-role-select]')) return;
    void updateRole(select);
  };

  host.addEventListener('focusin', focusHandler);
  host.addEventListener('change', changeHandler);

  return () => {
    host.removeEventListener('focusin', focusHandler);
    host.removeEventListener('change', changeHandler);
  };
};

const bindAdminActions = (host: HTMLElement, table: Tabulator, meta: DashboardMeta) => {
  const clickHandler = async (event: Event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;

    const deleteButton = target.closest<HTMLButtonElement>('[data-dashboard-user-delete]');
    if (!deleteButton) return;

    const userId = normalizeText(deleteButton.dataset.userId || '');
    const userName = normalizeText(deleteButton.dataset.userName || 'este usuario') || 'este usuario';
    const userEmail = normalizeText(deleteButton.dataset.userEmail || '');
    const globalRole = normalizeTextLower(deleteButton.dataset.userGlobalRole || '');
    const courseRole = normalizeTextLower(deleteButton.dataset.userCourseRole || '');
    if (!userId) return;

    const warningBits = [
      userEmail ? `Email: ${userEmail}` : '',
      globalRole === 'teacher' ? 'Tiene rol global teacher.' : '',
      courseRole === 'teacher' ? 'Tiene rol teacher en este curso.' : '',
      'Se borrarán también sus inscripciones y submissions.',
    ].filter(Boolean);
    const confirmMessage = [
      `¿Borrar a ${userName}?`,
      ...warningBits,
    ].join('\n');

    if (!window.confirm(confirmMessage)) return;

    deleteButton.disabled = true;
    deleteButton.dataset.state = 'saving';

    try {
      const requestUrl = new URL(`/api/admin/users/${encodeURIComponent(userId)}`, window.location.origin);
      if (normalizeText(meta?.courseId || '')) {
        requestUrl.searchParams.set('courseId', normalizeText(meta.courseId));
      }

      const response = await fetch(requestUrl.toString(), {
        method: 'DELETE',
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'No se pudo borrar el usuario');
      }

      const row = table.getRow(userId);
      if (row) {
        row.delete();
      }

      window.location.reload();
    } catch (error: any) {
      console.error('Error deleting dashboard user:', error);
      deleteButton.disabled = false;
      deleteButton.dataset.state = 'error';
      alert(error?.message || 'No se pudo borrar el usuario');
    }
  };

  host.addEventListener('click', clickHandler);

  return () => {
    host.removeEventListener('click', clickHandler);
  };
};

const recordMatchesDashboardScope = (meta: DashboardMeta, record: Record<string, any> | null | undefined) => {
  if (!record) return true;
  const activeCourseId = normalizeText(meta?.courseId || '');
  const activeYear = normalizeText(meta?.year || '');
  const recordCourseId = normalizeText(
    record?.courseId
      || (normalizeText(record?.pageSlug || '').split('/').find(Boolean) || ''),
  );
  const recordYear = normalizeText(
    record?.year
      || String(record?.startedAt || record?.submittedAt || record?.updatedAt || '').slice(0, 4),
  );

  if (activeCourseId && recordCourseId && recordCourseId !== activeCourseId) {
    return false;
  }
  if (activeYear && recordYear && recordYear !== activeYear) {
    return false;
  }
  return true;
};

const replaceProjectionScriptsFromHtml = (html: string) => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  let updatedCount = 0;

  DASHBOARD_PROJECTION_SCRIPT_IDS.forEach((scriptId) => {
    const current = document.getElementById(scriptId);
    const next = parsed.getElementById(scriptId);
    if (!(current instanceof HTMLScriptElement) || !(next instanceof HTMLScriptElement)) return;
    current.textContent = next.textContent || '';
    updatedCount += 1;
  });

  return updatedCount > 0;
};

const createRealtimeProjectionSync = (meta: DashboardMeta) => {
  const supabaseUrl = normalizeText(meta?.supabaseUrl || '');
  const supabaseKey = normalizeText(meta?.supabaseKey || '');
  const isSafeClientKey =
    supabaseKey.startsWith('sb_publishable_')
    || (supabaseKey.includes('.') && !supabaseKey.startsWith('sb_secret_'));
  if (!supabaseUrl || !supabaseKey || !isSafeClientKey) {
    return () => {};
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let disposed = false;
  let refreshTimeout: number | null = null;
  let refreshInFlight = false;
  let refreshQueued = false;

  const runRefresh = async () => {
    if (disposed || refreshInFlight) {
      refreshQueued = true;
      return;
    }

    refreshInFlight = true;
    try {
      const response = await fetch(window.location.href, {
        headers: {
          'x-musiki-dashboard-refresh': '1',
        },
      });
      if (!response.ok) {
        throw new Error(`Dashboard refresh failed (${response.status})`);
      }

      const html = await response.text();
      const didUpdate = replaceProjectionScriptsFromHtml(html);
      if (didUpdate && typeof window.__musikiDashboardRemount === 'function') {
        window.__musikiDashboardRemount();
      }
    } catch (error) {
      console.error('Error refreshing dashboard projections:', error);
    } finally {
      refreshInFlight = false;
      if (refreshQueued && !disposed) {
        refreshQueued = false;
        scheduleRefresh();
      }
    }
  };

  const scheduleRefresh = () => {
    if (disposed) return;
    if (refreshTimeout !== null) {
      window.clearTimeout(refreshTimeout);
    }
    refreshTimeout = window.setTimeout(() => {
      refreshTimeout = null;
      void runRefresh();
    }, 700);
  };

  const handleRealtimeEvent = (payload: any) => {
    const nextRecord = payload?.new && typeof payload.new === 'object' ? payload.new : null;
    const previousRecord = payload?.old && typeof payload.old === 'object' ? payload.old : null;
    if (
      !recordMatchesDashboardScope(meta, nextRecord)
      && !recordMatchesDashboardScope(meta, previousRecord)
    ) {
      return;
    }
    scheduleRefresh();
  };

  const channel = supabase
    .channel(`musiki-dashboard:${normalizeText(meta.courseId)}:${normalizeText(meta.year)}:${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'Assignment' }, handleRealtimeEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'Submission' }, handleRealtimeEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'Enrollment' }, handleRealtimeEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'LiveClassSession' }, handleRealtimeEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'LiveClassAttendance' }, handleRealtimeEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'GradebookAnnotation' }, handleRealtimeEvent)
    .subscribe();

  return () => {
    disposed = true;
    if (refreshTimeout !== null) {
      window.clearTimeout(refreshTimeout);
      refreshTimeout = null;
    }
    void supabase.removeChannel(channel);
  };
};

export const mountDashboardTabulators = (root: HTMLElement) => {
  if (!(root instanceof HTMLElement)) return () => {};
  if (root.dataset.dashboardTabulatorMounted === 'true') return () => {};
  const shell = resolveDashboardShell(root);

  const hasTeacherDashboard =
    Boolean(shell.querySelector('[data-dashboard-tab]'))
    || Boolean(root.querySelector('[data-dashboard-grid]'));
  if (!hasTeacherDashboard) return () => {};

  const meta = parseJsonScript<DashboardMeta>('dashboard-teacher-tabulator-meta', {});
  const overview = parseJsonScript<GridProjection>('dashboard-teacher-overview', { columns: [], rows: [] });
  const gradebook = parseJsonScript<GridProjection>('dashboard-teacher-gradebook', { columns: [], rows: [] });
  const attendance = parseJsonScript<AttendanceProjection>('dashboard-teacher-attendance', {
    summary: { columns: [], rows: [] },
    log: { columns: [], rows: [] },
  });
  const comments = parseJsonScript<GridProjection>('dashboard-teacher-comments', { columns: [], rows: [] });
  const admin = parseJsonScript<GridProjection>('dashboard-teacher-admin', { columns: [], rows: [] });
  const initialAnnotations = parseJsonScript<DashboardAnnotationRecord[]>('dashboard-teacher-annotations', []);

  const registry = new Map<string, Tabulator>();
  const tables: Tabulator[] = [];
  const readyTables = new WeakSet<Tabulator>();
  const destroyers: Array<() => void> = [];
  const annotationState: AnnotationState = {
    annotations: [],
    annotationsByScope: new Map(),
    registry,
    selectedContext: null,
    selectedCellEl: null,
    currentUserId: normalizeText(meta?.userId || ''),
    meta,
  };
  setAnnotations(annotationState, Array.isArray(initialAnnotations) ? initialAnnotations : []);

  const modalRef: { current: AnnotationModalApi | null } = { current: null };
  modalRef.current = createAnnotationModal(root, meta, annotationState);
  const destroyShortcut = bindAnnotationShortcut(annotationState, modalRef);
  const destroyRealtimeSync = createRealtimeProjectionSync(meta);

  const overviewNode = root.querySelector<HTMLElement>('[data-dashboard-grid="overview"]');
  if (overviewNode) {
    const persistKey = buildPersistKey(meta, 'overview');
    const table = buildTable(root, overviewNode, overview, persistKey, { kind: 'overview', meta }, annotationState, modalRef);
    trackTableBuilt(table, readyTables);
    bindTableSelection(table, 'overview', annotationState);
    destroyers.push(bindTurnoSelects(overviewNode, table, meta));
    destroyers.push(bindGrupoInputs(overviewNode, table, meta));
    destroyers.push(bindTableRangeSelection(table, 'overview', root));
    registry.set('overview', table);
    tables.push(table);
    const searchInput = root.querySelector<HTMLInputElement>('[data-dashboard-search="overview"]');
    if (searchInput) installGlobalSearch([table], searchInput, persistKey);
  }

  const gradebookNode = root.querySelector<HTMLElement>('[data-dashboard-grid="gradebook"]');
  if (gradebookNode) {
    const persistKey = buildPersistKey(meta, 'gradebook');
    const table = buildTable(root, gradebookNode, gradebook, persistKey, { kind: 'gradebook', meta }, annotationState, modalRef);
    trackTableBuilt(table, readyTables);
    bindTableSelection(table, 'gradebook', annotationState);
    destroyers.push(bindTurnoSelects(gradebookNode, table, meta));
    destroyers.push(bindGrupoInputs(gradebookNode, table, meta));
    destroyers.push(bindTableRangeSelection(table, 'gradebook', root));
    registry.set('gradebook', table);
    tables.push(table);
    const searchInput = root.querySelector<HTMLInputElement>('[data-dashboard-search="gradebook"]');
    if (searchInput) installGlobalSearch([table], searchInput, persistKey);
  }

  const attendanceNode = root.querySelector<HTMLElement>('[data-dashboard-grid="attendance-summary"]');
  const attendanceLogNode = root.querySelector<HTMLElement>('[data-dashboard-grid="attendance-log"]');
  if (attendanceNode && attendanceLogNode) {
    const summaryPersistKey = buildPersistKey(meta, 'attendance');
    const summaryTable = buildTable(root, attendanceNode, attendance.summary, summaryPersistKey, {
      kind: 'attendance-summary',
      meta,
    }, annotationState, modalRef);
    const logTable = buildTable(root, attendanceLogNode, attendance.log, `${summaryPersistKey}:log`, {
      kind: 'attendance-log',
      meta,
    }, annotationState, modalRef);
    trackTableBuilt(summaryTable, readyTables);
    trackTableBuilt(logTable, readyTables);
    bindTableSelection(summaryTable, 'attendance-summary', annotationState);
    destroyers.push(bindAttendanceManualEditing(summaryTable, meta));
    destroyers.push(bindTurnoSelects(attendanceNode, summaryTable, meta));
    destroyers.push(bindGrupoInputs(attendanceNode, summaryTable, meta));
    destroyers.push(bindTableRangeSelection(summaryTable, 'attendance-summary', root));
    registry.set('attendance-summary', summaryTable);
    registry.set('attendance-log', logTable);
    tables.push(summaryTable, logTable);

    const summarySearchInput = root.querySelector<HTMLInputElement>('[data-dashboard-search="attendance-summary"]');
    if (summarySearchInput) installGlobalSearch([summaryTable], summarySearchInput, summaryPersistKey);

    const logSearchInput = root.querySelector<HTMLInputElement>('[data-dashboard-search="attendance-log"]');
    if (logSearchInput) installGlobalSearch([logTable], logSearchInput, `${summaryPersistKey}:log-search`);
  }

  const commentsNode = root.querySelector<HTMLElement>('[data-dashboard-grid="comments"]');
  if (commentsNode) {
    const persistKey = buildPersistKey(meta, 'comments');
    const table = buildTable(
      root,
      commentsNode,
      { ...comments, rows: buildCommentsRowsFromAnnotations(annotationState.annotations) },
      persistKey,
      { kind: 'comments', meta },
      annotationState,
      modalRef,
    );
    trackTableBuilt(table, readyTables);
    registry.set('comments', table);
    tables.push(table);
    const searchInput = root.querySelector<HTMLInputElement>('[data-dashboard-search="comments"]');
    if (searchInput) installGlobalSearch([table], searchInput, persistKey);
  }

  const adminNode = root.querySelector<HTMLElement>('[data-dashboard-grid="admin"]');
  if (adminNode) {
    const persistKey = buildPersistKey(meta, 'admin');
    const table = buildTable(root, adminNode, admin, persistKey, { kind: 'admin', meta }, annotationState, modalRef);
    trackTableBuilt(table, readyTables);
    bindTableSelection(table, 'admin', annotationState);
    destroyers.push(bindAdminRoleSelects(adminNode, table));
    destroyers.push(bindAdminActions(adminNode, table, meta));
    registry.set('admin', table);
    tables.push(table);
    const searchInput = root.querySelector<HTMLInputElement>('[data-dashboard-search="admin"]');
    if (searchInput) installGlobalSearch([table], searchInput, persistKey);
  }

  bindTeacherTabs(shell, root, normalizeText(meta?.initialTeacherTab || 'overview') || 'overview', registry, readyTables);
  bindScopeSelectors(shell);
  bindAttendanceConfig();
  bindCsvButtons(root, registry, meta);
  destroyers.push(bindFoldingShortcuts(registry));

  root.dataset.dashboardTabulatorMounted = 'true';

  return () => {
    destroyShortcut();
    destroyRealtimeSync();
    destroyers.forEach((destroy) => {
      try {
        destroy();
      } catch {
        // ignore cleanup errors
      }
    });
    if (annotationState.selectedCellEl instanceof HTMLElement) {
      annotationState.selectedCellEl.classList.remove('dashboard-cell--selected');
    }
    modalRef.current?.destroy();
    tables.forEach((table) => {
      try {
        table.destroy();
      } catch {
        // ignore teardown errors
      }
    });
    root.dataset.dashboardTabulatorMounted = 'false';
  };
};
