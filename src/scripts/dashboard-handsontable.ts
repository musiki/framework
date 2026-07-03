import Handsontable from 'handsontable';
import { registerAllModules } from 'handsontable/registry';
import {
  DASHBOARD_ANNOTATION_COLORS,
  buildDashboardAnnotationScopeKey,
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
import 'handsontable/styles/handsontable.css';
import 'handsontable/styles/ht-theme-main.css';

registerAllModules();

type GridKind = 'teacher-main' | 'overview' | 'gradebook' | 'attendance-summary' | 'attendance-log' | 'comments' | 'teacher-eval' | 'login-log' | 'admin';
type DashboardMeta = { userId?: string; courseId?: string; year?: string; initialTeacherTab?: string };
type DashboardColumn = {
  title: string;
  field?: string;
  columns?: DashboardColumn[];
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  hozAlign?: 'left' | 'center' | 'right';
  kind?: string;
  dateKey?: string;
  cssClass?: string;
  titleFormatterParams?: Record<string, any>;
};
type GridProjection = { columns: DashboardColumn[]; rows: Record<string, any>[]; emptyMessage?: string };
type AttendanceProjection = { summary: GridProjection; log: GridProjection };
type LeafColumn = DashboardColumn & { field: string; title: string; sourcePath: string[] };
type CellScopeContext = {
  tab: 'main' | 'overview' | 'gradebook' | 'attendance-summary' | 'admin';
  tabLabel: string;
  scopeType: DashboardAnnotationScopeType;
  scopeRef: string;
  subjectUserId: string;
  field: string;
  columnLabel: string;
  rowLabel: string;
  metadata?: Record<string, any>;
};
type AnnotationState = {
  annotations: DashboardAnnotationRecord[];
  annotationsByScope: Map<string, DashboardAnnotationRecord[]>;
  selectedContext: CellScopeContext | null;
  selectedSheet: DashboardSheet | null;
  selectedCoords: { row: number; col: number } | null;
  currentUserId: string;
  meta: DashboardMeta;
};
type AnnotationModalApi = {
  open: (context: CellScopeContext) => void;
  destroy: () => void;
};
type DashboardSheet = {
  hot: Handsontable;
  kind: GridKind;
  element: HTMLElement;
  projectionColumns: DashboardColumn[];
  allRows: Record<string, any>[];
  activeRows: Record<string, any>[];
  leafColumns: LeafColumn[];
  hiddenFields: Set<string>;
  compactWidths: Map<string, number>;
  userWidths: Map<string, number>;
  annotationState?: AnnotationState;
  modalRef?: { current: AnnotationModalApi | null };
  contextMenuCoords?: { row: number; col: number } | null;
};
type AdminEnrollmentCourse = {
  courseId: string;
  label?: string;
  enrollmentId: string;
  roleInCourse: string;
};
type AdminEnrollmentCourseOption = {
  courseId: string;
  label?: string;
};

const VALID_TEACHER_TABS = ['main', 'log', 'admin', 'agenda'];
const TINY_COLUMN_WIDTH = 30;
const ROW_SELECT_COLUMN_WIDTH = 30;
const DASHBOARD_ROW_HEIGHT = 25;
const normalizeText = (value: unknown) => String(value ?? '').trim();
const normalizeTextLower = (value: unknown) => normalizeText(value).toLowerCase();
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (match) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
}[match] || match));

const debounce = <T extends (...args: any[]) => void>(fn: T, ms: number) => {
  let timer: number | null = null;
  return (...args: Parameters<T>) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
};

const parseJsonScript = <T>(id: string, fallback: T): T => {
  const script = document.getElementById(id);
  if (!script) return fallback;
  try {
    return JSON.parse(script.textContent || '') as T;
  } catch {
    return fallback;
  }
};

const setDashboardSaveStatus = (state: 'idle' | 'saving' | 'saved' | 'error', label: string) => {
  document.querySelectorAll<HTMLElement>('[data-dashboard-save-indicator]').forEach((node) => {
    node.dataset.state = state;
    node.title = label;
    node.setAttribute('aria-label', label);
  });
};

let toastTimer: number | null = null;
const showToast = (message: string, type: 'loading' | 'success' | 'error' = 'loading', duration = 0) => {
  const el = document.querySelector<HTMLElement>('[data-dashboard-toast]');
  if (!el) {
    if (type === 'error') console.warn(message);
    return;
  }
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  el.textContent = message;
  el.dataset.toastType = type;
  el.hidden = false;
  if (duration > 0) {
    toastTimer = window.setTimeout(() => {
      el.hidden = true;
      toastTimer = null;
    }, duration);
  }
};

const flattenColumns = (columns: DashboardColumn[], path: string[] = [], leaves: LeafColumn[] = []) => {
  (columns || []).forEach((column) => {
    const columnTitle = column.title === undefined || column.title === null
      ? normalizeText(column.field || '')
      : normalizeText(column.title);
    const nextPath = [...path, columnTitle];
    if (Array.isArray(column.columns) && column.columns.length > 0) {
      flattenColumns(column.columns, nextPath, leaves);
      return;
    }
    const field = normalizeText(column.field);
    if (!field) return;
    leaves.push({ ...column, field, title: columnTitle || (normalizeText(column.kind) === 'row-select' ? '' : field), sourcePath: nextPath });
  });
  return leaves;
};

const makeInitialLabel = (value: string) => {
  const parts = normalizeText(value).match(/[A-Za-zÀ-ÿ0-9]+/g) || [];
  const initials = parts
    .slice(0, 3)
    .map((part) => (/^\d+$/.test(part) ? String(parseInt(part, 10)) : part[0]?.toUpperCase()))
    .join('');
  return initials || normalizeText(value).slice(0, 2).toUpperCase();
};

const getShortHeaderLabel = (leaf: LeafColumn, level: number) => {
  const fullLabel = normalizeText(leaf.sourcePath[level] || leaf.title || leaf.field);
  const field = normalizeText(leaf.field);
  const kind = normalizeText(leaf.kind);
  if (!fullLabel) return '';

  if (level < leaf.sourcePath.length - 1) {
    return isGradebookColumn(leaf) && level > 0 ? makeInitialLabel(fullLabel) : fullLabel;
  }

  if (field === 'turno' || kind === 'turno') return 'T';
  if (field === 'grupo' || kind === 'grupo') return 'G';
  if (field === 'attendanceRate' || kind === 'attendance-progress') return 'A';
  if (field === 'deliveriesDone') return 'E';
  if (field === 'deliveriesPending') return 'P';
  if (field === 'absenceUnits' || kind === 'absence') return 'I';
  if (field === 'average') return 'PT';
  if (field === 'conceptValue' || kind === 'concepto') return 'C';
  if (field === 'finalGrade' || kind === 'final-grade') return 'NF';
  if (field.startsWith('day_') || kind === 'attendance-day') return fullLabel;
  if (field.startsWith('teacherMainGradebookSummary_') || field.startsWith('__avg_')) {
    return normalizeText(getFoldMeta(leaf).shortLabel) || makeInitialLabel(fullLabel);
  }
  if (field.startsWith('eval__') || kind === 'grade-score' || kind === 'score' || kind === 'metric') {
    return normalizeText(getFoldMeta(leaf).shortLabel) || makeInitialLabel(fullLabel);
  }
  return fullLabel;
};

const buildHeaderLabel = (leaf: LeafColumn, level: number) => {
  const fullLabel = normalizeText(leaf.sourcePath[level] || leaf.title || leaf.field);
  return escapeHtml(getShortHeaderLabel(leaf, level) || fullLabel);
};

const getThreeLevelHeaderPath = (leaf: LeafColumn) => {
  const topLabel = normalizeText(leaf.sourcePath[0] || '');
  const finalLevel = Math.max(0, leaf.sourcePath.length - 1);
  let groupLabel = '';

  if (leaf.sourcePath.length > 2) {
    if (normalizeTextLower(topLabel) === 'gradebook' && leaf.sourcePath.length > 3) {
      groupLabel = normalizeText(leaf.sourcePath[leaf.sourcePath.length - 2] || leaf.sourcePath[1] || '');
    } else {
      groupLabel = normalizeText(leaf.sourcePath[leaf.sourcePath.length - 2] || '');
    }
  }

  return [
    { raw: topLabel, label: escapeHtml(topLabel) },
    { raw: groupLabel, label: groupLabel ? escapeHtml(getShortHeaderLabel(leaf, leaf.sourcePath.length - 2) || groupLabel) : '' },
    { raw: normalizeText(leaf.sourcePath[finalLevel] || leaf.title || leaf.field), label: buildHeaderLabel(leaf, finalLevel) },
  ];
};

type HeaderPathEntry = { raw: string; label: string };

const buildHeaderRowsFromPaths = (headerPaths: HeaderPathEntry[][]) => {
  const depth = Math.max(1, ...headerPaths.map((path) => path.length));
  const rows: any[][] = Array.from({ length: depth }, () => []);
  for (let level = 0; level < depth; level += 1) {
    let index = 0;
    while (index < headerPaths.length) {
      const current = headerPaths[index][level] || { raw: '', label: '' };
      const rawLabel = current.raw;
      const label = current.label;
      const prefix = headerPaths[index].slice(0, level).map((entry) => entry.raw).join('\u0000');
      let colspan = 1;
      while (
        index + colspan < headerPaths.length
        && (headerPaths[index + colspan][level]?.raw || '') === rawLabel
        && headerPaths[index + colspan].slice(0, level).map((entry) => entry.raw).join('\u0000') === prefix
      ) {
        colspan += 1;
      }
      rows[level].push(colspan > 1 ? { label, colspan } : label);
      index += colspan;
    }
  }
  return rows;
};

const getNaturalHeaderPath = (leaf: LeafColumn): HeaderPathEntry[] => {
  const sourcePath = leaf.sourcePath.length ? leaf.sourcePath : [leaf.title || leaf.field];
  return sourcePath.map((part) => {
    const label = normalizeText(part);
    return { raw: label, label: escapeHtml(label) };
  });
};

const buildNestedHeaders = (leaves: LeafColumn[], kind: GridKind) => {
  const headerPaths = kind === 'teacher-main'
    ? leaves.map(getThreeLevelHeaderPath)
    : leaves.map(getNaturalHeaderPath);
  return buildHeaderRowsFromPaths(headerPaths);
};

const getFoldMeta = (column: DashboardColumn | undefined) => {
  const meta = column?.titleFormatterParams?.foldMeta;
  return meta && typeof meta === 'object' ? meta as Record<string, any> : {};
};

const collectLeafFields = (columns: DashboardColumn[], fields = new Set<string>()) => {
  (columns || []).forEach((column) => {
    if (Array.isArray(column.columns) && column.columns.length > 0) {
      collectLeafFields(column.columns, fields);
      return;
    }
    const field = normalizeText(column.field);
    if (field) fields.add(field);
  });
  return fields;
};

const collectTeacherMainFoldVisibleFields = (columns: DashboardColumn[]) => {
  const visible = new Set<string>();
  (columns || []).forEach((column) => {
    const meta = getFoldMeta(column);
    const visibleChildren = Array.isArray(meta.visibleChildren)
      ? meta.visibleChildren.map(normalizeText).filter(Boolean)
      : [];
    visibleChildren.forEach((field) => visible.add(field));
  });
  return visible;
};

const getColumnPersistKey = (meta: DashboardMeta, kind: GridKind) =>
  `musiki-dashboard-sheet:${normalizeText(meta.courseId || 'all')}:${normalizeText(meta.year || 'all')}:${kind}:column-widths`;

const readColumnWidths = (key: string) => {
  const widths = new Map<string, number>();
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    Object.entries(parsed || {}).forEach(([field, width]) => {
      const numeric = Number(width);
      if (field && Number.isFinite(numeric) && numeric >= TINY_COLUMN_WIDTH) widths.set(field, Math.round(numeric));
    });
  } catch {}
  return widths;
};

const writeColumnWidths = (key: string, widths: Map<string, number>) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(widths)));
  } catch {}
};

const isGradebookColumn = (column: LeafColumn | DashboardColumn | undefined) =>
  Array.isArray((column as LeafColumn | undefined)?.sourcePath)
  && (column as LeafColumn).sourcePath.some((part) => normalizeTextLower(part) === 'gradebook');

const isNotesColumn = (column: LeafColumn | DashboardColumn | undefined) => {
  const field = normalizeText(column?.field);
  const kind = normalizeText(column?.kind);
  return field === 'notesValue' || field === 'notes' || kind === 'notes';
};

const isTinyDashboardColumn = (column: LeafColumn | DashboardColumn | undefined) => {
  const field = normalizeText(column?.field);
  const kind = normalizeText(column?.kind);
  return field.startsWith('day_')
    || field === 'turno'
    || field === 'grupo'
    || field === 'attendanceRate'
    || field === 'deliveriesDone'
    || field === 'deliveriesPending'
    || field === 'absenceUnits'
    || kind === 'attendance-day'
    || kind === 'turno'
    || kind === 'grupo'
    || kind === 'attendance-progress'
    || kind === 'absence'
    || (isGradebookColumn(column) && !isNotesColumn(column));
};

const inferColumnWidth = (column: LeafColumn) => {
  const field = normalizeText(column.field);
  const title = normalizeText(column.title);
  const kind = normalizeText(column.kind);
  const explicitWidth = column.width || column.minWidth;
  if (kind === 'row-select') return ROW_SELECT_COLUMN_WIDTH;
  if (isTinyDashboardColumn(column)) return TINY_COLUMN_WIDTH;
  if (explicitWidth) return explicitWidth;
  if (field === 'average' || field.startsWith('__avg_') || field.startsWith('teacherMainGradebookSummary_')) return 42;
  if (field.startsWith('eval__')) return 42;
  if (kind === 'score' || kind === 'grade-score' || kind === 'metric' || kind === 'percent') return 46;
  if (kind === 'attendance-day') return TINY_COLUMN_WIDTH;
  if (kind === 'absence') return 48;
  if (kind === 'attendance-progress') return 74;
  if (kind === 'concepto' || kind === 'final-grade') return 48;
  if (kind === 'role') return 82;
  if (kind === 'admin-actions') return 64;
  if (kind === 'relative-datetime') return 88;
  if (kind === 'datetime') return 128;
  if (field === 'lastName') return 132;
  if (field === 'firstName') return 118;
  if (field === 'email') return 180;
  if (field === 'notesValue' || kind === 'notes') return 150;
  if (title.length > 0 && title.length <= 4) return 38;
  if (title.length > 0 && title.length <= 6) return 44;
  return undefined;
};

const resolveColumnWidth = (
  column: LeafColumn,
  compactWidths?: Map<string, number>,
  userWidths?: Map<string, number>,
) => {
  if (normalizeText(column.kind) === 'row-select') return ROW_SELECT_COLUMN_WIDTH;
  if (isTinyDashboardColumn(column)) return TINY_COLUMN_WIDTH;
  return compactWidths?.get(column.field)
    || userWidths?.get(column.field)
    || inferColumnWidth(column);
};

const resolveVisualColumnWidth = (
  leafColumns: LeafColumn[],
  visualCol: number,
  compactWidths?: Map<string, number>,
  userWidths?: Map<string, number>,
  hot?: Handsontable,
) => {
  const sourceCol = hot ? hot.toPhysicalColumn(visualCol) : visualCol;
  const leaf = leafColumns[sourceCol] || leafColumns[visualCol];
  return leaf ? resolveColumnWidth(leaf, compactWidths, userWidths) : undefined;
};

const isAdminAdaptiveColumn = (column: LeafColumn | undefined) =>
  ['name', 'email'].includes(normalizeText(column?.field));

const resolveForcedVisualColumnWidth = (
  leafColumns: LeafColumn[],
  visualCol: number,
  gridKind: GridKind,
  compactWidths?: Map<string, number>,
  userWidths?: Map<string, number>,
  hot?: Handsontable,
) => {
  const sourceCol = hot ? hot.toPhysicalColumn(visualCol) : visualCol;
  const leaf = leafColumns[sourceCol] || leafColumns[visualCol];
  if (!leaf) return undefined;
  const width = resolveColumnWidth(leaf, compactWidths, userWidths);
  if (!width) return undefined;
  if (width === TINY_COLUMN_WIDTH || width === ROW_SELECT_COLUMN_WIDTH) return width;
  if (gridKind === 'admin' && !isAdminAdaptiveColumn(leaf)) return width;
  return undefined;
};

const shouldUseVerticalHeader = (column: LeafColumn, width: number | undefined) => {
  const title = normalizeText(column.title);
  const field = normalizeText(column.field);
  const kind = normalizeText(column.kind);
  if (isTinyDashboardColumn(column)) return false;
  if (field.startsWith('day_') || kind === 'attendance-day') return false;
  return Boolean(
    width
    && width <= 54
    && (
      title.length <= 6
      || field.startsWith('day_')
      || field.startsWith('eval__')
      || field.startsWith('__avg_')
      || field.startsWith('teacherMainGradebookSummary_')
      || ['score', 'grade-score', 'metric', 'absence', 'attendance-day', 'concepto', 'final-grade', 'turno', 'grupo'].includes(kind)
    ),
  );
};

const formatSubmissionDate = (value: unknown) => {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatRelativeDate = (value: unknown) => {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'menos de 1 minuto';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} ${days === 1 ? 'día' : 'días'}${hours ? ` ${hours} h` : ''}`;
  if (hours > 0) return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  return `${minutes} min`;
};

const formatAbsence = (value: unknown) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return '0';
  return String(Math.round(parsed * 10) / 10).replace('.', ',');
};

const getAbsenceSeverity = (value: unknown) => {
  const parsed = Number(normalizeText(value).replace(',', '.') || 0);
  if (!Number.isFinite(parsed) || parsed < 1) return '';
  if (parsed >= 4) return 'critical';
  if (parsed >= 2) return 'warning';
  return 'notice';
};

const attendanceSymbol = (value: unknown, blankWhenZero = false) => {
  const units = Number(value ?? 0);
  if (units >= 1) return '✓';
  if (units >= 0.5) return '~';
  return blankWhenZero ? '' : 'x';
};

const normalizeAttendanceInput = (value: unknown) => {
  const raw = normalizeText(value).toLowerCase().replace(',', '.');
  if (raw === '' || raw === '—') return { valid: true, countRaw: null as number | null };
  if (['/', '1', '✓', '✔'].includes(raw)) return { valid: true, countRaw: 1 };
  if (['-', '~', '0.5', '.5'].includes(raw)) return { valid: true, countRaw: 0.5 };
  if (['x', '0'].includes(raw)) return { valid: true, countRaw: 0 };
  return { valid: false, countRaw: null as number | null };
};

const normalizeGrupo = (value: unknown) => {
  const raw = normalizeText(value).toUpperCase();
  if (!raw) return '';
  if (raw === 'X') return 'X';
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? String(parseInt(digits, 10)).padStart(2, '0') : '';
};

const normalizeScore = (value: unknown) => {
  const raw = normalizeText(value).replace(',', '.');
  if (!raw || raw === '—') return '';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return '';
  return String(Number(Math.max(0, Math.min(10, parsed)).toFixed(2)));
};

const normalizeCourseStudentMetaValue = (kind: string, value: unknown) => {
  if (kind === 'turno') {
    const turno = normalizeText(value).toUpperCase();
    return ['M', 'T', 'N'].includes(turno) ? turno : 'M';
  }
  if (kind === 'grupo') return normalizeGrupo(value);
  if (kind === 'concepto' || kind === 'final-grade') return normalizeScore(value);
  if (kind === 'notes') return normalizeText(value).replace(/\s+/g, ' ').slice(0, 280);
  return normalizeText(value);
};

const getMetaPatchKey = (kind: string) => {
  if (kind === 'turno') return 'turno';
  if (kind === 'grupo') return 'grupo';
  if (kind === 'concepto') return 'concepto';
  if (kind === 'notes') return 'notes';
  if (kind === 'final-grade') return 'notaFinal';
  return '';
};

const isEditableKind = (kind: string) =>
  ['attendance-day', 'turno', 'grupo', 'concepto', 'notes', 'final-grade', 'editable-text'].includes(kind);

const isCourseStudentMetaKind = (kind: string) =>
  ['turno', 'grupo', 'concepto', 'notes', 'final-grade'].includes(kind);

const isAnnotationGridKind = (kind: GridKind) =>
  ['teacher-main', 'overview', 'gradebook', 'attendance-summary', 'admin'].includes(kind);

const resolveTeacherMainAnnotationSection = (field: string) => {
  const normalizedField = normalizeText(field);
  if (normalizedField === 'absenceUnits' || normalizedField.startsWith('day_')) {
    return { tabLabel: 'Asistencia', scopeType: 'attendance_cell' as DashboardAnnotationScopeType };
  }
  if (normalizedField.startsWith('eval__') || normalizedField.startsWith('__avg_')) {
    return { tabLabel: 'Gradebook', scopeType: 'gradebook_cell' as DashboardAnnotationScopeType };
  }
  return { tabLabel: 'Profile', scopeType: 'overview_cell' as DashboardAnnotationScopeType };
};

const buildScopeContextFromCoords = (
  sheet: DashboardSheet,
  visualRow: number,
  visualCol: number,
): CellScopeContext | null => {
  if (!isAnnotationGridKind(sheet.kind)) return null;
  if (visualRow < 0 || visualCol < 0) return null;
  const sourceRow = sheet.hot.toPhysicalRow(visualRow);
  const sourceCol = sheet.hot.toPhysicalColumn(visualCol);
  const rowData = sheet.activeRows[sourceRow] || {};
  const column = sheet.leafColumns[sourceCol] || sheet.leafColumns[visualCol];
  const field = normalizeText(column?.field);
  const subjectUserId = normalizeText(rowData?.studentId || rowData?.userId || rowData?.id || '');
  if (!field || !subjectUserId) return null;

  let tab: CellScopeContext['tab'] = 'overview';
  let tabLabel = 'Resumen';
  let scopeType: DashboardAnnotationScopeType = 'overview_cell';

  if (sheet.kind === 'teacher-main') {
    tab = 'main';
    const section = resolveTeacherMainAnnotationSection(field);
    tabLabel = section.tabLabel;
    scopeType = section.scopeType;
  } else if (sheet.kind === 'gradebook') {
    tab = 'gradebook';
    tabLabel = 'Calificaciones';
    scopeType = 'gradebook_cell';
  } else if (sheet.kind === 'attendance-summary') {
    tab = 'attendance-summary';
    tabLabel = 'Asistencia';
    scopeType = 'attendance_cell';
  } else if (sheet.kind === 'admin') {
    tab = 'admin';
    tabLabel = 'Admin';
    scopeType = 'admin_cell';
  }

  const rowLabel = normalizeText(
    [rowData.lastName, rowData.firstName].filter(Boolean).join(' ')
    || rowData.name
    || rowData.email
    || subjectUserId,
  );

  return {
    tab,
    tabLabel,
    scopeType,
    scopeRef: `${subjectUserId}::${field}`,
    subjectUserId,
    field,
    columnLabel: normalizeText(column?.title || field),
    rowLabel,
    metadata: {
      ...rowData,
      __gradeState: undefined,
      __attendanceCellMeta: undefined,
      __search: undefined,
    },
  };
};

const getDisplayAnnotation = (state: AnnotationState | undefined, context: CellScopeContext | null) => {
  if (!state || !context) return null;
  const key = buildDashboardAnnotationScopeKey(context.scopeType, context.scopeRef);
  const list = state.annotationsByScope.get(key) || [];
  if (list.length === 0) return null;
  const own = list.find((annotation) => annotation.authorUserId === state.currentUserId);
  if (own) return own;
  return list.find((annotation) => annotation.visibility === 'teachers') || null;
};

const getOwnAnnotation = (state: AnnotationState, context: CellScopeContext) => {
  const key = buildDashboardAnnotationScopeKey(context.scopeType, context.scopeRef);
  const list = state.annotationsByScope.get(key) || [];
  return list.find((annotation) => annotation.authorUserId === state.currentUserId) || null;
};

const setAnnotations = (state: AnnotationState, annotations: DashboardAnnotationRecord[]) => {
  state.annotations = annotations || [];
  state.annotationsByScope.clear();
  state.annotations.forEach((annotation) => {
    const key = buildDashboardAnnotationScopeKey(annotation.scopeType, annotation.scopeRef);
    if (!state.annotationsByScope.has(key)) state.annotationsByScope.set(key, []);
    state.annotationsByScope.get(key)?.push(annotation);
  });
};

const upsertAnnotationInState = (state: AnnotationState, annotation: DashboardAnnotationRecord) => {
  const index = state.annotations.findIndex((entry) => entry.id === annotation.id);
  if (index >= 0) state.annotations[index] = annotation;
  else state.annotations.push(annotation);
  setAnnotations(state, state.annotations);
};

const removeAnnotationFromState = (state: AnnotationState, annotationId: string) => {
  setAnnotations(state, state.annotations.filter((annotation) => annotation.id !== annotationId));
};

const getSelectedAnnotationContexts = (state: AnnotationState, fallback: CellScopeContext) => {
  const sheet = state.selectedSheet;
  const ranges = sheet?.hot.getSelectedRange?.() || [];
  const contextsByKey = new Map<string, CellScopeContext>();
  ranges.forEach((range: any) => {
    const from = range.getTopStartCorner?.();
    const to = range.getBottomEndCorner?.();
    const startRow = Math.max(0, Math.min(Number(from?.row ?? 0), Number(to?.row ?? 0)));
    const endRow = Math.max(0, Math.max(Number(from?.row ?? 0), Number(to?.row ?? 0)));
    const startCol = Math.max(0, Math.min(Number(from?.col ?? 0), Number(to?.col ?? 0)));
    const endCol = Math.max(0, Math.max(Number(from?.col ?? 0), Number(to?.col ?? 0)));
    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        const context = sheet ? buildScopeContextFromCoords(sheet, row, col) : null;
        if (!context) continue;
        contextsByKey.set(buildDashboardAnnotationScopeKey(context.scopeType, context.scopeRef), context);
      }
    }
  });
  return contextsByKey.size ? Array.from(contextsByKey.values()) : [fallback];
};

const refreshAnnotationSheets = (state: AnnotationState) => {
  state.selectedSheet?.hot.render();
  document.querySelectorAll<HTMLElement>('[data-dashboard-grid]').forEach((node) => {
    const hot = (node as any).__handsontableInstance as Handsontable | undefined;
    hot?.render?.();
  });
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
  const response = await fetch('/api/dashboard/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courseId: normalizeText(state.meta.courseId),
      year: normalizeText(state.meta.year),
      subjectUserId: context.subjectUserId,
      field: context.field,
      tab: context.tab,
      scopeType: context.scopeType,
      scopeRef: context.scopeRef,
      color: normalizeDashboardAnnotationColor(patch.color),
      comment: normalizeDashboardAnnotationComment(patch.comment),
      visibility: normalizeDashboardAnnotationVisibility(patch.visibility),
      metadata: {
        ...(context.metadata || {}),
        rowLabel: context.rowLabel,
        columnLabel: context.columnLabel,
        scopeLabel: `${context.rowLabel} / ${context.columnLabel}`,
        studentName: context.rowLabel,
        tabLabel: context.tabLabel,
      },
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || 'No se pudo guardar la anotación');
  if (result?.annotation) upsertAnnotationInState(state, result.annotation);
  refreshAnnotationSheets(state);
};

const removeAnnotation = async (state: AnnotationState, annotationId: string) => {
  const response = await fetch(`/api/dashboard/annotations/${encodeURIComponent(annotationId)}`, {
    method: 'DELETE',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || 'No se pudo borrar la anotación');
  removeAnnotationFromState(state, annotationId);
  refreshAnnotationSheets(state);
};

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement
  || target instanceof HTMLTextAreaElement
  || target instanceof HTMLSelectElement
  || (target instanceof HTMLElement && target.isContentEditable);

const createAnnotationModal = (
  root: HTMLElement,
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

  (root.ownerDocument?.body || document.body).appendChild(overlay);

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
    return { open: () => {}, destroy: () => overlay.remove() };
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
        courseId: normalizeText(state.meta.courseId),
        year: normalizeText(state.meta.year),
      },
    };
    const selectedContexts = getSelectedAnnotationContexts(state, currentContext);
    const selectedCount = selectedContexts.length;
    const ownAnnotation = getOwnAnnotation(state, currentContext);
    const visibleAnnotation = getDisplayAnnotation(state, currentContext);
    const hasOwnAnnotation = selectedContexts.some((selectedContext) => Boolean(getOwnAnnotation(state, selectedContext)?.id));

    metaNode.textContent = selectedCount > 1
      ? `${currentContext.rowLabel} / ${currentContext.columnLabel} · ${selectedCount} celdas`
      : `${currentContext.rowLabel} / ${currentContext.columnLabel}`;
    visibleNode.textContent = selectedCount > 1
      ? `Se aplicará a ${selectedCount} celdas seleccionadas. Shortcut: M`
      : visibleAnnotation && visibleAnnotation.authorUserId !== ownAnnotation?.authorUserId
      ? `Visible ahora: ${visibleAnnotation.authorName || visibleAnnotation.authorEmail || 'Teacher'} · ${dashboardAnnotationVisibilityLabel(visibleAnnotation.visibility)}`
      : 'Shortcut: M';
    commentInput.value = ownAnnotation?.comment || '';
    colorSelect.value = ownAnnotation?.color || '';
    visibilitySelect.value = ownAnnotation?.visibility || 'teachers';
    deleteButton.disabled = !hasOwnAnnotation;

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
      const selectedContexts = getSelectedAnnotationContexts(state, currentContext);
      for (const selectedContext of selectedContexts) {
        await saveAnnotation(state, selectedContext, {
          color: normalizeDashboardAnnotationColor(colorSelect.value),
          comment: commentInput.value,
          visibility: normalizeDashboardAnnotationVisibility(visibilitySelect.value),
        });
      }
      close();
    } catch (error: any) {
      console.error('Error saving dashboard annotation:', error);
      showToast(error?.message || 'No se pudo guardar la anotación', 'error', 4000);
    } finally {
      saveButton.disabled = false;
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (!currentContext) return;
    const selectedContexts = getSelectedAnnotationContexts(state, currentContext);
    const ownAnnotationsById = new Map<string, DashboardAnnotationRecord>();
    selectedContexts.forEach((selectedContext) => {
      const annotation = getOwnAnnotation(state, selectedContext);
      if (annotation?.id) ownAnnotationsById.set(annotation.id, annotation);
    });
    const ownAnnotations = Array.from(ownAnnotationsById.values());
    if (!ownAnnotations.length) return;

    deleteButton.disabled = true;
    try {
      for (const annotation of ownAnnotations) {
        await removeAnnotation(state, annotation.id);
      }
      close();
    } catch (error: any) {
      console.error('Error deleting dashboard annotation:', error);
      showToast(error?.message || 'No se pudo borrar la anotación', 'error', 4000);
    } finally {
      deleteButton.disabled = false;
    }
  });

  const keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !overlay.hidden) close();
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

const applyAnnotationColorToSelection = async (
  state: AnnotationState,
  color: DashboardAnnotationColor | '',
  fallback: CellScopeContext,
) => {
  const contexts = getSelectedAnnotationContexts(state, fallback);
  for (const context of contexts) {
    const own = getOwnAnnotation(state, context);
    await saveAnnotation(state, context, {
      color,
      comment: own?.comment || '',
      visibility: own?.visibility || 'teachers',
    });
  }
};

const bindAnnotationShortcut = (
  state: AnnotationState,
  modalRef: { current: AnnotationModalApi | null },
) => {
  const handler = (event: KeyboardEvent) => {
    const key = normalizeTextLower(event.key);
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditableTarget(event.target)) return;

    if (key === 'f' && state.selectedSheet?.kind === 'teacher-main') {
      event.preventDefault();
      event.stopPropagation();
      if (isTeacherMainSheetFolded(state.selectedSheet)) unfoldSheet(state.selectedSheet);
      else foldTeacherMainSheet(state.selectedSheet);
      return;
    }

    if (!state.selectedContext) return;

    if (key === 'm') {
      event.preventDefault();
      event.stopPropagation();
      modalRef.current?.open(state.selectedContext);
      return;
    }

    const quickColorMap: Record<string, DashboardAnnotationColor | ''> = {
      v: 'green',
      b: 'yellow',
      n: 'red',
      x: '',
    };
    if (Object.prototype.hasOwnProperty.call(quickColorMap, key)) {
      event.preventDefault();
      event.stopPropagation();
      void applyAnnotationColorToSelection(state, quickColorMap[key], state.selectedContext)
        .catch((error) => {
          console.error('Error saving dashboard highlight:', error);
          showToast(error?.message || 'No se pudo guardar el highlight', 'error', 4000);
        });
    }
  };

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
};

const createAnnotationContextMenu = (
  state: AnnotationState | undefined,
  modalRef: { current: AnnotationModalApi | null } | undefined,
) => ({
  items: {
    undo: {},
    redo: {},
    separator_default_1: Handsontable.plugins.ContextMenu.SEPARATOR,
    copy: {},
    cut: {},
    separator_annotations_1: Handsontable.plugins.ContextMenu.SEPARATOR,
    annotation_comment: {
      name: 'Comentar celda <span class="dashboard-menu-shortcut">M</span>',
      callback: () => {
        if (!state?.selectedContext) return;
        modalRef?.current?.open(state.selectedContext);
      },
    },
    annotation_highlight: {
      name: 'Highlight',
      submenu: {
        items: [
          ...DASHBOARD_ANNOTATION_COLORS.map((color) => ({
            key: `annotation_highlight:${color}`,
            name: `<span class="dashboard-menu-color dashboard-menu-color--${escapeHtml(color)}"></span> ${escapeHtml(dashboardAnnotationColorLabel(color))}`,
            callback: () => {
              if (!state?.selectedContext) return;
              void applyAnnotationColorToSelection(state, color, state.selectedContext)
                .catch((error) => {
                  console.error('Error saving dashboard highlight:', error);
                  showToast(error?.message || 'No se pudo guardar el highlight', 'error', 4000);
                });
            },
          })),
          {
            key: 'annotation_highlight:none',
            name: '<span class="dashboard-menu-color"></span> Sin color',
            callback: () => {
              if (!state?.selectedContext) return;
              void applyAnnotationColorToSelection(state, '', state.selectedContext)
                .catch((error) => {
                  console.error('Error clearing dashboard highlight:', error);
                  showToast(error?.message || 'No se pudo limpiar el highlight', 'error', 4000);
                });
            },
          },
        ],
      },
    },
    separator_default_2: Handsontable.plugins.ContextMenu.SEPARATOR,
    alignment: {},
  },
});

const getAdminEnrollmentCourses = (rowData: any): AdminEnrollmentCourse[] =>
  (Array.isArray(rowData?.enrollmentCourses) ? rowData.enrollmentCourses : [])
    .map((item: any) => ({
      courseId: normalizeText(item?.courseId),
      label: normalizeText(item?.label || item?.courseId),
      enrollmentId: normalizeText(item?.enrollmentId),
      roleInCourse: normalizeTextLower(item?.roleInCourse || 'student') || 'student',
    }))
    .filter((item: AdminEnrollmentCourse) => item.courseId);

const getAdminEnrollmentCourseCatalog = (rowData: any): AdminEnrollmentCourseOption[] =>
  (Array.isArray(rowData?.enrollmentCourseCatalog) ? rowData.enrollmentCourseCatalog : [])
    .map((item: any) => ({
      courseId: normalizeText(item?.courseId),
      label: normalizeText(item?.label || item?.courseId),
    }))
    .filter((item: AdminEnrollmentCourseOption) => item.courseId);

const sortAdminEnrollmentCourses = (courses: AdminEnrollmentCourse[]) =>
  Array.from(
    new Map(
      (courses || [])
        .map((course) => {
          const courseId = normalizeText(course?.courseId);
          if (!courseId) return null;
          return [courseId, {
            courseId,
            label: normalizeText(course?.label || courseId),
            enrollmentId: normalizeText(course?.enrollmentId),
            roleInCourse: normalizeTextLower(course?.roleInCourse || 'student') || 'student',
          }] as const;
        })
        .filter(Boolean) as [string, AdminEnrollmentCourse][],
    ).values(),
  ).sort((left, right) => String(left.label || left.courseId).localeCompare(String(right.label || right.courseId), 'es'));

const formatAdminEnrollmentSummary = (courses: AdminEnrollmentCourse[]) =>
  courses.length ? courses.map((course) => normalizeText(course.label || course.courseId)).join(' · ') : '—';

const buildAdminEnrollmentSearchBlob = (rowData: any, courses: AdminEnrollmentCourse[]) =>
  [
    rowData?.name,
    rowData?.email,
    rowData?.globalRole,
    rowData?.courseRole,
    ...courses.map((course) => course.courseId),
    ...courses.map((course) => course.label),
    rowData?.lastActivityAt,
  ]
    .map((value) => normalizeTextLower(value))
    .filter(Boolean)
    .join(' ');

const getAdminEnrollmentCourseLabel = (rowData: any, courseId: string) => {
  const normalizedCourseId = normalizeText(courseId);
  if (!normalizedCourseId) return '';
  const enrolled = getAdminEnrollmentCourses(rowData)
    .find((course) => normalizeText(course.courseId) === normalizedCourseId);
  if (enrolled?.label) return normalizeText(enrolled.label);
  const catalog = getAdminEnrollmentCourseCatalog(rowData)
    .find((course) => normalizeText(course.courseId) === normalizedCourseId);
  return normalizeText(catalog?.label || normalizedCourseId);
};

const resolveActiveAdminEnrollmentCourse = (
  rowData: any,
  meta?: DashboardMeta,
): AdminEnrollmentCourse | null => {
  const courses = getAdminEnrollmentCourses(rowData);
  if (!courses.length) return null;

  const activeCourseId = normalizeText(meta?.courseId);
  if (activeCourseId) {
    const activeCourse = courses.find((course) => normalizeText(course.courseId) === activeCourseId) || null;
    if (activeCourse) return activeCourse;
  }

  const enrollmentId = normalizeText(rowData?.enrollmentId);
  if (enrollmentId) {
    const byEnrollmentId = courses.find((course) => normalizeText(course.enrollmentId) === enrollmentId) || null;
    if (byEnrollmentId) return byEnrollmentId;
  }

  return courses.length === 1 ? courses[0] : null;
};

const updateAdminEnrollmentRowData = (
  sheet: DashboardSheet,
  rowData: Record<string, any>,
  meta: DashboardMeta,
  nextCoursesInput: AdminEnrollmentCourse[],
) => {
  const nextCourses = sortAdminEnrollmentCourses(nextCoursesInput);
  const activeEnrollment = resolveActiveAdminEnrollmentCourse(
    {
      ...rowData,
      enrollmentCourses: nextCourses,
    },
    meta,
  );
  const nextCourseRole = normalizeTextLower(activeEnrollment?.roleInCourse || '');
  const nextValues = {
    enrollmentId: normalizeText(activeEnrollment?.enrollmentId || ''),
    enrollmentCourses: nextCourses,
    enrollmentSummary: formatAdminEnrollmentSummary(nextCourses),
    courseRole: nextCourseRole,
    courseRoleLabel: nextCourseRole ? (nextCourseRole === 'teacher' ? 'Teacher' : 'Student') : '—',
    __search: buildAdminEnrollmentSearchBlob({ ...rowData, courseRole: nextCourseRole }, nextCourses),
  };

  Object.assign(rowData, nextValues);
  const rowId = normalizeText(rowData.id || rowData.userId);
  sheet.allRows.forEach((candidate) => {
    if (candidate === rowData || (rowId && normalizeText(candidate.id || candidate.userId) === rowId)) {
      Object.assign(candidate, nextValues);
    }
  });
  sheet.activeRows.forEach((candidate) => {
    if (candidate === rowData || (rowId && normalizeText(candidate.id || candidate.userId) === rowId)) {
      Object.assign(candidate, nextValues);
    }
  });
  sheet.hot.render();
};

const getAdminEnrollmentContext = (sheet: DashboardSheet | null | undefined) => {
  if (!sheet || sheet.kind !== 'admin') return null;
  const coords = sheet.contextMenuCoords || null;
  const selected = coords ? null : sheet.hot.getSelectedLast?.();
  const visualRow = Number(coords?.row ?? selected?.[0]);
  const visualCol = Number(coords?.col ?? selected?.[1]);
  if (!Number.isInteger(visualRow) || !Number.isInteger(visualCol) || visualRow < 0 || visualCol < 0) return null;

  const physicalCol = sheet.hot.toPhysicalColumn(visualCol);
  const leaf = sheet.leafColumns[physicalCol] || sheet.leafColumns[visualCol];
  if (normalizeText(leaf?.kind) !== 'enrollment-courses') return null;

  const physicalRow = sheet.hot.toPhysicalRow(visualRow);
  const rowData = sheet.activeRows[physicalRow];
  if (!rowData) return null;
  return { rowData };
};

const getAdminContextRow = (sheet: DashboardSheet | null | undefined) => {
  if (!sheet || sheet.kind !== 'admin') return null;
  const coords = sheet.contextMenuCoords || null;
  const selected = coords ? null : sheet.hot.getSelectedLast?.();
  const visualRow = Number(coords?.row ?? selected?.[0]);
  if (!Number.isInteger(visualRow) || visualRow < 0) return null;
  return sheet.activeRows[sheet.hot.toPhysicalRow(visualRow)] || null;
};

const getAdminRowId = (rowData: any) => normalizeText(rowData?.userId || rowData?.id || rowData?.studentId);

const getAdminRowLabel = (rowData: any) =>
  normalizeText(rowData?.name || rowData?.email || getAdminRowId(rowData) || 'este usuario') || 'este usuario';

const getComparableUserName = (rowData: any) => {
  const name = normalizeText(rowData?.name);
  if (!name || name.includes('@') || name === '—') return '';
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
};

const getComparableUserEmail = (rowData: any) => {
  const email = normalizeText(rowData?.email).toLowerCase();
  return email && email !== '—' && email.includes('@') ? email : '';
};

const getSelectedAdminRows = (sheet: DashboardSheet) => {
  const rowsById = new Map<string, Record<string, any>>();
  const addRow = (rowData: any) => {
    const rowId = getAdminRowId(rowData);
    if (rowId) rowsById.set(rowId, rowData);
  };

  sheet.activeRows.forEach((rowData) => {
    if (rowData?.__rowSelect === true) addRow(rowData);
  });
  if (rowsById.size > 0) return Array.from(rowsById.values());

  (sheet.hot.getSelectedRange?.() || []).forEach((range: any) => {
    const from = range.getTopStartCorner?.();
    const to = range.getBottomEndCorner?.();
    const startRow = Math.max(0, Math.min(Number(from?.row ?? 0), Number(to?.row ?? 0)));
    const endRow = Math.max(0, Math.max(Number(from?.row ?? 0), Number(to?.row ?? 0)));
    for (let visualRow = startRow; visualRow <= endRow; visualRow += 1) {
      addRow(sheet.activeRows[sheet.hot.toPhysicalRow(visualRow)]);
    }
  });

  return Array.from(rowsById.values());
};

const isVisualCellInSelection = (sheet: DashboardSheet, visualRow: number, visualCol: number) =>
  (sheet.hot.getSelectedRange?.() || []).some((range: any) => {
    const from = range.getTopStartCorner?.();
    const to = range.getBottomEndCorner?.();
    const startRow = Math.min(Number(from?.row ?? 0), Number(to?.row ?? 0));
    const endRow = Math.max(Number(from?.row ?? 0), Number(to?.row ?? 0));
    const startCol = Math.min(Number(from?.col ?? 0), Number(to?.col ?? 0));
    const endCol = Math.max(Number(from?.col ?? 0), Number(to?.col ?? 0));
    return visualRow >= startRow && visualRow <= endRow && visualCol >= startCol && visualCol <= endCol;
  });

const collectAdminEnrollmentCourseOptions = (rows: Record<string, any>[]) =>
  Array.from<AdminEnrollmentCourseOption>(
    rows.reduce((acc, row) => {
      getAdminEnrollmentCourseCatalog(row).forEach((course) => {
        if (!course.courseId || acc.has(course.courseId)) return;
        acc.set(course.courseId, course);
      });
      getAdminEnrollmentCourses(row).forEach((course) => {
        if (!course.courseId || acc.has(course.courseId)) return;
        acc.set(course.courseId, { courseId: course.courseId, label: course.label || course.courseId });
      });
      return acc;
    }, new Map<string, AdminEnrollmentCourseOption>()).values(),
  ).sort((left, right) => String(left.label || left.courseId).localeCompare(String(right.label || right.courseId), 'es'));

const getCourseToneClass = (courseIdInput: string) => {
  const courseId = normalizeText(courseIdInput);
  let hash = 0;
  for (let index = 0; index < courseId.length; index += 1) {
    hash = (hash * 31 + courseId.charCodeAt(index)) % 6;
  }
  return `dashboard-course-tag--tone-${hash}`;
};

const sanitizeHandsontableHtml = (content: string, source: 'innerHTML' | 'CopyPaste.paste') =>
  source === 'CopyPaste.paste' ? escapeHtml(content) : content;

const addAdminEnrollmentToSheetRow = async (
  sheet: DashboardSheet,
  rowData: Record<string, any>,
  meta: DashboardMeta,
  courseIdInput: string,
) => {
  const userId = normalizeText(rowData.id || rowData.userId);
  const userEmail = normalizeText(rowData.email);
  const userName = normalizeText(rowData.name || rowData.email || 'este usuario') || 'este usuario';
  const courseId = normalizeText(courseIdInput);
  if (!courseId) throw new Error('Elegí un curso para inscribir.');
  if (!userId && (!userEmail || !userEmail.includes('@'))) {
    throw new Error('No se encontró un usuario válido para inscribir.');
  }

  const response = await fetch('/api/admin/add-student-manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courseId,
      year: meta.year,
      userId,
      email: userEmail,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'No se pudo inscribir');

  const enrollment = payload?.enrollment && typeof payload.enrollment === 'object'
    ? payload.enrollment
    : null;
  const nextEnrollment: AdminEnrollmentCourse = {
    courseId: normalizeText(enrollment?.courseId || courseId),
    label: getAdminEnrollmentCourseLabel(rowData, courseId),
    enrollmentId: normalizeText(enrollment?.id),
    roleInCourse: normalizeTextLower(enrollment?.roleInCourse || 'student') || 'student',
  };
  const nextCourses = sortAdminEnrollmentCourses([
    ...getAdminEnrollmentCourses(rowData).filter((course) => course.courseId !== nextEnrollment.courseId),
    nextEnrollment,
  ]);
  updateAdminEnrollmentRowData(sheet, rowData, meta, nextCourses);

  const courseLabel = getAdminEnrollmentCourseLabel({ ...rowData, enrollmentCourses: nextCourses }, nextEnrollment.courseId);
  showToast(
    payload?.status === 'already_enrolled'
      ? `${userName} ya estaba inscripto en ${courseLabel}.`
      : `${userName} fue inscripto en ${courseLabel}.`,
    'success',
    2800,
  );
};

const removeAdminEnrollmentFromSheetRow = async (
  sheet: DashboardSheet,
  rowData: Record<string, any>,
  meta: DashboardMeta,
  enrollmentIdInput: string,
) => {
  const enrollmentId = normalizeText(enrollmentIdInput);
  if (!enrollmentId) throw new Error('No se encontró la inscripción.');

  const response = await fetch('/api/enroll', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'No se pudo desinscribir');

  updateAdminEnrollmentRowData(
    sheet,
    rowData,
    meta,
    getAdminEnrollmentCourses(rowData).filter((course) => normalizeText(course.enrollmentId) !== enrollmentId),
  );
};

const mergeAdminEnrollmentCourseLists = (keepRow: any, mergeRow: any) => {
  const byCourseId = new Map<string, AdminEnrollmentCourse>();
  getAdminEnrollmentCourses(keepRow).forEach((course) => byCourseId.set(course.courseId, course));
  getAdminEnrollmentCourses(mergeRow).forEach((course) => {
    if (!byCourseId.has(course.courseId)) byCourseId.set(course.courseId, course);
  });
  return sortAdminEnrollmentCourses(Array.from(byCourseId.values()));
};

const getAdminMergeContext = (sheet: DashboardSheet) => {
  const selectedRows = getSelectedAdminRows(sheet);
  if (selectedRows.length !== 2) return null;

  const [firstRow, secondRow] = selectedRows;
  const firstName = getComparableUserName(firstRow);
  const secondName = getComparableUserName(secondRow);
  const firstEmail = getComparableUserEmail(firstRow);
  const secondEmail = getComparableUserEmail(secondRow);
  const nameMatch = Boolean(firstName && secondName && firstName === secondName);
  const emailMatch = Boolean(firstEmail && secondEmail && firstEmail === secondEmail);
  const contextRow = getAdminContextRow(sheet);
  const contextRowId = getAdminRowId(contextRow);
  const firstRowId = getAdminRowId(firstRow);
  const secondRowId = getAdminRowId(secondRow);
  const contextIsSelected = contextRowId && (contextRowId === firstRowId || contextRowId === secondRowId);
  if (!contextIsSelected) {
    return { valid: false, reason: 'Click derecho sobre uno de los dos usuarios seleccionados.' };
  }
  if (!nameMatch && !emailMatch) {
    return { valid: false, reason: 'Los usuarios no comparten nombre ni email.' };
  }

  const keepRow = contextRowId === firstRowId ? firstRow : secondRow;
  const mergeRow = contextRowId === firstRowId ? secondRow : firstRow;
  return {
    valid: true,
    keepRow,
    mergeRow,
    matchLabel: emailMatch ? 'email igual' : 'nombre repetido',
  };
};

const mergeAdminUsersInSheet = async (
  sheet: DashboardSheet,
  meta: DashboardMeta,
  keepRow: Record<string, any>,
  mergeRow: Record<string, any>,
  matchLabel: string,
) => {
  const keepId = getAdminRowId(keepRow);
  const mergeId = getAdminRowId(mergeRow);
  const keepName = getAdminRowLabel(keepRow);
  const mergeName = getAdminRowLabel(mergeRow);
  if (!keepId || !mergeId || keepId === mergeId) throw new Error('No se encontraron dos usuarios distintos para fusionar.');
  const confirmMessage = [
    `¿Fusionar "${mergeName}" dentro de "${keepName}"?`,
    `Se conservará "${keepName}" porque hiciste click derecho sobre ese usuario.`,
    `Motivo: ${matchLabel}.`,
  ].join('\n');
  if (!window.confirm(confirmMessage)) return;

  const response = await fetch('/api/admin/users/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keepId, mergeId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'No se pudo fusionar usuarios');

  updateAdminEnrollmentRowData(sheet, keepRow, meta, mergeAdminEnrollmentCourseLists(keepRow, mergeRow));
  const removeMergedRow = (rows: Record<string, any>[]) => rows.filter((row) => getAdminRowId(row) !== mergeId);
  sheet.allRows.splice(0, sheet.allRows.length, ...removeMergedRow(sheet.allRows));
  sheet.activeRows.splice(0, sheet.activeRows.length, ...removeMergedRow(sheet.activeRows));
  setSheetRows(sheet, sheet.activeRows, 'filter');
  showToast(
    `Usuarios fusionados. ${payload?.transferredEmails || 0} emails, ${payload?.transferredEnrollments || 0} matrículas y ${payload?.transferredSubmissions || 0} entregas transferidas.`,
    'success',
    4200,
  );
};

const buildAdminEnrollmentContextMenuItems = (
  sheet: DashboardSheet,
  rows: Record<string, any>[],
  meta: DashboardMeta,
) => {
  const context = getAdminEnrollmentContext(sheet);
  if (!context) return null;

  const courseOptions = collectAdminEnrollmentCourseOptions(rows);
  const enrolledCourses = getAdminEnrollmentCourses(context.rowData);
  const enrolledCourseIds = new Set(enrolledCourses.map((course) => normalizeText(course.courseId)));
  const availableCourses = courseOptions.filter((course) => !enrolledCourseIds.has(normalizeText(course.courseId)));
  const userName = normalizeText(context.rowData.name || context.rowData.email || 'este usuario') || 'este usuario';
  const menuItems: any[] = [
    { key: 'admin_enroll_header', name: 'Inscribir en curso', disabled: true },
  ];

  if (availableCourses.length) {
    availableCourses.forEach((course, index) => {
      const label = getAdminEnrollmentCourseLabel(context.rowData, course.courseId);
      menuItems.push({
        key: `admin_enroll_${index}`,
        name: `Inscribir en ${escapeHtml(label)}`,
        callback: () => {
          void addAdminEnrollmentToSheetRow(sheet, context.rowData, meta, course.courseId)
            .catch((error) => {
              console.warn(error?.message || 'No se pudo inscribir');
              showToast(error?.message || 'No se pudo inscribir', 'error', 4000);
            });
        },
      });
    });
  } else {
    menuItems.push({ key: 'admin_enroll_empty', name: 'Sin cursos disponibles', disabled: true });
  }

  menuItems.push(Handsontable.plugins.ContextMenu.SEPARATOR);
  menuItems.push({ key: 'admin_unenroll_header', name: 'Borrar inscripción activa', disabled: true });

  if (enrolledCourses.length) {
    enrolledCourses.forEach((course, index) => {
      const label = getAdminEnrollmentCourseLabel(context.rowData, course.courseId);
      menuItems.push({
        key: `admin_unenroll_${index}`,
        name: `Borrar inscripción en ${escapeHtml(label)}`,
        disabled: !normalizeText(course.enrollmentId),
        callback: () => {
          const confirmMsg = normalizeTextLower(course.roleInCourse) === 'teacher'
            ? `¿Quitar inscripción docente de ${userName} en ${label}?`
            : `¿Desinscribir a ${userName} de ${label}?`;
          if (!window.confirm(confirmMsg)) return;
          void removeAdminEnrollmentFromSheetRow(sheet, context.rowData, meta, course.enrollmentId)
            .then(() => showToast(`${userName} fue desinscripto de ${label}.`, 'success', 2800))
            .catch((error) => {
              console.warn(error?.message || 'No se pudo desinscribir');
              showToast(error?.message || 'No se pudo desinscribir', 'error', 4000);
            });
        },
      });
    });
  } else {
    menuItems.push({ key: 'admin_unenroll_empty', name: 'Sin inscripciones activas', disabled: true });
  }

  return menuItems;
};

const buildAdminMergeContextMenuItems = (sheet: DashboardSheet, meta: DashboardMeta) => {
  const mergeContext = getAdminMergeContext(sheet);
  if (!mergeContext) return null;
  if (mergeContext.valid) {
    const keepName = getAdminRowLabel(mergeContext.keepRow);
    const mergeName = getAdminRowLabel(mergeContext.mergeRow);
    return [{
      key: 'admin_merge_users',
      name: `Fusionar usuarios: ${escapeHtml(mergeName)} → ${escapeHtml(keepName)}`,
      callback: () => {
        void mergeAdminUsersInSheet(
          sheet,
          meta,
          mergeContext.keepRow,
          mergeContext.mergeRow,
          mergeContext.matchLabel,
        ).catch((error) => {
          console.warn(error?.message || 'No se pudo fusionar usuarios');
          showToast(error?.message || 'No se pudo fusionar usuarios', 'error', 4500);
        });
      },
    }];
  }
  return [{
    key: 'admin_merge_users_disabled',
    name: `Fusionar usuarios (${escapeHtml(mergeContext.reason)})`,
    disabled: true,
  }];
};

const buildTeacherMainUnenrollContextMenuItem = (
  sheet: DashboardSheet,
) => {
  const coords = sheet.contextMenuCoords || null;
  const selected = coords ? null : sheet.hot.getSelectedLast?.();
  const visualRow = Number(coords?.row ?? selected?.[0]);
  if (!Number.isInteger(visualRow) || visualRow < 0) return null;

  const rowData = sheet.activeRows[sheet.hot.toPhysicalRow(visualRow)];
  if (!rowData) return null;
  const enrollmentId = normalizeText(rowData.enrollmentId);
  const studentName = normalizeText(
    [rowData.lastName, rowData.firstName].filter(Boolean).join(' ')
      || rowData.name
      || rowData.email
      || 'este alumno',
  ) || 'este alumno';

  return {
    key: 'teacher_main_unenroll',
    name: 'Desuscribir del curso',
    disabled: !enrollmentId,
    callback: () => {
      if (!enrollmentId || !window.confirm(`¿Desuscribir a ${studentName} de este curso?`)) return;
      void fetch('/api/enroll', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId }),
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || 'No se pudo desuscribir al alumno');
          showToast(`${studentName} fue desuscripto del curso.`, 'success', 2200);
          window.setTimeout(() => window.location.reload(), 450);
        })
        .catch((error) => {
          console.warn(error?.message || 'No se pudo desuscribir al alumno');
          showToast(error?.message || 'No se pudo desuscribir al alumno', 'error', 4000);
        });
    },
  };
};

const createDashboardContextMenu = (
  kind: GridKind,
  getSheet: () => DashboardSheet | null,
  rows: Record<string, any>[],
  meta: DashboardMeta,
  annotationState?: AnnotationState,
  modalRef?: { current: AnnotationModalApi | null },
) => {
  if (isAnnotationGridKind(kind)) return createAnnotationContextMenu(annotationState, modalRef);
  if (kind === 'admin') return true;
  return true;
};

const resolveAttendanceMeta = (rowData: any, field: string) => rowData?.__attendanceCellMeta?.[field] || null;

const computeAttendanceSummaryFields = (rowData: any) => {
  let attendanceUnits = 0;
  let absenceUnits = 0;
  let scheduledDayCount = 0;
  Object.values(rowData?.__attendanceCellMeta || {}).forEach((entry: any) => {
    if (!entry?.countsTowardAbsence) return;
    scheduledDayCount += 1;
    const liveValue = Number(entry?.liveValue || 0);
    const hasAnyData = Boolean(entry?.hasManualOverride) || liveValue > 0;
    const effective = hasAnyData ? Number(entry?.effectiveValue || 0) : 1;
    attendanceUnits += Math.max(0, effective);
    absenceUnits += Math.max(0, 1 - effective);
  });
  return {
    attendanceRate: scheduledDayCount > 0 ? Math.round((attendanceUnits / scheduledDayCount) * 1000) / 10 : 0,
    attendanceCount: attendanceUnits,
    attendanceTotalCount: scheduledDayCount,
    absenceUnits,
    absenceDisplay: formatAbsence(absenceUnits),
  };
};

const applyAttendanceLocalState = (sheet: DashboardSheet, visualRow: number, field: string, manualCount: number | null) => {
  const rowData = sheet.activeRows[sheet.hot.toPhysicalRow(visualRow)];
  const cellMeta = resolveAttendanceMeta(rowData, field);
  if (!rowData || !cellMeta) return;
  const liveValue = Number(cellMeta.liveValue || 0);
  const hasManualOverride = manualCount !== null;
  const effectiveValue = hasManualOverride ? Math.max(0, Math.min(1, Number(manualCount))) : liveValue;
  cellMeta.hasManualOverride = hasManualOverride;
  cellMeta.manualValue = hasManualOverride ? effectiveValue : 0;
  cellMeta.effectiveValue = effectiveValue;
  if (hasManualOverride || liveValue > 0) cellMeta.isClassDay = true;
  cellMeta.countsTowardAbsence = !cellMeta.isFuture && Boolean(cellMeta.isClassDay);
  rowData[field] = hasManualOverride ? attendanceSymbol(effectiveValue) : attendanceSymbol(liveValue, true);
  Object.assign(rowData, computeAttendanceSummaryFields(rowData));
  sheet.hot.render();
};

const postStudentMeta = async (meta: DashboardMeta, studentId: string, patch: Record<string, any>) => {
  const label = Object.keys(patch)[0] || 'dato';
  setDashboardSaveStatus('saving', `Guardando ${label}...`);
  const response = await fetch('/api/grade/course-student-meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId: meta.courseId, year: meta.year, studentId, ...patch }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    setDashboardSaveStatus('error', payload?.error || 'No se pudo guardar');
    throw new Error(payload?.error || 'No se pudo guardar');
  }
  setDashboardSaveStatus('saved', `${label} guardado.`);
  return payload;
};

const getColumnKind = (sheet: DashboardSheet, prop: unknown) =>
  normalizeText(sheet.leafColumns.find((column) => column.field === String(prop))?.kind);

const persistCellChange = async (sheet: DashboardSheet, meta: DashboardMeta, visualRow: number, prop: string, oldValue: any, newValue: any) => {
  const rowData = sheet.activeRows[sheet.hot.toPhysicalRow(visualRow)];
  if (!rowData || oldValue === newValue) return;
  const kind = getColumnKind(sheet, prop);
  if (!isEditableKind(kind)) return;

  if (kind === 'attendance-day') {
    const cellMeta = resolveAttendanceMeta(rowData, prop);
    const studentId = normalizeText(rowData.studentId || rowData.id);
    const dateKey = normalizeText(cellMeta?.dateKey);
    const normalized = normalizeAttendanceInput(newValue);
    if (!normalized.valid || !studentId || !dateKey || !meta.courseId || !meta.year) {
      rowData[prop] = oldValue;
      sheet.hot.render();
      return;
    }
    applyAttendanceLocalState(sheet, visualRow, prop, normalized.countRaw);
    setDashboardSaveStatus('saving', `Guardando asistencia ${dateKey}...`);
    const response = await fetch('/api/grade/course-attendance-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: meta.courseId, year: meta.year, studentId, date: dateKey, countRaw: normalized.countRaw }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      rowData[prop] = oldValue;
      sheet.hot.render();
      setDashboardSaveStatus('error', payload?.error || 'No se pudo guardar asistencia');
      throw new Error(payload?.error || 'No se pudo guardar asistencia');
    }
    applyAttendanceLocalState(sheet, visualRow, prop, typeof payload?.meta?.count === 'number' ? payload.meta.count : normalized.countRaw);
    setDashboardSaveStatus('saved', `Asistencia guardada: ${dateKey}.`);
    return;
  }

  if (isCourseStudentMetaKind(kind)) {
    const studentId = normalizeText(rowData.studentId || rowData.id || rowData.userId);
    const patchKey = getMetaPatchKey(kind);
    const normalized = normalizeCourseStudentMetaValue(kind, newValue);
    if (!studentId || !patchKey || !meta.courseId || !meta.year) {
      rowData[prop] = oldValue;
      sheet.hot.render();
      return;
    }
    rowData[prop] = normalized || '—';
    const payload = await postStudentMeta(meta, studentId, { [patchKey]: normalized });
    const responseKey = kind === 'final-grade' ? 'notaFinal' : kind === 'concepto' ? 'concepto' : patchKey;
    rowData[prop] = payload?.meta?.[responseKey] || normalized || '—';
    sheet.hot.render();
    return;
  }

  if (kind === 'editable-text') {
    const userId = normalizeText(rowData.userId || rowData.id || rowData.studentId);
    const field = prop === 'email' ? 'email' : 'name';
    if (!userId) return;
    setDashboardSaveStatus('saving', `Guardando ${field}...`);
    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: meta.courseId, [field]: normalizeText(newValue) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      rowData[prop] = oldValue;
      sheet.hot.render();
      setDashboardSaveStatus('error', payload?.error || `No se pudo guardar ${field}`);
      throw new Error(payload?.error || `No se pudo guardar ${field}`);
    }
    rowData[prop] = payload?.user?.[field] || newValue;
    setDashboardSaveStatus('saved', `${field} guardado.`);
  }
};

const renderRole = (value: unknown) => {
  const role = normalizeTextLower(value);
  const label = role === 'admin' ? 'Admin' : role === 'teacher' ? 'Teacher' : role === 'student' ? 'Student' : normalizeText(value) || '—';
  return `<span class="role-badge role-badge--${escapeHtml(role || 'student')}">${escapeHtml(label)}</span>`;
};

const renderScore = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '<span class="dashboard-val-empty">—</span>';
  const num = Number(value);
  if (!Number.isFinite(num)) return `<span class="dashboard-grade-check">${escapeHtml(value)}</span>`;
  const cls = num >= 7 ? 'dashboard-score-high' : num >= 4 ? 'dashboard-score-mid' : 'dashboard-score-low';
  return `<span class="dashboard-score-pill ${cls}">${num.toFixed(1)}</span>`;
};

const renderProgress = (value: unknown) => {
  const val = Math.max(0, Math.min(100, Number(value || 0)));
  const color = val < 60 ? '#ef4444' : val < 80 ? '#f59e0b' : '#10b981';
  return `<div class="dashboard-progress-wrap"><div class="dashboard-progress-bg"><div class="dashboard-progress-bar" style="width:${val}%;background:${color}"></div></div><span class="dashboard-progress-label">${val.toFixed(1)}%</span></div>`;
};

const renderTinyValue = (value: unknown, kind: string) => {
  if (value === null || value === undefined || value === '') return '<span class="dashboard-val-empty">—</span>';
  if (kind === 'absence') return escapeHtml(formatAbsence(value));
  const numeric = Number(value);
  if (Number.isFinite(numeric) && ['score', 'grade-score', 'attendance-progress', 'metric', 'percent', 'concepto', 'final-grade'].includes(kind)) {
    return escapeHtml(Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1).replace(/\.0$/, ''));
  }
  return escapeHtml(value);
};

const renderEnrollmentCourses = (rowData: any) => {
  const courses = getAdminEnrollmentCourses(rowData);
  if (!courses.length) return '<span class="dashboard-val-empty">—</span>';
  return `<div class="dashboard-enrollment-cell">${courses.map((course: any) =>
    `<span class="dashboard-course-tag enrollment-chip ${getCourseToneClass(course.courseId)}" data-course-id="${escapeHtml(course.courseId)}" title="${escapeHtml(getAdminEnrollmentCourseLabel(rowData, course.courseId))}">${escapeHtml(getAdminEnrollmentCourseLabel(rowData, course.courseId))}</span>`
  ).join('')}</div>`;
};

const renderAdminActions = (rowData: any) => {
  const userId = escapeHtml(rowData?.userId || rowData?.id || '');
  const name = escapeHtml(rowData?.name || 'usuario');
  return `<div class="dashboard-admin-actions">
    <button type="button" data-dashboard-user-edit data-user-id="${userId}" title="Editar ${name}">✎</button>
    <button type="button" data-dashboard-user-delete data-user-id="${userId}" data-user-name="${name}" title="Borrar ${name}">×</button>
  </div>`;
};

const dashboardRenderer = (instance: Handsontable, td: HTMLTableCellElement, row: number, col: number, prop: string | number, value: any, cellProperties: Handsontable.CellProperties) => {
  Handsontable.dom.empty(td);
  const sheet = (instance as any).__musikiSheet as DashboardSheet | undefined;
  const sourceCol = instance.toPhysicalColumn(col);
  const leaf = sheet?.leafColumns.find((column) => column.field === String(prop))
    || sheet?.leafColumns[sourceCol]
    || sheet?.leafColumns[col];
  const kind = normalizeText(leaf?.kind);
  const isTinyCell = isTinyDashboardColumn(leaf);
  const rowData = sheet?.activeRows[instance.toPhysicalRow(row)] || {};
  td.className = `${td.className || ''} dashboard-hot-cell ${leaf?.cssClass || ''}`.trim();
  td.classList.remove('dashboard-absence-cell--notice', 'dashboard-absence-cell--warning', 'dashboard-absence-cell--critical');
  td.classList.toggle('dashboard-hot-cell--tiny', isTinyDashboardColumn(leaf));
  td.dataset.field = normalizeText(prop);
  td.dataset.kind = kind;
  td.style.textAlign = leaf?.hozAlign || '';
  td.style.height = `${DASHBOARD_ROW_HEIGHT}px`;
  td.style.padding = '0 3px';
  td.style.lineHeight = `${DASHBOARD_ROW_HEIGHT - 4}px`;
  td.style.boxSizing = 'border-box';

  if (kind === 'row-select') {
    Handsontable.renderers.CheckboxRenderer(instance, td, row, col, prop, value, cellProperties);
    return td;
  }

  let html = '';
  if (kind === 'absence') {
    const severity = getAbsenceSeverity(value);
    if (severity) td.classList.add(`dashboard-absence-cell--${severity}`);
    html = `<span class="dashboard-absence-count">${escapeHtml(formatAbsence(value))}</span>`;
  } else if (isTinyCell && kind !== 'attendance-day') html = renderTinyValue(value, kind);
  else if (kind === 'score' || kind === 'grade-score') html = renderScore(value);
  else if (kind === 'attendance-progress') html = renderProgress(value);
  else if (kind === 'percent') html = `${Number(value || 0).toFixed(1)}%`;
  else if (kind === 'datetime') html = escapeHtml(formatSubmissionDate(value));
  else if (kind === 'relative-datetime') html = `<span title="${escapeHtml(formatSubmissionDate(value))}">${escapeHtml(formatRelativeDate(value))}</span>`;
  else if (kind === 'role') html = renderRole(value);
  else if (kind === 'attendance-day') {
    const meta = resolveAttendanceMeta(rowData, String(prop));
    const symbol = normalizeText(value) || attendanceSymbol(meta?.effectiveValue ?? meta?.liveValue, true) || '—';
    const mod = symbol === '✓' ? 'present' : symbol === '~' ? 'late' : symbol === 'x' ? 'absent' : 'empty';
    td.classList.add(`dashboard-attendance-cell--${mod}`);
    html = `<span class="dashboard-attendance-chip" title="${escapeHtml(meta?.title || '')}">${escapeHtml(symbol)}</span>`;
  } else if (kind === 'enrollment-courses') html = renderEnrollmentCourses(rowData);
  else if (kind === 'admin-actions') html = renderAdminActions(rowData);
  else html = value === null || value === undefined || value === '' ? '<span class="dashboard-val-empty">—</span>' : escapeHtml(value);

  const annotation = getDisplayAnnotation(sheet?.annotationState, sheet ? buildScopeContextFromCoords(sheet, row, col) : null);
  const annotationColor = normalizeDashboardAnnotationColor(annotation?.color);
  const annotationComment = normalizeDashboardAnnotationComment(annotation?.comment);
  if (annotationColor || annotationComment) {
    html = `<div class="dashboard-annotation-shell ${annotationColor ? `dashboard-annotation-shell--${escapeHtml(annotationColor)}` : ''}">
      <div class="dashboard-annotation-shell__content">${html}</div>
      ${annotationComment ? `<span class="dashboard-annotation-dot" title="${escapeHtml(annotationComment)}">M</span>` : ''}
    </div>`;
  }
  td.innerHTML = html;
  return td;
};

const buildHotColumns = (
  leafColumns: LeafColumn[],
  compactWidths?: Map<string, number>,
  userWidths?: Map<string, number>,
) =>
  leafColumns.map((column) => {
    const kind = normalizeText(column.kind);
    const base: Handsontable.ColumnSettings = {
      data: column.field,
      width: resolveColumnWidth(column, compactWidths, userWidths),
      renderer: dashboardRenderer,
      readOnly: !isEditableKind(kind) && kind !== 'row-select',
    };
    if (kind === 'row-select') {
      base.type = 'checkbox';
      base.readOnly = false;
    } else if (kind === 'turno') {
      base.type = 'dropdown';
      base.source = ['M', 'T', 'N'];
    } else if (kind === 'concepto' || kind === 'final-grade') {
      base.type = 'numeric';
    }
    return base;
  });

const createSheet = (
  element: HTMLElement,
  projection: GridProjection,
  kind: GridKind,
  meta: DashboardMeta,
  annotationState?: AnnotationState,
  modalRef?: { current: AnnotationModalApi | null },
) => {
  const leafColumns = flattenColumns(projection?.columns || []);
  const projectionColumns = projection?.columns || [];
  const allRows = (Array.isArray(projection?.rows) ? projection.rows : []).map((row) => ({ ...row }));
  const activeRows = [...allRows];
  const hiddenFields = new Set<string>();
  const compactWidths = new Map<string, number>();
  const columnWidthKey = getColumnPersistKey(meta, kind);
  const userWidths = readColumnWidths(columnWidthKey);
  const rowHeaderWidth = kind === 'teacher-main' ? TINY_COLUMN_WIDTH : 34;
  let sheetRef: DashboardSheet | null = null;

  element.classList.add('dashboard-sheet', 'ht-theme-main');
  element.dataset.rangeSelection = ['teacher-main', 'overview', 'gradebook', 'attendance-summary'].includes(kind) ? 'true' : 'false';
  element.style.setProperty('--dashboard-row-header-width', `${rowHeaderWidth}px`);
  element.style.setProperty('--ht-cell-vertical-padding', '0px');
  element.style.setProperty('--ht-line-height', `${DASHBOARD_ROW_HEIGHT - 4}px`);

  const hot = new Handsontable(element, {
    data: activeRows,
    columns: buildHotColumns(leafColumns, compactWidths, userWidths),
    nestedHeaders: buildNestedHeaders(leafColumns, kind),
    sanitizer: sanitizeHandsontableHtml,
    rowHeaders: true,
    rowHeaderWidth,
    rowHeights: DASHBOARD_ROW_HEIGHT - 5,
    columnHeaderHeight: 28,
    height: ['comments', 'teacher-eval'].includes(kind) ? '34vh' : '100%',
    width: '100%',
    stretchH: ['teacher-main', 'gradebook', 'admin'].includes(kind) ? 'none' : 'all',
    autoColumnSize: false,
    autoRowSize: false,
    colWidths: (visualCol) => {
      return resolveVisualColumnWidth(
        leafColumns,
        visualCol,
        sheetRef?.compactWidths || compactWidths,
        sheetRef?.userWidths || userWidths,
        sheetRef?.hot,
      );
    },
    modifyColWidth: (width, visualCol) => {
      return resolveForcedVisualColumnWidth(leafColumns, visualCol, kind, compactWidths, userWidths) || width;
    },
    beforeStretchingColumnWidth: (width, visualCol) => {
      return resolveForcedVisualColumnWidth(leafColumns, visualCol, kind, compactWidths, userWidths) || width;
    },
    modifyRowHeaderWidth: () => rowHeaderWidth,
    modifyRowHeight: () => DASHBOARD_ROW_HEIGHT,
    licenseKey: 'non-commercial-and-evaluation',
    contextMenu: createDashboardContextMenu(
      kind,
      () => sheetRef,
      allRows,
      meta,
      annotationState,
      modalRef,
    ),
    dropdownMenu: true,
    filters: true,
    manualColumnMove: true,
    manualColumnResize: true,
    manualRowResize: true,
    multiColumnSorting: true,
    copyPaste: true,
    fillHandle: true,
    outsideClickDeselects: false,
    selectionMode: 'multiple',
    fixedColumnsStart: kind === 'teacher-main' || kind === 'gradebook' ? Math.min(2, leafColumns.length) : 0,
    hiddenColumns: { columns: [], indicators: true },
    afterChange: (changes, source) => {
      if (!changes?.length || ['loadData', 'updateData', 'filter', 'HiddenColumns.hide', 'HiddenColumns.show'].includes(String(source))) return;
      const sheet = sheetRef || { hot, kind, element, projectionColumns, allRows, activeRows, leafColumns, hiddenFields, compactWidths, userWidths, annotationState, modalRef };
      void Promise.all(changes.map(([visualRow, prop, oldValue, newValue]) =>
        persistCellChange(sheet, meta, Number(visualRow), String(prop), oldValue, newValue)
      )).catch((error) => console.error('Dashboard sheet save failed:', error));
    },
    afterGetColHeader: (visualCol, th) => {
      if (visualCol < 0 || !(th instanceof HTMLElement)) return;
      const sourceCol = sheetRef?.hot.toPhysicalColumn(visualCol) ?? visualCol;
      const leaf = leafColumns[sourceCol] || leafColumns[visualCol];
      if (!leaf) return;
      if (leaf.cssClass) {
        leaf.cssClass.split(/\s+/).filter(Boolean).forEach((className) => th.classList.add(className));
      }
      if (normalizeText(leaf.kind) === 'row-select') {
        th.dataset.field = leaf.field;
        th.title = '';
        th.querySelector('.colHeader')?.replaceChildren();
        return;
      }
      const width = resolveColumnWidth(leaf, sheetRef?.compactWidths || compactWidths, sheetRef?.userWidths || userWidths);
      const headerText = normalizeText(th.textContent);
      const isLeafHeader = headerText === normalizeText(getShortHeaderLabel(leaf, leaf.sourcePath.length - 1))
        || headerText === normalizeText(leaf.title)
        || headerText === normalizeText(leaf.field);
      const matchingHeaderLevel = leaf.sourcePath.findIndex((_, level) =>
        headerText === normalizeText(getShortHeaderLabel(leaf, level))
        || headerText === normalizeText(leaf.sourcePath[level]),
      );
      th.classList.toggle('dashboard-hot-header--tiny', isLeafHeader && isTinyDashboardColumn(leaf));
      th.classList.toggle('dashboard-hot-header--vertical', isLeafHeader && shouldUseVerticalHeader(leaf, width));
      if (isLeafHeader) {
        th.dataset.field = leaf.field;
        th.title = normalizeText(leaf.title || leaf.field);
      } else if (matchingHeaderLevel >= 0) {
        th.title = normalizeText(leaf.sourcePath[matchingHeaderLevel]);
      } else if (!th.title) {
        th.title = headerText;
      }
    },
    afterColumnResize: (newSize, visualCol) => {
      if (visualCol < 0) return;
      const sourceCol = sheetRef?.hot.toPhysicalColumn(visualCol) ?? visualCol;
      const leaf = leafColumns[sourceCol] || leafColumns[visualCol];
      const width = Number(newSize);
      if (!leaf || !Number.isFinite(width) || width < 24) return;
      userWidths.set(leaf.field, Math.round(width));
      writeColumnWidths(columnWidthKey, userWidths);
    },
    afterSelectionEnd: (row, col) => {
      const sourceCol = hot.toPhysicalColumn(col);
      element.dataset.activeField = leafColumns[sourceCol]?.field || leafColumns[col]?.field || '';
      if (!sheetRef || !annotationState) return;
      annotationState.selectedSheet = sheetRef;
      annotationState.selectedCoords = { row, col };
      annotationState.selectedContext = buildScopeContextFromCoords(sheetRef, row, col);
    },
    beforeContextMenuSetItems: (menuItems) => {
      if (!sheetRef) return;
      if (sheetRef.kind === 'teacher-main') {
        const unenrollItem = buildTeacherMainUnenrollContextMenuItem(sheetRef);
        if (unenrollItem) {
          menuItems.push(Handsontable.plugins.ContextMenu.SEPARATOR, unenrollItem);
        }
        return;
      }
      if (sheetRef.kind !== 'admin') return;
      const enrollmentMenuItems = buildAdminEnrollmentContextMenuItems(sheetRef, allRows, meta);
      const mergeMenuItems = buildAdminMergeContextMenuItems(sheetRef, meta);
      if (enrollmentMenuItems && mergeMenuItems) {
        menuItems.splice(0, menuItems.length, ...enrollmentMenuItems, Handsontable.plugins.ContextMenu.SEPARATOR, ...mergeMenuItems);
      } else if (enrollmentMenuItems) {
        menuItems.splice(0, menuItems.length, ...enrollmentMenuItems);
      } else if (mergeMenuItems) {
        menuItems.splice(0, menuItems.length, ...mergeMenuItems);
      }
    },
    beforeOnCellContextMenu: (_event, coords) => {
      if (!sheetRef) return;
      if (coords.row < 0 || coords.col < 0) {
        sheetRef.contextMenuCoords = null;
        return;
      }
      sheetRef.contextMenuCoords = { row: coords.row, col: coords.col };
      if (sheetRef.kind === 'admin' && !isVisualCellInSelection(sheetRef, coords.row, coords.col)) {
        sheetRef.hot.selectCell(coords.row, coords.col, coords.row, coords.col, false, false);
      }
    },
    afterOnCellContextMenu: (_event, coords) => {
      if (!sheetRef || !annotationState || coords.row < 0 || coords.col < 0) return;
      annotationState.selectedSheet = sheetRef;
      annotationState.selectedCoords = { row: coords.row, col: coords.col };
      annotationState.selectedContext = buildScopeContextFromCoords(sheetRef, coords.row, coords.col);
    },
  });

  const sheet = { hot, kind, element, projectionColumns, allRows, activeRows, leafColumns, hiddenFields, compactWidths, userWidths, annotationState, modalRef, contextMenuCoords: null };
  sheetRef = sheet;
  (hot as any).__musikiSheet = sheet;
  (element as any).__handsontableInstance = hot;
  hot.addHook('modifyColWidth', (width: number | undefined, visualCol: number) => {
    return resolveForcedVisualColumnWidth(leafColumns, visualCol, kind, sheet.compactWidths, sheet.userWidths, hot) || width;
  }, 100);
  hot.addHook('beforeStretchingColumnWidth', (width: number | undefined, visualCol: number) => {
    return resolveForcedVisualColumnWidth(leafColumns, visualCol, kind, sheet.compactWidths, sheet.userWidths, hot) || width;
  }, 100);
  hot.addHook('modifyRowHeaderWidth', () => rowHeaderWidth, 100);
  hot.addHook('modifyRowHeight', () => DASHBOARD_ROW_HEIGHT, 100);
  hot.render();
  return sheet;
};

const setSheetRows = (sheet: DashboardSheet, rows: Record<string, any>[], source = 'filter') => {
  sheet.activeRows.splice(0, sheet.activeRows.length, ...rows);
  sheet.hot.loadData(sheet.activeRows, source);
  sheet.hot.render();
};

const buildPersistKey = (meta: DashboardMeta, key: string) =>
  `musiki-dashboard-sheet:${normalizeText(meta.courseId || 'all')}:${normalizeText(meta.year || 'all')}:${key}`;

const installGlobalSearch = (sheets: DashboardSheet[], input: HTMLInputElement, persistKey: string, options?: { hideAbandonedButton?: HTMLButtonElement | null }) => {
  const getStored = () => {
    try {
      return normalizeText(window.localStorage.getItem(`${persistKey}:search`));
    } catch {
      return '';
    }
  };
  let query = normalizeTextLower(getStored());
  let hideAbandoned = false;
  const apply = () => {
    sheets.forEach((sheet) => {
      const rows = sheet.allRows.filter((row) => {
        if (hideAbandoned && normalizeTextLower(row?.grupo ?? row?.groupValue ?? '') === 'x') return false;
        if (!query) return true;
        return normalizeTextLower(row.__search || Object.values(row).join(' ')).includes(query);
      });
      setSheetRows(sheet, rows);
    });
  };
  input.value = getStored();
  input.addEventListener('input', debounce(() => {
    query = normalizeTextLower(input.value);
    try {
      window.localStorage.setItem(`${persistKey}:search`, input.value);
    } catch {}
    apply();
  }, 220));
  options?.hideAbandonedButton?.addEventListener('click', () => {
    hideAbandoned = !hideAbandoned;
    options.hideAbandonedButton?.classList.toggle('is-active', hideAbandoned);
    options.hideAbandonedButton?.setAttribute('aria-pressed', hideAbandoned ? 'true' : 'false');
    apply();
  });
  apply();
};

const updateTeacherTabQuery = (tabName: string) => {
  const nextTab = VALID_TEACHER_TABS.includes(tabName) ? tabName : 'main';
  const url = new URL(window.location.href);
  url.searchParams.set('tab', nextTab);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
};

const getActiveTeacherTab = (shell: ParentNode) => {
  const activeTab = shell.querySelector<HTMLElement>('[data-dashboard-tab].active');
  const nextTab = normalizeText(activeTab?.dataset.dashboardTab || '');
  return VALID_TEACHER_TABS.includes(nextTab) ? nextTab : 'main';
};

const bindTeacherTabs = (shell: ParentNode, root: HTMLElement, initialTab: string, registry: Map<string, DashboardSheet>) => {
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-dashboard-tab-panel]'));
  const tabs = Array.from(shell.querySelectorAll<HTMLElement>('[data-dashboard-tab]'));
  if (!tabs.length || !panels.length) return;
  const showTab = (tabName: string) => {
    const nextTab = VALID_TEACHER_TABS.includes(tabName) ? tabName : 'main';
    root.dataset.activeTeacherTab = nextTab;
    tabs.forEach((tab) => tab.classList.toggle('active', normalizeText(tab.dataset.dashboardTab) === nextTab));
    shell.querySelectorAll<HTMLElement>('[data-dashboard-topbar-context], [data-dashboard-topbar-contexts]').forEach((node) => {
      const targetTab = normalizeText(node.dataset.dashboardTopbarContext);
      const targetTabs = normalizeText(node.dataset.dashboardTopbarContexts).split(',').map(normalizeText).filter(Boolean);
      node.hidden = targetTab ? targetTab !== nextTab : !targetTabs.includes(nextTab);
    });
    panels.forEach((panel) => {
      panel.hidden = normalizeText(panel.dataset.dashboardTabPanel) !== nextTab;
    });
    updateTeacherTabQuery(nextTab);
    window.requestAnimationFrame(() => registry.forEach((sheet) => sheet.hot.render()));
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => showTab(normalizeText(tab.dataset.dashboardTab))));
  showTab(initialTab);
};

const bindScopeSelectors = (shell: ParentNode) => {
  const courseSelect = shell.querySelector('[data-dashboard-scope="course"]');
  const yearSelect = shell.querySelector('[data-dashboard-scope="year"]');
  if (!(courseSelect instanceof HTMLSelectElement) || !(yearSelect instanceof HTMLSelectElement)) return;
  const updateScopeQuery = async () => {
    try {
      await fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { lastActiveCourseId: courseSelect.value, lastActiveYear: yearSelect.value } }),
      });
    } catch {}
    const url = new URL(window.location.href);
    url.searchParams.set('course', courseSelect.value);
    url.searchParams.set('year', yearSelect.value);
    url.searchParams.set('tab', getActiveTeacherTab(shell));
    window.location.href = `${url.pathname}${url.search}${url.hash}`;
  };
  courseSelect.addEventListener('change', () => void updateScopeQuery());
  yearSelect.addEventListener('change', () => void updateScopeQuery());
};

const bindAttendanceConfig = () => {
  const panel = document.querySelector<HTMLElement>('[data-attendance-config]');
  if (!panel || panel.dataset.bound === 'true') return;
  panel.dataset.bound = 'true';
  const startInput = panel.querySelector<HTMLInputElement>('[data-attendance-config-input="startDate"]');
  const endInput = panel.querySelector<HTMLInputElement>('[data-attendance-config-input="endDate"]');
  if (!startInput || !endInput) return;
  const save = debounce(async () => {
    const courseId = normalizeText(panel.dataset.courseId);
    const year = normalizeText(panel.dataset.year);
    if (!courseId || !year || !startInput.value || !endInput.value) return;
    const response = await fetch('/api/grade/course-attendance-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, year, startDate: startInput.value, endDate: endInput.value }),
    });
    if (!response.ok) {
      showToast('No se pudo guardar el rango', 'error', 4000);
      return;
    }
    showToast('Rango guardado. Recargando...', 'success', 1200);
    window.setTimeout(() => window.location.reload(), 900);
  }, 240);
  startInput.addEventListener('change', save);
  endInput.addEventListener('change', save);
};

const csvEscape = (value: unknown) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const downloadCsv = (sheet: DashboardSheet, filename: string) => {
  const columns = sheet.leafColumns.filter((column) => !sheet.hiddenFields.has(column.field));
  const lines = [
    columns.map((column) => csvEscape(column.title)).join(','),
    ...sheet.activeRows.map((row) => columns.map((column) => csvEscape(row[column.field])).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const compactTeacherMainWidths = (field: string) => {
  if (field === 'lastName') return 132;
  if (field === 'turno') return TINY_COLUMN_WIDTH;
  if (field === 'grupo') return TINY_COLUMN_WIDTH;
  if (field === 'attendanceRate') return TINY_COLUMN_WIDTH;
  if (field === 'deliveriesDone') return TINY_COLUMN_WIDTH;
  if (field === 'deliveriesPending') return TINY_COLUMN_WIDTH;
  if (field === 'absenceUnits') return TINY_COLUMN_WIDTH;
  if (field === 'average') return 42;
  if (field === 'conceptValue') return 48;
  if (field === 'finalGrade') return 48;
  if (field === 'notesValue') return 150;
  if (field.startsWith('teacherMainGradebookSummary_')) return 36;
  return 0;
};

const applyHiddenFields = (
  sheet: DashboardSheet,
  hiddenFields: Set<string>,
  compactWidths = new Map<string, number>(),
  foldPreset = '',
) => {
  sheet.hiddenFields = hiddenFields;
  sheet.compactWidths = compactWidths;
  sheet.element.dataset.foldPreset = foldPreset;
  const hiddenColumns = sheet.leafColumns
    .map((column, index) => sheet.hiddenFields.has(column.field) ? index : -1)
    .filter((index) => index >= 0);
  sheet.hot.updateSettings({
    columns: buildHotColumns(sheet.leafColumns, sheet.compactWidths, sheet.userWidths),
    colWidths: (visualCol) => {
      return resolveVisualColumnWidth(sheet.leafColumns, visualCol, sheet.compactWidths, sheet.userWidths, sheet.hot);
    },
    hiddenColumns: { columns: hiddenColumns, indicators: true },
  });
  sheet.hot.render();
};

const foldTeacherMainSheet = (sheet: DashboardSheet) => {
  const visibleFields = collectTeacherMainFoldVisibleFields(sheet.projectionColumns);
  if (visibleFields.size === 0) {
    visibleFields.add('lastName');
    visibleFields.add('turno');
    visibleFields.add('grupo');
    visibleFields.add('absenceUnits');
    visibleFields.add('average');
    visibleFields.add('conceptValue');
    visibleFields.add('finalGrade');
    visibleFields.add('notesValue');
  }
  const allFields = collectLeafFields(sheet.projectionColumns);
  const hiddenFields = new Set(Array.from(allFields).filter((field) => !visibleFields.has(field)));
  const compactWidths = new Map<string, number>();
  visibleFields.forEach((field) => {
    const column = sheet.leafColumns.find((leaf) => leaf.field === field);
    const width = column && isTinyDashboardColumn(column) ? TINY_COLUMN_WIDTH : compactTeacherMainWidths(field);
    if (width > 0) compactWidths.set(field, width);
  });
  applyHiddenFields(sheet, hiddenFields, compactWidths, 'teacher-main');
  setDashboardSaveStatus('saved', 'Vista compacta: PROFILE, ASISTENCIA y GRADEBOOK plegados.');
};

const foldGenericSheet = (sheet: DashboardSheet) => {
  const hiddenFields = new Set(sheet.leafColumns
    .map((column) => column.field)
    .filter((field) => field.startsWith('eval__') || field.startsWith('day_')));
  applyHiddenFields(sheet, hiddenFields, new Map(), 'generic');
  setDashboardSaveStatus('saved', 'Vista compacta guardada.');
};

const unfoldSheet = (sheet: DashboardSheet) => {
  applyHiddenFields(sheet, new Set(), new Map(), '');
  setDashboardSaveStatus('saved', 'Vista desplegada.');
};

const isTeacherMainSheetFolded = (sheet: DashboardSheet | null | undefined) =>
  Boolean(sheet && sheet.kind === 'teacher-main' && sheet.element.dataset.foldPreset === 'teacher-main');

const bindToolbarButtons = (root: HTMLElement, registry: Map<string, DashboardSheet>, meta: DashboardMeta) => {
  root.querySelectorAll<HTMLButtonElement>('[data-dashboard-download]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = normalizeText(button.dataset.dashboardDownload);
      const sheet = registry.get(key);
      if (sheet) downloadCsv(sheet, `musiki-${key}-${normalizeText(meta.courseId || 'curso')}-${normalizeText(meta.year || 'year')}.csv`);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-dashboard-fold-all]').forEach((button) => {
    button.addEventListener('click', () => {
      const sheet = registry.get(normalizeText(button.dataset.dashboardFoldAll));
      if (!sheet) return;
      if (sheet.kind === 'teacher-main') foldTeacherMainSheet(sheet);
      else foldGenericSheet(sheet);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-dashboard-unfold-all]').forEach((button) => {
    button.addEventListener('click', () => {
      const sheet = registry.get(normalizeText(button.dataset.dashboardUnfoldAll));
      if (!sheet) return;
      unfoldSheet(sheet);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-dashboard-fill-empty-present]').forEach((button) => {
    button.addEventListener('click', async () => {
      const sheet = registry.get('teacher-main');
      const field = normalizeText(sheet?.element.dataset.activeField);
      if (!sheet || !field.startsWith('day_')) {
        showToast('Seleccioná una columna de asistencia.', 'error', 2500);
        return;
      }
      for (let visualRow = 0; visualRow < sheet.hot.countRows(); visualRow += 1) {
        const rowData = sheet.activeRows[sheet.hot.toPhysicalRow(visualRow)];
        const cellMeta = resolveAttendanceMeta(rowData, field);
        if (!cellMeta || cellMeta.hasManualOverride || Number(cellMeta.liveValue || 0) > 0) continue;
        await persistCellChange(sheet, meta, visualRow, field, rowData[field], '1');
      }
    });
  });
};

const bindAdminActions = (root: HTMLElement, registry: Map<string, DashboardSheet>, meta: DashboardMeta) => {
  root.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const editButton = target?.closest<HTMLButtonElement>('[data-dashboard-user-edit]');
    if (editButton) {
      const userId = normalizeText(editButton.dataset.userId);
      if (userId) window.location.href = `/admin/user/${encodeURIComponent(userId)}`;
      return;
    }
    const deleteButton = target?.closest<HTMLButtonElement>('[data-dashboard-user-delete]');
    if (!deleteButton) return;
    const userId = normalizeText(deleteButton.dataset.userId);
    const userName = normalizeText(deleteButton.dataset.userName || 'este usuario');
    if (!userId || !window.confirm(`¿Borrar a ${userName}?`)) return;
    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}?courseId=${encodeURIComponent(meta.courseId || '')}`, { method: 'DELETE' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(payload?.error || 'No se pudo borrar el usuario', 'error', 4000);
      return;
    }
    const sheet = registry.get('admin');
    if (sheet) {
      const rows = sheet.allRows.filter((row) => normalizeText(row.userId || row.id) !== userId);
      sheet.allRows.splice(0, sheet.allRows.length, ...rows);
      setSheetRows(sheet, rows);
    }
  });
};

const bindImportAndAddStudent = (root: HTMLElement, meta: DashboardMeta) => {
  const parseStudents = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const parts = line.split(/\t| {2,}/).map(normalizeText).filter(Boolean);
    const email = parts.find((part) => part.includes('@'))?.toLowerCase() || '';
    const name = parts.find((part) => !part.includes('@') && normalizeTextLower(part) !== 'aceptada') || '';
    return email ? [{ name, email }] : [];
  });
  const importStudents = async (students: Array<{ name: string; email: string }>, button: HTMLButtonElement) => {
    if (!students.length) {
      showToast('No se encontraron estudiantes válidos.', 'error', 3500);
      return;
    }
    button.disabled = true;
    const response = await fetch('/api/admin/import-students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: meta.courseId, students }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(payload?.error || 'No se pudo importar', 'error', 4500);
      button.disabled = false;
      return;
    }
    showToast('Importación lista. Recargando...', 'success', 1500);
    window.setTimeout(() => window.location.reload(), 900);
  };
  root.querySelectorAll<HTMLButtonElement>('[data-dashboard-import-clipboard]').forEach((button) => {
    button.addEventListener('click', async () => importStudents(parseStudents(await navigator.clipboard.readText().catch(() => '')), button));
  });
  const fileInput = root.querySelector<HTMLInputElement>('[data-dashboard-import-csv-input]');
  root.querySelectorAll<HTMLButtonElement>('[data-dashboard-import-csv]').forEach((button) => {
    button.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      fileInput.value = '';
      await importStudents(parseStudents(await file.text()), button);
    });
  });

  const trigger = root.querySelector<HTMLButtonElement>('[data-dashboard-add-student]');
  const dialog = document.querySelector<HTMLDialogElement>('[data-add-student-dialog]');
  const form = document.querySelector<HTMLFormElement>('[data-add-student-form]');
  if (!trigger || !dialog || !form) return;
  trigger.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('[data-add-student-close]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-add-student-cancel]')?.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const response = await fetch('/api/admin/add-student-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId: meta.courseId,
        year: meta.year,
        firstName: normalizeText(data.get('firstName')),
        lastName: normalizeText(data.get('lastName')),
        email: normalizeText(data.get('email')).toLowerCase(),
        turno: normalizeText(data.get('turno')),
        grupo: normalizeText(data.get('grupo')),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(payload?.error || 'No se pudo agregar estudiante', 'error', 4000);
      return;
    }
    dialog.close();
    showToast('Estudiante agregado. Recargando...', 'success', 1500);
    window.setTimeout(() => window.location.reload(), 900);
  });
};

export const mountDashboardSheets = (root: HTMLElement) => {
  if (!(root instanceof HTMLElement)) return () => {};
  if (root.dataset.dashboardSheetsMounted === 'true') return () => {};
  const shell = root.closest<HTMLElement>('.dashboard-shell') || document.body;
  if (!shell.querySelector('[data-dashboard-tab]') && !root.querySelector('[data-dashboard-grid]')) return () => {};

  bindScopeSelectors(shell);
  const meta = parseJsonScript<DashboardMeta>('dashboard-teacher-sheets-meta', {});
  const initialAnnotations = parseJsonScript<DashboardAnnotationRecord[]>('dashboard-teacher-annotations', []);
  const annotationState: AnnotationState = {
    annotations: [],
    annotationsByScope: new Map(),
    selectedContext: null,
    selectedSheet: null,
    selectedCoords: null,
    currentUserId: normalizeText(meta.userId),
    meta,
  };
  setAnnotations(annotationState, initialAnnotations);
  const modalRef: { current: AnnotationModalApi | null } = {
    current: createAnnotationModal(root, annotationState),
  };
  const unbindAnnotationShortcut = bindAnnotationShortcut(annotationState, modalRef);
  const attendance = parseJsonScript<AttendanceProjection>('dashboard-teacher-attendance', { summary: { columns: [], rows: [] }, log: { columns: [], rows: [] } });
  const projections: Record<string, GridProjection> = {
    'teacher-main': parseJsonScript<GridProjection>('dashboard-teacher-main', { columns: [], rows: [] }),
    overview: parseJsonScript<GridProjection>('dashboard-teacher-overview', { columns: [], rows: [] }),
    gradebook: parseJsonScript<GridProjection>('dashboard-teacher-gradebook', { columns: [], rows: [] }),
    comments: parseJsonScript<GridProjection>('dashboard-teacher-comments', { columns: [], rows: [] }),
    admin: parseJsonScript<GridProjection>('dashboard-teacher-admin', { columns: [], rows: [] }),
    'teacher-eval': parseJsonScript<GridProjection>('dashboard-teacher-eval', { columns: [], rows: [] }),
    'login-log': parseJsonScript<GridProjection>('dashboard-login-log', { columns: [], rows: [] }),
    'attendance-summary': attendance.summary,
    'attendance-log': attendance.log,
  };

  const registry = new Map<string, DashboardSheet>();
  const sheets: DashboardSheet[] = [];
  root.querySelectorAll<HTMLElement>('[data-dashboard-grid]').forEach((node) => {
    const kind = normalizeText(node.dataset.dashboardGrid) as GridKind;
    const projection = projections[kind];
    if (!projection) return;
    const sheet = createSheet(node, projection, kind, meta, annotationState, modalRef);
    registry.set(kind, sheet);
    if (kind === 'teacher-main') registry.set('main', sheet);
    sheets.push(sheet);
  });

  const mainSearch = root.querySelector<HTMLInputElement>('[data-dashboard-search="teacher-main"]');
  if (mainSearch) {
    installGlobalSearch([registry.get('teacher-main')].filter(Boolean) as DashboardSheet[], mainSearch, buildPersistKey(meta, 'teacher-main'), {
      hideAbandonedButton: root.querySelector<HTMLButtonElement>('[data-dashboard-hide-abandoned]'),
    });
  }
  ['admin', 'attendance-log', 'comments', 'login-log', 'teacher-eval'].forEach((key) => {
    const input = root.querySelector<HTMLInputElement>(`[data-dashboard-search="${key}"]`);
    const sheet = registry.get(key);
    if (input && sheet) installGlobalSearch([sheet], input, buildPersistKey(meta, key));
  });

  bindTeacherTabs(shell, root, normalizeText(meta.initialTeacherTab || 'main') || 'main', registry);
  bindAttendanceConfig();
  bindToolbarButtons(root, registry, meta);
  bindAdminActions(root, registry, meta);
  bindImportAndAddStudent(root, meta);
  root.dataset.dashboardSheetsMounted = 'true';

  return () => {
    sheets.forEach((sheet) => sheet.hot.destroy());
    unbindAnnotationShortcut();
    modalRef.current?.destroy();
    modalRef.current = null;
    root.dataset.dashboardSheetsMounted = 'false';
  };
};
