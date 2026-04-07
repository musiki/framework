import { createClient } from '@supabase/supabase-js';
// @ts-expect-error tabulator-tables does not expose usable declarations in this build.
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
  | 'teacher-main'
  | 'overview'
  | 'gradebook'
  | 'attendance-summary'
  | 'attendance-log'
  | 'comments'
  | 'admin';

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
  registry: Map<string, Tabulator>;
  selectedContext: CellScopeContext | null;
  selectedCell: any | null;
  selectedCellEl: HTMLElement | null;
  currentUserId: string;
  meta: DashboardMeta;
};

type AnnotationModalApi = {
  open: (context: CellScopeContext) => void;
  destroy: () => void;
};

type RangeSelectionState = {
  selectedCells: Set<any>;
};

type RealtimeProjectionSyncController = {
  isEnabled: () => boolean;
  setEnabled: (next: boolean) => void;
  destroy: () => void;
};

type DashboardTabulatorInstance = Tabulator & {
  __musikiTableBuilt?: boolean;
  __musikiFoldStorageKey?: string;
};

const VALID_TEACHER_TABS = ['main', 'log', 'admin'];
const SEARCH_DEBOUNCE_MS = 300;
const DASHBOARD_LIVE_MODE_STORAGE_KEY = 'musiki:dashboard:live-mode';
const DASHBOARD_PROJECTION_SCRIPT_IDS = [
  'dashboard-teacher-tabulator-meta',
  'dashboard-teacher-main',
  'dashboard-teacher-overview',
  'dashboard-teacher-gradebook',
  'dashboard-teacher-attendance',
  'dashboard-teacher-comments',
  'dashboard-teacher-admin',
  'dashboard-teacher-annotations',
];

const normalizeText = (value: any) => String(value || '').trim();
const normalizeTextLower = (value: any) => normalizeText(value).toLowerCase();

let _toastTimer: ReturnType<typeof setTimeout> | null = null;
const showToast = (msg: string, type: 'loading' | 'success' | 'error' = 'loading', duration = 0) => {
  const el = document.querySelector<HTMLElement>('[data-dashboard-toast]');
  if (!el) return;
  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
  el.textContent = msg;
  el.dataset.toastType = type;
  el.hidden = false;
  if (duration > 0) {
    _toastTimer = setTimeout(() => { el.hidden = true; }, duration);
  }
};
const hideToast = () => {
  const el = document.querySelector<HTMLElement>('[data-dashboard-toast]');
  if (!el) return;
  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
  el.hidden = true;
};

const pickTurno = (): Promise<'M' | 'T' | 'N' | null> =>
  new Promise((resolve) => {
    const dialog = document.querySelector<HTMLDialogElement>('[data-turno-dialog]');
    if (!dialog) { resolve(null); return; }

    const close = (value: 'M' | 'T' | 'N' | null) => {
      dialog.close();
      dialog.removeEventListener('cancel', onCancel);
      resolve(value);
    };

    const onCancel = () => close(null);
    dialog.addEventListener('cancel', onCancel, { once: true });

    dialog.querySelectorAll<HTMLButtonElement>('[data-turno-pick]').forEach((btn) => {
      btn.onclick = () => close(btn.dataset.turnoPick as 'M' | 'T' | 'N');
    });

    const cancelBtn = dialog.querySelector<HTMLButtonElement>('[data-turno-cancel]');
    if (cancelBtn) cancelBtn.onclick = () => close(null);

    dialog.showModal();
  });

// Abbreviated label for narrow gradebook eval column headers.
// "demo-ollama-patch-01" → "DOP1"
// "c1grupo1" → "CG1"
const formatAbletonLabel = (label: string) => {
  const raw = String(label || '').trim();
  if (!raw) return '';
  const alphaChunks = raw.match(/[A-Za-zÀ-ÿ]+/g) || [];
  const lastNumberMatch = raw.match(/(\d+)(?!.*\d)/);
  const initials = alphaChunks.map((chunk) => chunk[0]?.toUpperCase() || '').join('');
  const suffix = lastNumberMatch ? String(parseInt(lastNumberMatch[1] || '0', 10)) : '';
  return `${initials}${suffix}`;
};

const getFoldMeta = (subject: any) => {
  const definition = typeof subject?.getDefinition === 'function'
    ? subject.getDefinition()
    : subject || {};

  return definition?.titleFormatterParams?.foldMeta || {};
};

const getColumnDashboardMeta = (subject: any) => {
  const definition = typeof subject?.getDefinition === 'function'
    ? subject.getDefinition()
    : subject || {};
  const formatterParams = definition?.formatterParams;
  if (!formatterParams || typeof formatterParams !== 'object') return {};
  return formatterParams.__dashboardMeta || {};
};

const debounce = <T extends (...args: any[]) => any>(fn: T, ms: number) => {
  let timeoutId: number | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), ms);
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

const canRedrawTable = (table: Tabulator | null | undefined) =>
  Boolean((table as DashboardTabulatorInstance | null | undefined)?.__musikiTableBuilt);

const getTableHolderElement = (table: Tabulator | null | undefined): HTMLElement | null => {
  if (!table) return null;
  const tableElement =
    (table as any)?.element
    || (typeof (table as any)?.getElement === 'function' ? (table as any).getElement() : null);
  if (!(tableElement instanceof HTMLElement)) return null;
  return tableElement.querySelector('.tabulator-tableholder');
};

const redrawTablePreservingScroll = (table: Tabulator | null | undefined) => {
  if (!table || !canRedrawTable(table)) return;

  // Use per-row reformat() instead of table.redraw(true).
  // redraw(true) is a full force-redraw that resets Tabulator's SelectRange module,
  // causing the active cell to jump to the first row and breaking double-click editing.
  // reformat() re-runs formatters on each row without touching the range selection state.
  try {
    const rows = table.getRows();
    for (const row of rows) {
      try { row.reformat(); } catch { /* ignore individual row races */ }
    }
  } catch {
    // fallback: redraw without force to at least update layout without resetting range
    try { table.redraw(false); } catch { /* ignore */ }
  }
};

const buildPersistKey = (meta: DashboardMeta, grid: string) =>
  `musiki:dashboard:${normalizeText(meta?.courseId)}:${normalizeText(meta?.year)}:${grid}`;

const buildFoldStorageKey = (persistKey: string) => `${persistKey}:folds`;
const TEACHER_MAIN_TOP_LEVEL_FOLD_KEYS = [
  'teacher_main_profile',
  'teacher_main_attendance',
  'teacher_main_gradebook',
];

const getTableFoldStorageKey = (table: Tabulator | null | undefined) =>
  normalizeText((table as DashboardTabulatorInstance | null | undefined)?.__musikiFoldStorageKey || '');

const readStoredFoldState = (table: Tabulator | null | undefined): Record<string, boolean> => {
  const storageKey = getTableFoldStorageKey(table);
  if (!storageKey) return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [String(key), Boolean(value)]),
    );
  } catch {
    return {};
  }
};

const writeStoredFoldState = (table: Tabulator | null | undefined, nextState: Record<string, boolean>) => {
  const storageKey = getTableFoldStorageKey(table);
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(nextState));
  } catch {
    // ignore storage errors
  }
};

const setStoredFoldState = (table: Tabulator | null | undefined, foldKey: string, folded: boolean) => {
  const nextKey = normalizeText(foldKey);
  if (!table || !nextKey) return;
  const state = readStoredFoldState(table);
  state[nextKey] = Boolean(folded);
  writeStoredFoldState(table, state);
};

const snapshotCurrentFoldState = (table: Tabulator | null | undefined): Record<string, boolean> => {
  const state: Record<string, boolean> = {};
  if (!table) return state;

  const visit = (columns: any[]) => {
    (columns || []).forEach((column) => {
      const foldMeta = getFoldMeta(column);
      if (foldMeta?.key) {
        const headerElement = column.getElement?.();
        state[String(foldMeta.key)] = Boolean(headerElement?.classList?.contains('group-folded'));
      }
      const children = getGroupSubColumns(column);
      if (children.length > 0) {
        visit(children);
      }
    });
  };

  try {
    visit(table.getColumns?.() || []);
  } catch {
    return state;
  }

  return state;
};

const flushCurrentFoldState = (table: Tabulator | null | undefined, message = 'Vista de columnas guardada localmente.') => {
  if (!table) return;
  writeStoredFoldState(table, snapshotCurrentFoldState(table));
  setDashboardSaveStatus('saved', message);
};

const storeCurrentFoldState = (table: Tabulator | null | undefined, message = 'Vista de columnas guardada localmente.') => {
  if (!table) return;
  window.requestAnimationFrame(() => {
    flushCurrentFoldState(table, message);
  });
};

const getStoredFoldState = (table: Tabulator | null | undefined, foldKey: string) => {
  const nextKey = normalizeText(foldKey);
  if (!table || !nextKey) return undefined;
  const state = readStoredFoldState(table);
  if (!Object.prototype.hasOwnProperty.call(state, nextKey)) return undefined;
  return Boolean(state[nextKey]);
};

const getStoredLiveModePreference = () => {
  try {
    return window.localStorage.getItem(DASHBOARD_LIVE_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

const setStoredLiveModePreference = (enabled: boolean) => {
  try {
    window.localStorage.setItem(DASHBOARD_LIVE_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
};

let dashboardSaveStatusTimeout: number | null = null;
let dashboardSaveStatusLockDepth = 0;

const setDashboardSaveStatus = (
  state: 'idle' | 'saving' | 'saved' | 'error',
  message: string,
) => {
  if (dashboardSaveStatusLockDepth > 0 && state !== 'idle') {
    return;
  }
  if (dashboardSaveStatusTimeout !== null) {
    window.clearTimeout(dashboardSaveStatusTimeout);
    dashboardSaveStatusTimeout = null;
  }

  document.querySelectorAll<HTMLElement>('[data-dashboard-save-indicator]').forEach((node) => {
    node.dataset.state = state;
    node.title = message;
    node.setAttribute('aria-label', message);
  });

  if (state === 'saved' || state === 'error') {
    dashboardSaveStatusTimeout = window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>('[data-dashboard-save-indicator]').forEach((node) => {
        node.dataset.state = 'idle';
        node.title = message;
        node.setAttribute('aria-label', message);
      });
      dashboardSaveStatusTimeout = null;
    }, 2400);
  }
};

const lockDashboardSaveStatus = () => {
  dashboardSaveStatusLockDepth += 1;
};

const unlockDashboardSaveStatus = () => {
  dashboardSaveStatusLockDepth = Math.max(0, dashboardSaveStatusLockDepth - 1);
};

const toTitleCase = (text: string): string =>
  String(text || '').replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

const EDITABLE_USER_FIELDS = ['firstName', 'lastName', 'email', 'name'];

const saveUserFieldFromCell = async (cell: any, overrideValue?: string, meta?: DashboardMeta): Promise<void> => {
  const field = normalizeText(cell.getField?.() || '');
  if (!EDITABLE_USER_FIELDS.includes(field)) return;
  const value = overrideValue !== undefined ? overrideValue : String(cell.getValue() ?? '');
  const rowData = (cell.getRow?.()?.getData?.() || cell.getData?.() || {}) as Record<string, any>;
  const studentId = normalizeText(rowData.studentId || rowData.id || '');
  if (!studentId) return;

  const clean = (v: string) => v.replace(/^—$/, '').trim();
  let body: Record<string, string> = {};

  if (field === 'firstName') {
    const lastName = clean(String(rowData.lastName || ''));
    body.name = [value, lastName].filter(Boolean).join(' ');
  } else if (field === 'lastName') {
    const firstName = clean(String(rowData.firstName || ''));
    body.name = [firstName, value].filter(Boolean).join(' ');
  } else if (field === 'name') {
    body.name = clean(value);
  } else if (field === 'email') {
    body.email = clean(value).toLowerCase();
  }

  if (!Object.keys(body).length) return;
  if (meta?.courseId) body.courseId = meta.courseId;
  setDashboardSaveStatus('saving', `Guardando ${field}...`);
  try {
    const response = await fetch(`/api/admin/users/${studentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error((payload as any)?.error || `No se pudo guardar ${field}.`);
    }
    setDashboardSaveStatus('saved', `${field} guardado.`);
  } catch (error: any) {
    setDashboardSaveStatus('error', error?.message || `No se pudo guardar ${field}.`);
    throw error;
  }
};

const saveSelectedUserFieldFromCell = async (cell: any, overrideValue?: any, meta?: DashboardMeta) => {
  const field = getCellField(cell);
  if (!EDITABLE_USER_FIELDS.includes(field)) return;

  const value = String(overrideValue ?? cell.getValue() ?? '');
  const targetCells = resolveSelectedTargetCells(cell, {
    sameField: true,
    filter: (candidate) => EDITABLE_USER_FIELDS.includes(getCellField(candidate)),
  });

  for (const targetCell of targetCells) {
    const rowData = (targetCell.getData?.() || {}) as Record<string, any>;
    const rowId = normalizeText(rowData.id || rowData.studentId || targetCell.getRow?.()?.getIndex?.() || '');
    const row = rowId ? cell.getTable?.()?.getRow?.(rowId) || targetCell.getRow?.() : targetCell.getRow?.();
    if (row) {
      await row.update({
        [field]: value,
      });
    }
    await saveUserFieldFromCell(targetCell, value, meta);
  }
};

const saveSingleUserFieldCellValue = async (cell: any, overrideValue?: any, meta?: DashboardMeta) => {
  const field = getCellField(cell);
  if (!EDITABLE_USER_FIELDS.includes(field)) return;

  const value = String(overrideValue ?? cell.getValue() ?? '');
  const row = cell?.getRow?.();
  if (row) {
    await row.update({
      [field]: value,
    });
  }
  await saveUserFieldFromCell(cell, value, meta);
};

const getCellPreviousValue = (cell: any, overridePreviousValue?: any) =>
  overridePreviousValue
  ?? (cell as any)?.__musikiPreviousValue
  ?? cell?.getOldValue?.()
  ?? cell?.getValue?.();

const saveSingleCourseRoleCellValue = async (
  cell: any,
  overrideNextValue?: any,
  overridePreviousValue?: any,
) => {
  if (getCellKind(cell) !== 'course-role') return;

  const field = getCellField(cell);
  const previousValue = normalizeCourseRoleValue(
    getCellPreviousValue(cell, overridePreviousValue),
  );
  const nextValue = normalizeCourseRoleValue(overrideNextValue ?? cell.getValue?.());
  const row = cell?.getRow?.();

  if (nextValue === previousValue) {
    await row?.update?.({
      [field]: nextValue,
      courseRoleLabel: getCourseRoleLabel(nextValue),
    });
    return;
  }

  const rowData = cell?.getData?.() || {};
  const enrollmentId = normalizeText(rowData.enrollmentId || '');
  if (!enrollmentId) return;

  const payload = await postCourseRoleUpdate(enrollmentId, nextValue);
  const resolvedRole = normalizeCourseRoleValue(payload?.enrollment?.roleInCourse || nextValue);
  await row?.update?.({
    [field]: resolvedRole,
    courseRoleLabel: getCourseRoleLabel(resolvedRole),
  });
};

const saveSingleCourseStudentMetaCellValue = async (
  cell: any,
  meta: DashboardMeta,
  overrideNextValue?: any,
  overridePreviousValue?: any,
) => {
  const kind = getCellKind(cell);
  if (!isCourseStudentMetaCellKind(kind)) return;
  const normalizedKind = normalizeText(kind);

  const field = getCellField(cell);
  const previousValue = normalizeCourseStudentMetaValue(
    kind,
    getCellPreviousValue(cell, overridePreviousValue),
  );
  const validation = validateCourseStudentMetaValue(kind, overrideNextValue ?? cell.getValue?.());
  const nextValue = validation.normalized;
  const row = cell?.getRow?.();

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  if (!meta?.courseId || !meta?.year) {
    if (row) {
      await row.update({
        [field]: previousValue || '',
      });
      if (normalizedKind === 'grupo') {
        row.getTable?.()?.refreshFilter?.();
      }
    }
    return;
  }

  if (nextValue === previousValue) {
    await row?.update?.({
      [field]: nextValue || '',
    });
    if (normalizedKind === 'grupo') {
      row?.getTable?.()?.refreshFilter?.();
    }
    return;
  }

  const patchKey = getCourseStudentMetaPatchKey(kind);
  const rowData = cell?.getData?.() || {};
  const studentId = normalizeText(rowData.studentId || '');
  if (!patchKey || !studentId) return;

  const payload = await postCourseStudentMetaUpdate(
    meta,
    studentId,
    { [patchKey]: nextValue },
    getCourseStudentMetaFallbackError(kind),
  );

  const resolvedValue = getCourseStudentMetaResponseValue(kind, payload, nextValue);
  await row?.update?.({
    [field]: resolvedValue || '',
  });
  if (normalizedKind === 'grupo') {
    row?.reformat?.();
    row?.getTable?.()?.refreshFilter?.();
  }
};

const persistClipboardCellValue = async (
  cell: any,
  nextValue: any,
  previousValue: any,
  meta: DashboardMeta,
) => {
  const kind = getCellKind(cell);
  if (kind === 'attendance-day') {
    const normalized = normalizeAttendanceInput(nextValue);
    if (!normalized.valid) {
      throw new Error('Usa solo / o 1, -, ~ o 0.5, x o 0, o deja vacío.');
    }
    await persistSingleAttendanceCellValue(cell, normalized, meta);
    return;
  }

  if (kind === 'course-role') {
    await saveSingleCourseRoleCellValue(cell, nextValue, previousValue);
    return;
  }

  if (isCourseStudentMetaCellKind(kind)) {
    await saveSingleCourseStudentMetaCellValue(cell, meta, nextValue, previousValue);
    return;
  }

  if (kind === 'editable-text') {
    await saveSingleUserFieldCellValue(cell, nextValue, meta);
  }
};

const isClipboardEditableCell = (cell: any) => {
  const resolvedCell = cell?.getComponent?.() || cell;
  const field = getCellField(resolvedCell);
  const kind = getCellKind(resolvedCell);
  const rowData = resolvedCell?.getData?.() || resolvedCell?.getRow?.()?.getData?.() || {};

  if (kind === 'attendance-day') {
    return Boolean(rowData?.__attendanceCellMeta?.[field]);
  }

  if (kind === 'course-role') {
    return Boolean(normalizeText(rowData?.enrollmentId || ''));
  }

  if (isCourseStudentMetaCellKind(kind)) {
    return Boolean(normalizeText(rowData?.studentId || ''));
  }

  if (kind === 'editable-text') {
    return EDITABLE_USER_FIELDS.includes(field)
      && Boolean(normalizeText(rowData?.studentId || rowData?.id || rowData?.userId || ''));
  }

  return false;
};

const applyRangeClipboardPaste = (
  table: Tabulator,
  parsedRows: Record<string, any>[],
  meta: DashboardMeta,
) => {
  const range = (table as any)?.modules?.selectRange?.activeRange;
  if (!range || !Array.isArray(parsedRows) || parsedRows.length === 0) return [];

  const bounds = range.getBounds?.();
  const startCell = bounds?.start;
  if (!startCell) return [];

  const visibleColumns = table.columnManager?.getVisibleColumnsByIndex?.() || [];
  const activeRows = table.rowManager?.activeRows?.slice?.() || [];
  const startColIndex = visibleColumns.indexOf(startCell.column);
  const startRowIndex = activeRows.indexOf(startCell.row);

  if (startColIndex < 0 || startRowIndex < 0) return [];

  const selectedRowCount = bounds?.start === bounds?.end
    ? parsedRows.length
    : (activeRows.indexOf(bounds.end.row) - startRowIndex) + 1;
  const selectedColumns = bounds?.start === bounds?.end
    ? Object.keys(parsedRows[0] || {}).length
    : (visibleColumns.indexOf(bounds.end.column) - startColIndex) + 1;

  const targetRows = activeRows.slice(startRowIndex, startRowIndex + Math.max(0, selectedRowCount));
  const targetColumns = visibleColumns.slice(startColIndex, startColIndex + Math.max(0, selectedColumns));

  if (!targetRows.length || !targetColumns.length) return [];

  const operations: Array<{
    row: any;
    rowId: string;
    field: string;
    nextValue: any;
    previousValue: any;
  }> = [];

  table.blockRedraw?.();

  try {
    targetRows.forEach((row: any, rowIndex: number) => {
      const sourceRow = parsedRows[rowIndex % parsedRows.length] || {};
      const patch: Record<string, any> = {};

      targetColumns.forEach((column: any) => {
        const field = normalizeText(column?.field || column?.definition?.field || '');
        if (!field || !(field in sourceRow)) return;

        const cell = row?.getCell?.(field);
        if (!cell || !isClipboardEditableCell(cell)) return;

        patch[field] = sourceRow[field];
        operations.push({
          row,
          rowId: normalizeText(row?.getData?.()?.id || row?.getIndex?.() || ''),
          field,
          nextValue: sourceRow[field],
          previousValue: cell.getValue?.(),
        });
      });

      if (Object.keys(patch).length > 0) {
        row.updateData?.(patch);
      }
    });
  } finally {
    table.restoreRedraw?.();
  }

  if (operations.length > 0) {
    setDashboardSaveStatus('saving', `Guardando pegado en ${operations.length} celdas...`);
    void (async () => {
      lockDashboardSaveStatus();
      let successCount = 0;
      const failureMessages: string[] = [];

      try {
        for (const operation of operations) {
          const liveRow =
            (operation.rowId ? table.getRow?.(operation.rowId) : null)
            || operation.row;
          const targetCell = liveRow?.getCell?.(operation.field);
          if (!targetCell) {
            failureMessages.push(`No se encontró la celda ${operation.field} para guardar.`);
            continue;
          }
          try {
            await persistClipboardCellValue(
              targetCell,
              operation.nextValue,
              operation.previousValue,
              meta,
            );
            successCount += 1;
          } catch (error: any) {
            failureMessages.push(error?.message || 'No se pudo guardar una celda pegada');
            await liveRow?.update?.({
              [operation.field]: operation.previousValue,
            });
          }
        }
      } finally {
        unlockDashboardSaveStatus();
      }

      if (failureMessages.length > 0) {
        if (successCount === 0) {
          setDashboardSaveStatus('error', failureMessages[0]);
          alert(failureMessages[0]);
        } else {
          setDashboardSaveStatus('error', `Pegado parcial: ${successCount} guardadas, ${failureMessages.length} fallaron.`);
          alert(`Se pegaron ${successCount} celdas, pero ${failureMessages.length} no se pudieron guardar.`);
        }
      } else {
        setDashboardSaveStatus('saved', `Pegado guardado en ${successCount} celdas.`);
      }
    })();
  }

  return targetRows;
};

const setStoredSearchQuery = (persistKey: string, query: string) => {
  try {
    window.localStorage.setItem(`${persistKey}:search`, query);
  } catch {
    // ignore storage errors
  }
};

const getStoredSearchQuery = (persistKey: string) => {
  try {
    return normalizeText(window.localStorage.getItem(`${persistKey}:search`));
  } catch {
    return '';
  }
};

const isAbandonedDashboardRow = (data: any) =>
  normalizeTextLower(data?.grupo ?? data?.groupValue ?? '') === 'x';

const applyTeacherMainRowState = (row: any) => {
  const rowElement = row?.getElement?.();
  if (!(rowElement instanceof HTMLElement)) return;
  rowElement.classList.toggle('dashboard-row-abandoned', isAbandonedDashboardRow(row?.getData?.() || {}));
};

const escapeHtml = (value: string | null | undefined) => {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(value ?? '').replace(/[&<>"']/g, (m) => map[m]);
};

const formatSubmissionDate = (dateValue: string | Date | null | undefined) => {
  if (!dateValue) return '—';
  const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatAbsence = (units: number) => {
  if (units <= 0) return '0';
  return String(Math.round(units * 10) / 10).replace('.', ',');
};

const formatAttendanceSymbol = (
  value: number | null | undefined,
  options: { blankWhenZero?: boolean } = {},
) => {
  const units = Number(value ?? 0);
  if (units >= 1) return '✓';
  if (units >= 0.5) return '~';
  if (options.blankWhenZero) return '';
  return 'x';
};

const normalizeAttendanceInput = (value: any) => {
  const raw = normalizeText(value).toLowerCase();
  if (raw === '' || raw === '—') return { valid: true, countRaw: null };
  if (['/', '1', '✓', '✔'].includes(raw)) return { valid: true, countRaw: 1 };
  if (['-', '~', '0.5', '0,5'].includes(raw)) return { valid: true, countRaw: 0.5 };
  if (['x', '0'].includes(raw)) return { valid: true, countRaw: 0 };
  return { valid: false, countRaw: null };
};

const resolvePersistableAttendanceCellContext = (cell: any, meta: DashboardMeta) => {
  const field = normalizeText(cell?.getField?.() || cell?.getColumn?.()?.getDefinition?.()?.field || '');
  const rowData = cell?.getData?.() || cell?.getRow?.()?.getData?.() || {};
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

const persistSingleAttendanceCellValue = async (
  cell: any,
  normalized: ReturnType<typeof normalizeAttendanceInput>,
  meta: DashboardMeta,
) => {
  const context = resolvePersistableAttendanceCellContext(cell, meta);
  if (!context) return false;

  setDashboardSaveStatus('saving', `Guardando asistencia ${context.dateKey}...`);
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
    setDashboardSaveStatus('error', payload?.error || 'No se pudo guardar la asistencia manual');
    throw new Error(payload?.error || 'No se pudo guardar la asistencia manual');
  }

  const payload = await response.json().catch(() => ({}));
  const nextCount = typeof payload?.meta?.count === 'number' ? payload.meta.count : null;
  const rowData = cell.getData?.() || {};
  const nextCellMeta = rowData?.__attendanceCellMeta?.[context.field];
  const liveValue = Number(nextCellMeta?.liveValue || 0);
  const nextEffectiveValue = nextCount ?? liveValue;
  const nextDisplay = nextCount !== null
    ? formatAttendanceSymbol(nextCount)
    : formatAttendanceSymbol(liveValue, { blankWhenZero: true });
  if (nextCellMeta) {
    nextCellMeta.hasManualOverride = nextCount !== null;
    nextCellMeta.manualValue = nextCount;
    nextCellMeta.effectiveValue = nextEffectiveValue;
    // Setting any override marks this date as a class day; removing reverts to live-based
    if (nextCount !== null) nextCellMeta.isClassDay = true;
    else if (liveValue > 0) nextCellMeta.isClassDay = true;
    nextCellMeta.countsTowardAbsence = !nextCellMeta.isFuture && Boolean(nextCellMeta.isClassDay);
    nextCellMeta.title = `Room: ${formatAttendanceSymbol(liveValue, { blankWhenZero: true }) || '—'} • Override: ${nextCount === null ? 'auto' : formatAttendanceSymbol(nextCount)} • Final: ${formatAttendanceSymbol(nextEffectiveValue, { blankWhenZero: true }) || '—'}`;
  }

  let absenceUnits = 0;
  let attendanceUnits = 0;
  let scheduledDayCount = 0;
  Object.values(rowData?.__attendanceCellMeta || {}).forEach((entry: any) => {
    // Only count past/today days toward totals and absences
    if (!entry?.countsTowardAbsence) return;
    scheduledDayCount += 1;
    // Blank cell (no manual override, no live presence) counts as present by default
    const hasAnyData = entry?.hasManualOverride || Number(entry?.liveValue || 0) > 0;
    const effectivePresence = hasAnyData ? Number(entry?.effectiveValue || 0) : 1;
    attendanceUnits += Math.max(0, effectivePresence);
    absenceUnits += Math.max(0, 1 - effectivePresence);
  });
  const attendanceRate = scheduledDayCount > 0
    ? Math.round((attendanceUnits / scheduledDayCount) * 1000) / 10
    : 0;

  await cell.getRow()?.update?.({
    [context.field]: nextDisplay,
    attendanceRate,
    attendanceCount: attendanceUnits,
    attendanceTotalCount: scheduledDayCount,
    absenceUnits,
    absenceDisplay: formatAbsence(absenceUnits),
  });

  setDashboardSaveStatus('saved', `Asistencia guardada: ${context.dateKey}.`);
  return true;
};

const getTurnoTitle = (value: string) => {
  const v = normalizeText(value).toUpperCase();
  if (v === 'M') return 'Mañana';
  if (v === 'T') return 'Tarde';
  if (v === 'N') return 'Noche';
  return 'Sin turno';
};

const normalizeGrupoDigits = (value: any) => {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === 'X') return 'X';
  const raw = normalized.replace(/[^0-9]/g, '');
  return raw ? String(parseInt(raw, 10)) : '';
};

const getCommentShortcutLabel = () => {
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  return isMac ? '⌥ + ⌘ + M' : 'Alt + Ctrl + M';
};

const isAnnotationContextKind = (kind: GridKind) =>
  ['teacher-main', 'overview', 'gradebook', 'attendance-summary', 'admin'].includes(kind);

const resolveTeacherMainAnnotationSection = (field: string) => {
  const normalizedField = normalizeText(field);
  if (!normalizedField) {
    return {
      tabLabel: 'Tabla',
      scopeType: 'overview_cell' as DashboardAnnotationScopeType,
    };
  }

  if (normalizedField === 'absenceUnits' || normalizedField.startsWith('day_')) {
    return {
      tabLabel: 'Asistencia',
      scopeType: 'attendance_cell' as DashboardAnnotationScopeType,
    };
  }

  if (normalizedField.startsWith('eval__') || normalizedField.startsWith('__avg_')) {
    return {
      tabLabel: 'Gradebook',
      scopeType: 'gradebook_cell' as DashboardAnnotationScopeType,
    };
  }

  return {
    tabLabel: 'Profile',
    scopeType: 'overview_cell' as DashboardAnnotationScopeType,
  };
};

const buildScopeContextFromCell = (cell: any, gridKind: GridKind): CellScopeContext | null => {
  const field = normalizeText(cell.getField?.() || '');
  const rowData = cell.getData?.() || {};
  const columnDefinition = cell.getColumn?.()?.getDefinition?.() || {};
  const subjectUserId = normalizeText(rowData?.studentId || rowData?.userId || rowData?.id || '');
  if (!field || !subjectUserId) return null;

  let tab: CellScopeContext['tab'] = 'overview';
  let tabLabel = 'Resumen';
  if (gridKind === 'teacher-main') {
    tab = 'main';
    const teacherMainSection = resolveTeacherMainAnnotationSection(field);
    tabLabel = teacherMainSection.tabLabel;
  } else if (gridKind === 'gradebook') {
    tab = 'gradebook';
    tabLabel = 'Calificaciones';
  } else if (gridKind === 'attendance-summary') {
    tab = 'attendance-summary';
    tabLabel = 'Asistencia';
  } else if (gridKind === 'admin') {
    tab = 'admin';
    tabLabel = 'Admin';
  }

  let scopeType: DashboardAnnotationScopeType = 'overview_cell';
  if (gridKind === 'teacher-main') {
    scopeType = resolveTeacherMainAnnotationSection(field).scopeType;
  } else if (gridKind === 'gradebook') scopeType = 'gradebook_cell';
  else if (gridKind === 'attendance-summary') scopeType = 'attendance_cell';
  else if (gridKind === 'admin') scopeType = 'admin_cell';

  const scopeRef = `${subjectUserId}::${field}`;

  return {
    tab,
    tabLabel,
    scopeType,
    scopeRef,
    subjectUserId,
    field,
    columnLabel: normalizeText(columnDefinition.title || field),
    rowLabel: normalizeText(
      [rowData.lastName, rowData.firstName].filter(Boolean).join(' ')
      || rowData.name
      || subjectUserId,
    ),
    metadata: {
      ...rowData,
      __gradeState: undefined,
      __attendanceCellMeta: undefined,
      __search: undefined,
    },
  };
};

const getDisplayAnnotation = (state: AnnotationState, context: CellScopeContext) => {
  const key = buildDashboardAnnotationScopeKey(context.scopeType, context.scopeRef);
  const list = state.annotationsByScope.get(key) || [];
  if (list.length === 0) return null;
  const own = list.find((a) => a.authorUserId === state.currentUserId);
  if (own) return own;
  const teachers = list.filter((a) => a.visibility === 'teachers');
  return teachers[0] || null;
};

const getOwnAnnotation = (state: AnnotationState, context: CellScopeContext) => {
  const key = buildDashboardAnnotationScopeKey(context.scopeType, context.scopeRef);
  const list = state.annotationsByScope.get(key) || [];
  return list.find((a) => a.authorUserId === state.currentUserId) || null;
};

const refreshAnnotationViews = (state: AnnotationState, targetTab?: string) => {
  if (targetTab) {
    const tables = new Set<Tabulator>();
    const primary = state.registry.get(targetTab);
    if (primary) tables.add(primary);
    if (targetTab === 'main') {
      ['teacher-main'].forEach((key) => {
        const table = state.registry.get(key);
        if (table) tables.add(table);
      });
    }
    tables.forEach((table) => {
      redrawTablePreservingScroll(table);
    });
    return;
  }
  state.registry.forEach((table) => {
    redrawTablePreservingScroll(table);
  });
};

const setAnnotations = (state: AnnotationState, annotations: DashboardAnnotationRecord[]) => {
  state.annotations = annotations || [];
  state.annotationsByScope.clear();
  state.annotations.forEach((record) => {
    const key = buildDashboardAnnotationScopeKey(record.scopeType, record.scopeRef);
    if (!state.annotationsByScope.has(key)) {
      state.annotationsByScope.set(key, []);
    }
    state.annotationsByScope.get(key)?.push(record);
  });
};

const upsertAnnotationInState = (state: AnnotationState, record: DashboardAnnotationRecord) => {
  const index = state.annotations.findIndex((a) => a.id === record.id);
  if (index !== -1) {
    state.annotations[index] = record;
  } else {
    state.annotations.push(record);
  }
  setAnnotations(state, state.annotations);
};

const removeAnnotationFromState = (state: AnnotationState, annotationId: string) => {
  state.annotations = state.annotations.filter((a) => a.id !== annotationId);
  setAnnotations(state, state.annotations);
};

const setActiveSelection = (state: AnnotationState, cell: any, context: CellScopeContext | null) => {
  if (state.selectedCellEl) {
    state.selectedCellEl.classList.remove('dashboard-cell--selected');
  }
  state.selectedCell = cell || null;
  state.selectedContext = context;
  state.selectedCellEl = cell?.getElement?.() || null;
  if (state.selectedCellEl) {
    state.selectedCellEl.classList.add('dashboard-cell--selected');
  }
};

const buildCellMarkup = (
  cell: any,
  kind: GridKind,
  state: AnnotationState,
  baseFormatter: (cell: any) => string,
) => {
  const context = buildScopeContextFromCell(cell, kind);
  if (!context) return baseFormatter(cell);

  const annotation = getDisplayAnnotation(state, context);
  const color = normalizeDashboardAnnotationColor(annotation?.color);
  const shellClass = color
    ? `dashboard-annotation-shell dashboard-annotation-shell--${color}`
    : 'dashboard-annotation-shell';
  const content = baseFormatter(cell);
  const hasComment = normalizeText(annotation?.comment).length > 0;
  const commentDot = hasComment ? '<div class="dashboard-annotation-dot"></div>' : '';

  return `<div class="${shellClass}"><div class="dashboard-annotation-shell__content">${content}</div>${commentDot}</div>`;
};

const buildCommentsRowsFromAnnotations = (annotations: DashboardAnnotationRecord[]) => {
  return (annotations || []).map((a) => ({
    id: a.id,
    authorName: a.authorName || a.authorEmail || 'Teacher',
    studentName: a.metadata?.studentName || a.subjectUserId || '—',
    tabLabel: a.metadata?.tabLabel || a.tab || '—',
    scopeLabel: a.metadata?.scopeLabel || a.scopeRef || '—',
    color: a.color,
    comment: a.comment,
    visibility: a.visibility,
    updatedAt: a.updatedAt || a.createdAt,
    __search: normalizeTextLower(`${a.authorName} ${a.authorEmail} ${a.metadata?.studentName} ${a.comment} ${a.color} ${a.visibility}`),
  }));
};

const renderPlainMarkup = (cell: any) => {
  const val = cell.getValue();
  return val === null || val === undefined || val === '' ? '—' : escapeHtml(String(val));
};

const renderRiskMarkup = (cell: any) => {
  const val = Number(cell.getValue() || 0);
  const color = val > 0.7 ? '#ef4444' : val > 0.4 ? '#f59e0b' : 'inherit';
  return `<span style="color: ${color}; font-weight: bold;">${val.toFixed(2)}</span>`;
};

const renderScoreMarkup = (cell: any) => {
  const val = cell.getValue();
  if (val === null || val === undefined || val === '') return '<span class="dashboard-val-empty">—</span>';
  const num = Number(val);
  const colorClass = num >= 7 ? 'dashboard-score-high' : num >= 4 ? 'dashboard-score-mid' : 'dashboard-score-low';
  return `<span class="dashboard-score-pill ${colorClass}">${num.toFixed(1)}</span>`;
};

const renderGradeMarkup = (cell: any) => {
  const val = cell.getValue();
  if (val === null || val === undefined || val === '') return '<span class="dashboard-val-empty">—</span>';
  const data = cell.getData() || {};
  const field = cell.getField();
  const status = normalizeText(data?.__gradeState?.[field]?.statusLabel);
  const statusMarkup = status ? `<span class="dashboard-grade-status">${escapeHtml(status)}</span>` : '';
  // Non-numeric submitted value (form-msq, form-text): show checkmark badge
  const num = Number(val);
  if (Number.isNaN(num)) {
    return `<div class="dashboard-grade-wrap"><span class="dashboard-grade-check">${escapeHtml(String(val))}</span>${statusMarkup}</div>`;
  }
  const colorClass = num >= 7 ? 'dashboard-score-high' : num >= 4 ? 'dashboard-score-mid' : 'dashboard-score-low';
  return `<div class="dashboard-grade-wrap"><span class="dashboard-score-pill ${colorClass}">${num.toFixed(1)}</span>${statusMarkup}</div>`;
};

const renderAbsenceMarkup = (cell: any) => {
  const val = Number(cell.getValue() || 0);
  const color = val >= 3 ? '#ef4444' : val >= 1 ? '#f59e0b' : 'inherit';
  return `<span style="color: ${color}">${formatAbsence(val)}</span>`;
};

const renderPercentMarkup = (cell: any) => {
  const val = Number(cell.getValue() || 0);
  return `${val.toFixed(1)}%`;
};

const renderAttendanceProgressMarkup = (cell: any) => {
  const val = Number(cell.getValue() || 0);
  const color = val < 60 ? '#ef4444' : val < 80 ? '#f59e0b' : '#10b981';
  return `
    <div class="dashboard-progress-wrap">
      <div class="dashboard-progress-bg">
        <div class="dashboard-progress-bar" style="width: ${val}%; background-color: ${color}"></div>
      </div>
      <span class="dashboard-progress-label">${val.toFixed(1)}%</span>
    </div>
  `;
};

const renderDateTimeCellMarkup = (cell: any) => formatSubmissionDate(cell.getValue());

const renderAttendanceMarkup = (cell: any) => {
  const val = cell.getValue();
  const field = cell.getField();
  const meta = cell.getData()?.__attendanceCellMeta?.[field];
  if (!meta) return escapeHtml(String(val || ''));

  const units = Number(meta.effectiveValue || 0);
  const isFuture = Boolean(meta.isFuture);
  const hasManual = Boolean(meta.hasManualOverride);
  const liveValue = Number(meta.liveValue || 0);
  const isRoom = !hasManual && String(val || '') === 'r';

  const symbol = isRoom
    ? 'r'
    : hasManual
      ? formatAttendanceSymbol(units)
      : formatAttendanceSymbol(liveValue, { blankWhenZero: true });

  let cssClass = 'dashboard-attendance-chip';
  if (isFuture) cssClass += ' dashboard-attendance-chip--future';
  if (hasManual) cssClass += ' dashboard-attendance-chip--manual';
  if (isRoom) cssClass += ' dashboard-attendance-chip--room';
  else if (units >= 1) cssClass += ' dashboard-attendance-chip--present';
  else if (units >= 0.5) cssClass += ' dashboard-attendance-chip--partial';
  else if (!isFuture) cssClass += ' dashboard-attendance-chip--empty';

  return `<span class="${cssClass}">${symbol}</span>`;
};

const annotationColorFormatter = (cell: any) => {
  const value = cell.getValue();
  const label = dashboardAnnotationColorLabel(value);
  return `<div class="dashboard-annotation-color-cell" style="background-color: ${value || 'transparent'}"></div><span>${label}</span>`;
};

const roleFormatter = (cell: any) => {
  const value = cell.getValue();
  const normalized = normalizeText(value).toLowerCase();
  const isTeacher = normalized === 'teacher';
  return `<span class="role-badge ${isTeacher ? 'role-badge--teacher' : 'role-badge--student'}">${isTeacher ? 'Teacher' : 'Student'}</span>`;
};

const normalizeBoundedNumericInput = (value: any) => {
  const raw = String(value ?? '').replace(',', '.').trim();
  if (raw === '' || raw === '—') return '';
  const n = parseFloat(raw);
  if (!isFinite(n)) return '';
  return String(Math.min(10, Math.max(0, Number(n.toFixed(2)))));
};

const normalizeConceptoInput = (value: any) => normalizeBoundedNumericInput(value);
const normalizeFinalGradeInput = (value: any) => normalizeBoundedNumericInput(value);
const normalizeNotesInput = (value: any) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);

const renderAdminActionsMarkup = (cell: any) => {
  const data = cell.getData() || {};
  const uid  = escapeHtml(data.id);
  const name = escapeHtml(data.name);
  const email = escapeHtml(data.email);
  const role  = escapeHtml(data.globalRole);
  const crole = escapeHtml(data.courseRole);
  return `
    <div class="dashboard-admin-actions">
      <button type="button" class="dashboard-grid-icon-btn" data-dashboard-user-edit data-user-id="${uid}" data-user-name="${name}" data-user-email="${email}" data-user-global-role="${role}" title="Editar usuario">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
      </button>
      <button type="button" class="dashboard-grid-icon-btn dashboard-grid-icon-btn--danger" data-dashboard-user-delete data-user-id="${uid}" data-user-name="${name}" data-user-email="${email}" data-user-global-role="${role}" data-user-course-role="${crole}" title="Borrar usuario">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
      </button>
    </div>
  `;
};

const renderEnrollmentCoursesMarkup = (cell: any) => {
  const data = cell.getData() || {};
  const userName = escapeHtml(data.name || data.email || '');
  const courses: Array<{ courseId: string; enrollmentId: string; roleInCourse: string }> =
    Array.isArray(data.enrollmentCourses) ? data.enrollmentCourses : [];
  if (!courses.length) return '<span style="color:var(--c-fg-dim)">—</span>';
  return courses
    .map(({ courseId, enrollmentId, roleInCourse }) => {
      const cid = escapeHtml(courseId);
      const eid = escapeHtml(enrollmentId);
      const role = escapeHtml(roleInCourse);
      const uname = userName;
      return `<span class="enrollment-chip" data-course-id="${cid}">${cid}<button type="button" class="enrollment-chip-remove" data-dashboard-unenroll data-enrollment-id="${eid}" data-enrollment-role="${role}" data-user-name="${uname}" title="Desinscribir de ${cid}" aria-label="Desinscribir de ${cid}">×</button></span>`;
    })
    .join('');
};

const buildCellSelectionKey = (cell: any) => {
  const field = normalizeText(cell?.getField?.() || cell?.getColumn?.()?.getDefinition?.()?.field || '');
  const rowData = cell?.getData?.() || {};
  const rowId = normalizeText(
    rowData?.id
    || rowData?.studentId
    || rowData?.userId
    || cell?.getRow?.()?.getIndex?.()
    || '',
  );
  if (!rowId || !field) return '';
  return `${rowId}::${field}`;
};

const getCellField = (cell: any) =>
  normalizeText(cell?.getField?.() || cell?.getColumn?.()?.getDefinition?.()?.field || '');

const getCellKind = (cell: any) =>
  normalizeText(getColumnDashboardMeta(cell?.getColumn?.()).kind || '');

const appendCssClass = (...classNames: any[]) =>
  classNames
    .flatMap((value) => String(value || '').split(/\s+/))
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ');

const COURSE_STUDENT_META_CELL_KINDS = [
  'turno',
  'grupo',
  'concepto',
  'notes',
  'final-grade',
];

const isCourseStudentMetaCellKind = (kind: string) =>
  COURSE_STUDENT_META_CELL_KINDS.includes(normalizeText(kind));

const isNativeDashboardEditableKind = (kind: string) => {
  const normalizedKind = normalizeText(kind);
  return normalizedKind === 'course-role'
    || normalizedKind === 'editable-text'
    || isCourseStudentMetaCellKind(normalizedKind);
};

const getRowComponentId = (row: any) =>
  normalizeText(row?.getData?.()?.id || row?.getIndex?.() || '');

const normalizeCourseStudentMetaValue = (kind: string, value: any) => {
  const normalizedKind = normalizeText(kind);
  if (normalizedKind === 'turno') {
    const turno = normalizeText(value).toUpperCase();
    return ['M', 'T', 'N'].includes(turno) ? turno : 'M';
  }
  if (normalizedKind === 'grupo') return normalizeGrupoDigits(value);
  if (normalizedKind === 'concepto') return normalizeConceptoInput(value);
  if (normalizedKind === 'notes') return normalizeNotesInput(value);
  if (normalizedKind === 'final-grade') return normalizeFinalGradeInput(value);
  return normalizeText(value);
};

const validateCourseStudentMetaValue = (kind: string, value: any) => {
  const normalizedKind = normalizeText(kind);
  const raw = normalizeText(value);
  const normalized = normalizeCourseStudentMetaValue(normalizedKind, value);

  if (normalizedKind === 'grupo' && raw && !normalized) {
    return {
      valid: false,
      normalized,
      message: 'Grupo debe ser un valor numérico o X.',
    };
  }

  if (normalizedKind === 'concepto' && raw && !normalized) {
    return {
      valid: false,
      normalized,
      message: 'Concepto debe ser un número entre 0 y 10.',
    };
  }

  if (normalizedKind === 'final-grade' && raw && !normalized) {
    return {
      valid: false,
      normalized,
      message: 'Nota final debe ser un número entre 0 y 10.',
    };
  }

  return {
    valid: true,
    normalized,
    message: '',
  };
};

const getCourseStudentMetaPatchKey = (kind: string) => {
  const normalizedKind = normalizeText(kind);
  if (normalizedKind === 'turno') return 'turno';
  if (normalizedKind === 'grupo') return 'grupo';
  if (normalizedKind === 'concepto') return 'concepto';
  if (normalizedKind === 'notes') return 'notes';
  if (normalizedKind === 'final-grade') return 'notaFinal';
  return '';
};

const getCourseStudentMetaResponseValue = (kind: string, payload: any, fallbackValue: string) => {
  const normalizedKind = normalizeText(kind);
  if (normalizedKind === 'turno') {
    return normalizeCourseStudentMetaValue(kind, payload?.meta?.turno ?? fallbackValue);
  }
  if (normalizedKind === 'grupo') {
    return normalizeText(payload?.meta?.grupo ?? fallbackValue);
  }
  if (normalizedKind === 'concepto') {
    return normalizeCourseStudentMetaValue(kind, payload?.meta?.concepto ?? fallbackValue);
  }
  if (normalizedKind === 'notes') {
    return normalizeCourseStudentMetaValue(kind, payload?.meta?.notes ?? fallbackValue);
  }
  if (normalizedKind === 'final-grade') {
    return normalizeCourseStudentMetaValue(kind, payload?.meta?.notaFinal ?? fallbackValue);
  }
  return fallbackValue;
};

const getCourseStudentMetaFallbackError = (kind: string) => {
  const normalizedKind = normalizeText(kind);
  if (normalizedKind === 'turno') return 'No se pudo actualizar el turno';
  if (normalizedKind === 'grupo') return 'No se pudo actualizar el grupo';
  if (normalizedKind === 'concepto') return 'No se pudo guardar el concepto';
  if (normalizedKind === 'notes') return 'No se pudieron guardar las notes';
  if (normalizedKind === 'final-grade') return 'No se pudo guardar la nota final';
  return 'No se pudo actualizar la celda';
};

const CUSTOM_INTERACTIVE_CELL_KINDS = [
  'admin-actions',
];

const isCustomInteractiveCellKind = (kind: string) =>
  CUSTOM_INTERACTIVE_CELL_KINDS.includes(normalizeText(kind));

const getInteractiveElementFromTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return null;
  if (target.matches('input, textarea, select, button, a')) return target;
  return target.querySelector<HTMLElement>('input, textarea, select, button, a');
};

const shouldLetInteractiveMouseBubble = (target: EventTarget | null) =>
  target instanceof HTMLElement
  && Boolean(target.closest('.dashboard-admin-actions, [data-dashboard-unenroll], .enrollment-chip-remove'));

const getSelectedRangeCells = (table: Tabulator | null | undefined) => {
  const rangeState: RangeSelectionState | undefined = (table as any)?.__musikiRangeSelectionState;
  const cellsByKey = new Map<string, any>();
  Array.from(rangeState?.selectedCells || []).forEach((cell) => {
    const key = buildCellSelectionKey(cell);
    if (!key) return;
    cellsByKey.set(key, cell);
  });
  return Array.from(cellsByKey.values());
};

const resolveSelectedTargetCells = (
  anchorCell: any,
  options?: {
    sameField?: boolean;
    sameKind?: boolean;
    filter?: (cell: any) => boolean;
  },
) => {
  if (!anchorCell) return [] as any[];

  const anchorKey = buildCellSelectionKey(anchorCell);
  const anchorField = getCellField(anchorCell);
  const anchorKind = getCellKind(anchorCell);
  const selectedCells = getSelectedRangeCells(anchorCell.getTable?.());
  const anchorIsInsideSelection =
    Boolean(anchorKey) && selectedCells.some((candidate) => buildCellSelectionKey(candidate) === anchorKey);

  let targets = selectedCells.length > 1 && anchorIsInsideSelection
    ? selectedCells
    : [anchorCell];

  if (options?.sameField && anchorField) {
    targets = targets.filter((candidate) => getCellField(candidate) === anchorField);
  }

  if (options?.sameKind && anchorKind) {
    targets = targets.filter((candidate) => getCellKind(candidate) === anchorKind);
  }

  if (options?.filter) {
    targets = targets.filter((candidate) => options.filter?.(candidate));
  }

  if (!targets.length) {
    if (!options?.filter || options.filter(anchorCell)) {
      return [anchorCell];
    }
    return [];
  }

  const cellsByKey = new Map<string, any>();
  targets.forEach((candidate) => {
    const key = buildCellSelectionKey(candidate);
    if (!key) return;
    cellsByKey.set(key, candidate);
  });

  return Array.from(cellsByKey.values());
};

const resolveContextMenuTargetCells = (cell: any, kind: GridKind): any[] =>
  resolveSelectedTargetCells(cell, {
    filter: (candidate) => buildScopeContextFromCell(candidate, kind) !== null,
  });

const resolveSelectedTargetRows = (table: Tabulator, target: EventTarget | null) => {
  const anchorCell = resolveCellComponentFromTarget(table, target, { allowInteractiveKinds: true });
  const anchorRow = anchorCell?.getRow?.() || null;
  if (!anchorRow) return [] as any[];

  const anchorRowId = normalizeText(anchorRow.getData?.()?.id || anchorRow.getIndex?.() || '');
  const rowsById = new Map<string, any>();
  getSelectedRangeCells(table).forEach((cell) => {
    const row = cell?.getRow?.();
    const rowId = normalizeText(row?.getData?.()?.id || row?.getIndex?.() || '');
    if (!row || !rowId) return;
    rowsById.set(rowId, row);
  });

  if (rowsById.size > 1 && anchorRowId && rowsById.has(anchorRowId)) {
    return Array.from(rowsById.values());
  }

  return [anchorRow];
};

const collectAdminUsersFromRows = (rows: any[]) => {
  const usersById = new Map<string, {
    id: string;
    name: string;
    email: string;
    globalRole: string;
    courseRole: string;
  }>();

  rows.forEach((row) => {
    const data = row?.getData?.() || {};
    const id = normalizeText(data.id || '');
    if (!id) return;
    usersById.set(id, {
      id,
      name: normalizeText(data.name || 'este usuario') || 'este usuario',
      email: normalizeText(data.email || ''),
      globalRole: normalizeTextLower(data.globalRole || ''),
      courseRole: normalizeTextLower(data.courseRole || ''),
    });
  });

  return Array.from(usersById.values());
};

const deleteAdminUsers = async (
  table: Tabulator,
  meta: DashboardMeta,
  users: Array<{
    id: string;
    name: string;
    email: string;
    globalRole: string;
    courseRole: string;
  }>,
  triggerButton?: HTMLButtonElement | null,
) => {
  const selectedUsers = users.filter((user) => normalizeText(user?.id || ''));
  if (!selectedUsers.length) return false;

  const isBatch = selectedUsers.length > 1;
  const anyGlobalTeacher = selectedUsers.some((user) => user.globalRole === 'teacher');
  const anyCourseTeacher = selectedUsers.some((user) => user.courseRole === 'teacher');
  const warningBits = [
    isBatch
      ? `Usuarios: ${selectedUsers.slice(0, 5).map((user) => user.name || user.email || user.id).join(' · ')}${selectedUsers.length > 5 ? '…' : ''}`
      : selectedUsers[0]?.email
        ? `Email: ${selectedUsers[0].email}`
        : '',
    anyGlobalTeacher ? 'Hay usuarios con rol global teacher.' : '',
    anyCourseTeacher ? 'Hay usuarios con rol teacher en este curso.' : '',
    'Se borrarán también sus inscripciones y submissions.',
  ].filter(Boolean);
  const confirmMessage = [
    isBatch
      ? `¿Borrar ${selectedUsers.length} usuarios seleccionados?`
      : `¿Borrar a ${selectedUsers[0]?.name || 'este usuario'}?`,
    ...warningBits,
  ].join('\n');

  if (!window.confirm(confirmMessage)) return false;

  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.dataset.state = 'saving';
  }

  setDashboardSaveStatus(
    'saving',
    isBatch
      ? `Borrando ${selectedUsers.length} usuarios...`
      : `Borrando a ${selectedUsers[0]?.name || 'usuario'}...`,
  );

  try {
    const failures: string[] = [];
    let successCount = 0;

    for (const selectedUser of selectedUsers) {
      try {
        const requestUrl = new URL(`/api/admin/users/${encodeURIComponent(selectedUser.id)}`, window.location.origin);
        if (normalizeText(meta?.courseId || '')) {
          requestUrl.searchParams.set('courseId', normalizeText(meta.courseId));
        }

        const response = await fetch(requestUrl.toString(), {
          method: 'DELETE',
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || `No se pudo borrar a ${selectedUser.name}`);
        }

        successCount += 1;
        const row = table.getRow(selectedUser.id);
        if (row) {
          row.delete();
        }
      } catch (error: any) {
        failures.push(error?.message || `No se pudo borrar a ${selectedUser.name}`);
      }
    }

    if (failures.length > 0) {
      const message = successCount > 0
        ? `Se borraron ${successCount} usuarios, pero fallaron ${failures.length}.`
        : failures[0] || 'No se pudo borrar el usuario';
      setDashboardSaveStatus('error', message);
      throw new Error(message);
    }

    setDashboardSaveStatus(
      'saved',
      isBatch
        ? `${successCount} usuarios borrados.`
        : `${selectedUsers[0]?.name || 'Usuario'} borrado.`,
    );
    window.location.reload();
    return true;
  } catch (error: any) {
    console.error('Error deleting dashboard user:', error);
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.dataset.state = 'error';
    }
    alert(error?.message || 'No se pudo borrar el usuario');
    return false;
  }
};

const postCourseStudentMetaUpdate = async (
  meta: DashboardMeta,
  studentId: string,
  patch: Record<string, any>,
  fallbackError: string,
) => {
  const patchLabel = Object.keys(patch || {})[0] || 'dato';
  setDashboardSaveStatus('saving', `Guardando ${patchLabel}...`);
  const response = await fetch('/api/grade/course-student-meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courseId: meta.courseId,
      year: meta.year,
      studentId,
      ...patch,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    setDashboardSaveStatus('error', payload?.error || fallbackError);
    throw new Error(payload?.error || fallbackError);
  }

  setDashboardSaveStatus('saved', `${patchLabel} guardado.`);
  return payload;
};

const normalizeCourseRoleValue = (value: any) =>
  normalizeTextLower(value) === 'teacher' ? 'teacher' : 'student';

const getCourseRoleLabel = (value: any) =>
  normalizeCourseRoleValue(value) === 'teacher' ? 'Teacher' : 'Student';

const postCourseRoleUpdate = async (
  enrollmentId: string,
  roleInCourse: string,
  fallbackError = 'No se pudo actualizar el rol del curso',
) => {
  setDashboardSaveStatus('saving', 'Guardando rol del curso...');
  const response = await fetch('/api/enroll', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enrollmentId,
      roleInCourse,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    setDashboardSaveStatus('error', payload?.error || fallbackError);
    throw new Error(payload?.error || fallbackError);
  }

  setDashboardSaveStatus('saved', `Rol del curso guardado: ${roleInCourse}.`);
  return payload;
};

const saveCourseRoleSelectionFromCell = async (
  cell: any,
  overrideNextValue?: any,
  overridePreviousValue?: any,
) => {
  if (getCellKind(cell) !== 'course-role') return;

  const field = getCellField(cell);
  const previousValue = normalizeCourseRoleValue(
    getCellPreviousValue(cell, overridePreviousValue),
  );
  const nextValue = normalizeCourseRoleValue(overrideNextValue ?? cell.getValue?.());

  const restoreCellValue = async (targetCell: any, value: string) => {
    const row = targetCell?.getRow?.();
    if (!row) return;
    await row.update({
      [field]: value,
      courseRoleLabel: getCourseRoleLabel(value),
    });
  };

  if (nextValue === previousValue) {
    await restoreCellValue(cell, nextValue);
    return;
  }

  const targetCells = resolveSelectedTargetCells(cell, {
    sameField: true,
    sameKind: true,
    filter: (candidate) => Boolean(normalizeText(candidate?.getData?.()?.enrollmentId || '')),
  });

  const targets = targetCells
    .map((targetCell) => {
      const rowData = targetCell?.getData?.() || {};
      const rowId = normalizeText(rowData.id || targetCell?.getRow?.()?.getIndex?.() || '');
      const enrollmentId = normalizeText(rowData.enrollmentId || '');
      const existingValue = targetCell === cell
        ? previousValue
        : normalizeCourseRoleValue(targetCell?.getValue?.());
      if (!rowId || !enrollmentId) return null;
      return {
        cell: targetCell,
        rowId,
        enrollmentId,
        previousValue: existingValue,
      };
    })
    .filter(Boolean) as Array<{
      cell: any;
      rowId: string;
      enrollmentId: string;
      previousValue: string;
    }>;

  if (!targets.length) {
    await restoreCellValue(cell, previousValue);
    return;
  }

  let successCount = 0;
  const failureMessages: string[] = [];

  for (const target of targets) {
    try {
      await saveSingleCourseRoleCellValue(target.cell, nextValue, target.previousValue);
      successCount += 1;
    } catch (error: any) {
      failureMessages.push(error?.message || 'No se pudo actualizar el rol del curso');
      await restoreCellValue(target.cell, target.previousValue);
    }
  }

  if (failureMessages.length > 0) {
    if (successCount === 0) {
      alert(failureMessages[0]);
    } else {
      alert(`Se guardaron ${successCount} celdas, pero ${failureMessages.length} fallaron.`);
    }
  }
};

const saveCourseStudentMetaSelectionFromCell = async (
  cell: any,
  meta: DashboardMeta,
  overrideNextValue?: any,
  overridePreviousValue?: any,
) => {
  const kind = getCellKind(cell);
  if (!isCourseStudentMetaCellKind(kind)) return;

  const field = getCellField(cell);
  const previousValue = normalizeCourseStudentMetaValue(
    kind,
    getCellPreviousValue(cell, overridePreviousValue),
  );
  const validation = validateCourseStudentMetaValue(kind, overrideNextValue ?? cell.getValue?.());
  const nextValue = validation.normalized;

  const restoreCellValue = async (targetCell: any, value: string) => {
    const row = targetCell?.getRow?.();
    if (!row) return;
    await row.update({
      [field]: value || '',
    });
  };

  if (!validation.valid) {
    await restoreCellValue(cell, previousValue);
    alert(validation.message);
    return;
  }

  if (!meta?.courseId || !meta?.year) {
    await restoreCellValue(cell, previousValue);
    return;
  }

  if (nextValue === previousValue) {
    await restoreCellValue(cell, nextValue);
    return;
  }

  const patchKey = getCourseStudentMetaPatchKey(kind);
  if (!patchKey) return;

  const targetCells = resolveSelectedTargetCells(cell, {
    sameField: true,
    sameKind: true,
    filter: (candidate) => Boolean(normalizeText(candidate?.getData?.()?.studentId || '')),
  });

  const targets = targetCells
    .map((targetCell) => {
      const rowData = targetCell?.getData?.() || {};
      const rowId = normalizeText(rowData.id || targetCell?.getRow?.()?.getIndex?.() || '');
      const studentId = normalizeText(rowData.studentId || '');
      const existingValue = targetCell === cell
        ? previousValue
        : normalizeCourseStudentMetaValue(kind, targetCell?.getValue?.());
      if (!rowId || !studentId) return null;
      return {
        cell: targetCell,
        rowId,
        studentId,
        previousValue: existingValue,
      };
    })
    .filter(Boolean) as Array<{
      cell: any;
      rowId: string;
      studentId: string;
      previousValue: string;
    }>;

  if (!targets.length) {
    await restoreCellValue(cell, previousValue);
    return;
  }

  let successCount = 0;
  const failureMessages: string[] = [];

  for (const target of targets) {
    try {
      await saveSingleCourseStudentMetaCellValue(target.cell, meta, nextValue, target.previousValue);
      successCount += 1;
    } catch (error: any) {
      failureMessages.push(error?.message || getCourseStudentMetaFallbackError(kind));
      await restoreCellValue(target.cell, target.previousValue);
    }
  }

  if (failureMessages.length > 0) {
    if (successCount === 0) {
      alert(failureMessages[0]);
    } else {
      alert(`Se guardaron ${successCount} celdas, pero ${failureMessages.length} fallaron.`);
    }
  }
};

const supportsNativeCellPersistence = (kind: GridKind) =>
  ['teacher-main', 'overview', 'gradebook', 'attendance-summary', 'admin'].includes(kind);

const bindNativeCellPersistence = (
  _host: HTMLElement,
  table: Tabulator,
  context: { kind: GridKind; meta: DashboardMeta },
) => {
  if (!supportsNativeCellPersistence(context.kind)) return () => {};

  const openEditorOnDoubleClick = (event: MouseEvent, cell: any) => {
    const kind = getCellKind(cell);
    if (!isNativeDashboardEditableKind(kind)) return;
    // editable-text has editable:true, so Tabulator handles dblclick natively.
    // Skip here to avoid a double-open race (native fires first, then our setTimeout closes it).
    if (normalizeText(kind) === 'editable-text') return;

    window.getSelection?.()?.removeAllRanges?.();
    event.preventDefault();

    window.setTimeout(() => {
      try {
        if (typeof cell?.edit === 'function') {
          cell.edit(true);
          return;
        }
        cell?.getComponent?.()?.edit?.(true);
      } catch {
        // ignore edit races during redraw
      }
    }, 0);
  };

  const editingSnapshotHandler = (cell: any) => {
    if (!isNativeDashboardEditableKind(getCellKind(cell))) return;
    (cell as any).__musikiPreviousValue = cell?.getValue?.();
  };

  const editedHandler = async (cell: any) => {
    const kind = getCellKind(cell);
    if (!isNativeDashboardEditableKind(kind)) return;

    try {
      if (kind === 'course-role') {
        await saveCourseRoleSelectionFromCell(cell);
        return;
      }

      if (isCourseStudentMetaCellKind(kind)) {
        await saveCourseStudentMetaSelectionFromCell(cell, context.meta);
        return;
      }

      if (kind === 'editable-text') {
        // Use single-cell save: direct edits must only affect the edited cell.
        // saveSelectedUserFieldFromCell would spread the value to the whole range selection.
        await saveSingleUserFieldCellValue(cell, undefined, context.meta);
      }
    } catch (error: any) {
      console.error('Error saving native dashboard editor:', error);
      try {
        cell?.restoreOldValue?.();
      } catch {
        // ignore restore races
      }
      alert(error?.message || 'No se pudo guardar la celda');
    } finally {
      try {
        delete (cell as any).__musikiPreviousValue;
      } catch {
        // ignore cleanup races
      }
    }
  };

  table.on('cellDblClick', openEditorOnDoubleClick);
  table.on('cellEditing', editingSnapshotHandler);
  table.on('cellEdited', editedHandler);

  return () => {
    try {
      table.off('cellDblClick', openEditorOnDoubleClick);
      table.off('cellEditing', editingSnapshotHandler);
      table.off('cellEdited', editedHandler);
    } catch {
      // ignore teardown races
    }
  };
};

const bindNativeEditorFocus = (table: Tabulator) => {
  const handler = (cell: any) => {
    const kind = getCellKind(cell);
    if (!isNativeDashboardEditableKind(kind)) {
      return;
    }

    window.setTimeout(() => {
      const editor = cell?.getElement?.()?.querySelector?.('input, textarea, select');
      if (
        editor instanceof HTMLInputElement
        || editor instanceof HTMLTextAreaElement
        || editor instanceof HTMLSelectElement
      ) {
        try {
          editor.focus();
          if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
            editor.select?.();
          }
        } catch {
          // ignore focus races during redraw
        }
      }
    }, 0);
  };

  table.on('cellEditing', handler);

  return () => {
    try {
      table.off('cellEditing', handler);
    } catch {
      // ignore teardown races
    }
  };
};

const resolveAnnotationGridKind = (tab: CellScopeContext['tab']): GridKind | null => {
  if (tab === 'main') return 'teacher-main';
  if (tab === 'overview') return 'overview';
  if (tab === 'gradebook') return 'gradebook';
  if (tab === 'attendance-summary') return 'attendance-summary';
  if (tab === 'admin') return 'admin';
  return null;
};

const buildAnnotationContextKey = (context: CellScopeContext) =>
  `${context.tab}::${context.subjectUserId}::${context.field}::${context.scopeType}::${context.scopeRef}`;

const resolveSelectedAnnotationContexts = (state: AnnotationState, fallbackContext: CellScopeContext) => {
  const gridKind = resolveAnnotationGridKind(fallbackContext.tab);
  if (!gridKind || !state.selectedCell) return [fallbackContext];

  const anchorContext = buildScopeContextFromCell(state.selectedCell, gridKind);
  const anchorKey = anchorContext ? buildAnnotationContextKey(anchorContext) : '';
  if (!anchorKey || anchorKey !== buildAnnotationContextKey(fallbackContext)) {
    return [fallbackContext];
  }

  const contextsByKey = new Map<string, CellScopeContext>();
  resolveSelectedTargetCells(state.selectedCell, {
    filter: (cell) => buildScopeContextFromCell(cell, gridKind) !== null,
  }).forEach((cell) => {
    const context = buildScopeContextFromCell(cell, gridKind);
    if (!context) return;
    contextsByKey.set(buildDashboardAnnotationScopeKey(context.scopeType, context.scopeRef), context);
  });

  return Array.from(contextsByKey.values()).length
    ? Array.from(contextsByKey.values())
    : [fallbackContext];
};

const findFoldedAncestor = (column: any) => {
  let current = column;
  while (current && typeof current.getParentColumn === 'function') {
    const parent = current.getParentColumn();
    if (!parent) return null;
    const parentElement = parent.getElement?.();
    if (parentElement?.classList?.contains('group-folded')) return parent;
    current = parent;
  }

  const resolvedColumn = resolveColumnComponent(column);
  const element = resolvedColumn?.getElement?.();
  const foldedAncestor = element?.parentElement?.closest?.('.tabulator-col.group-folded');
  if (foldedAncestor) return foldedAncestor;

  return null;
};

const shouldUseShortLeafLabel = (column: any) => {
  const resolvedColumn = resolveColumnComponent(column);
  if (!resolvedColumn) return false;
  if (getGroupSubColumns(resolvedColumn).length > 0) return false;
  return Boolean(findFoldedAncestor(resolvedColumn));
};

const syncFoldedLeafLabels = (table: Tabulator | null | undefined) => {
  if (!table) return;

  const visit = (columns: any[], foldedDepth: number) => {
    (columns || []).forEach((column) => {
      const resolvedColumn = resolveColumnComponent(column);
      if (!resolvedColumn) return;

      const definition = resolvedColumn.getDefinition?.() || {};
      const foldMeta = getFoldMeta(resolvedColumn);
      const children = getGroupSubColumns(resolvedColumn);
      const headerElement = resolvedColumn.getElement?.();
      const isFoldedGroup = Boolean(headerElement?.classList?.contains('group-folded'));

      if (Array.isArray(definition.columns) && children.length > 0) {
        visit(children, foldedDepth + (isFoldedGroup ? 1 : 0));
        return;
      }

      if (!foldMeta?.key || !headerElement) return;

      const fullLabel = String(foldMeta.fullLabel || definition.title || '');
      const shortLabel = String(foldMeta.shortLabel || formatAbletonLabel(fullLabel) || fullLabel);
      const useShort = Boolean(foldMeta.summaryOnly) || foldedDepth > 0;
      const nextLabel = useShort ? shortLabel : fullLabel;
      const textTarget =
        (headerElement.querySelector('.fold-header-label') as HTMLElement | null)
        || (headerElement.querySelector('.dashboard-grade-meta-title__label') as HTMLElement | null);

      if (textTarget) {
        textTarget.textContent = nextLabel;
        textTarget.title = fullLabel;
      } else {
        headerElement.title = fullLabel;
      }
    });
  };

  try {
    visit(table.getColumns?.() || [], 0);
  } catch {
    // ignore transient header sync errors
  }
};

const refreshFoldedLeafLabels = (table: Tabulator | null | undefined) => {
  if (!table) return;
  const sync = () => syncFoldedLeafLabels(table);
  sync();
  window.requestAnimationFrame(sync);
};

const safeShow = (column: any) => {
  try {
    column.show();
  } catch {
    // ignore transient Tabulator visibility errors
  }
};

const safeHide = (column: any) => {
  try {
    column.hide();
  } catch {
    // ignore transient Tabulator visibility errors
  }
};

const hideColumnBranch = (column: any) => {
  getGroupSubColumns(column).forEach(hideColumnBranch);
  safeHide(column);
};

const branchContainsVisibleKey = (column: any, visibleKeys: Set<string>): boolean => {
  if (!column || visibleKeys.size === 0) return false;

  const definition = column.getDefinition?.() || {};
  const foldMeta = getFoldMeta(column);
  const directKeys = [
    String(foldMeta.key || ''),
    String(definition.field || ''),
  ].filter(Boolean);

  if (directKeys.some((key) => visibleKeys.has(key))) {
    return true;
  }

  return getGroupSubColumns(column).some((child) => branchContainsVisibleKey(child, visibleKeys));
};

const visitFoldMetaColumns = (columns: any[], visitor: (column: any, foldMeta: Record<string, any>) => void) => {
  (columns || []).forEach((column) => {
    const foldMeta = getFoldMeta(column);
    if (foldMeta?.key) {
      visitor(column, foldMeta);
    }
    const children = getGroupSubColumns(column);
    if (children.length > 0) {
      visitFoldMetaColumns(children, visitor);
    }
  });
};

const findFoldMetaColumnsByKey = (table: Tabulator | null | undefined, keys: string[]) => {
  const keySet = new Set(keys.map((key) => normalizeText(key)));
  const result = new Map<string, any>();
  if (!table || keySet.size === 0) return result;

  try {
    visitFoldMetaColumns(table.getColumns?.() || [], (column, foldMeta) => {
      const key = normalizeText(foldMeta?.key || '');
      if (!key || !keySet.has(key) || result.has(key)) return;
      result.set(key, column);
    });
  } catch {
    return result;
  }

  return result;
};

const toggleFoldMetaGroup = (
  column: any,
  force?: boolean,
  options?: { persist?: boolean; persistDescendants?: boolean },
) => {
  const definition = column.getDefinition?.() || {};
  const foldMeta = getFoldMeta(column);
  const children = getGroupSubColumns(column);

  if (!Array.isArray(definition.columns) || children.length === 0) {
    return;
  }

  if (foldMeta.disabled && force === undefined) {
    return;
  }

  const headerElement = column.getElement?.();
  if (!headerElement) return;

  const folded = force !== undefined ? force : !headerElement.classList.contains('group-folded');
  const visibleKeys = new Set<string>(
    Array.isArray(foldMeta.visibleChildren) ? foldMeta.visibleChildren.map(String) : [],
  );
  const shouldPersist = options?.persist !== false;
  if (shouldPersist) {
    setDashboardSaveStatus('saving', 'Guardando vista local de columnas...');
  }

  headerElement.classList.toggle('group-folded', folded);
  safeShow(column);

  children.forEach((child) => {
    const childDefinition = child.getDefinition?.() || {};
    const childMeta = getFoldMeta(child);
    const childKey = String(childMeta.key || childDefinition.field || '');
    const isGroup = Array.isArray(childDefinition.columns) && childDefinition.columns.length > 0;
    const keepVisible = visibleKeys.size > 0
      ? visibleKeys.has(childKey) || branchContainsVisibleKey(child, visibleKeys)
      : false;

    if (isGroup) {
      toggleFoldMetaGroup(
        child,
        folded,
        options?.persistDescendants
          ? options
          : { ...options, persist: false },
      );
      if (folded && !keepVisible) {
        hideColumnBranch(child);
      } else {
        safeShow(child);
      }
      return;
    }

    if (folded) {
      if (keepVisible) safeShow(child);
      else safeHide(child);
      return;
    }

    if (childMeta.summaryOnly) {
      safeHide(child);
      return;
    }

    safeShow(child);
  });

  if (shouldPersist) {
    storeCurrentFoldState(column.getTable?.(), `Vista guardada: ${folded ? 'grupo plegado' : 'grupo desplegado'}.`);
  }
};

const unfoldAllColumns = (table: Tabulator, options?: { persist?: boolean }) => {
  if (options?.persist !== false) {
    setDashboardSaveStatus('saving', 'Guardando vista local de columnas...');
  }
  const showRecursive = (col: any) => {
    const definition = col?.getDefinition?.() || {};
    const foldMeta = getFoldMeta(col);
    const children = getGroupSubColumns(col);

    if (Array.isArray(definition.columns) && children.length > 0) {
      safeShow(col);
      const headerEl = col.getElement?.();
      if (headerEl) headerEl.classList.remove('group-folded');
      children.forEach(showRecursive);
      return;
    }

    if (foldMeta.summaryOnly) {
      safeHide(col);
      return;
    }

    safeShow(col);
  };
  try { table.getColumns().forEach(showRecursive); } catch { /* ignore */ }
  try {
    if (canRedrawTable(table)) {
      table.redraw(true);
    }
  } catch { /* ignore */ }
  refreshFoldedLeafLabels(table);
  if (options?.persist !== false) {
    storeCurrentFoldState(table, 'Vista guardada: todas las columnas desplegadas.');
  }
};

const foldAllColumns = (table: Tabulator, options?: { persist?: boolean }) => {
  if (options?.persist !== false) {
    setDashboardSaveStatus('saving', 'Guardando vista local de columnas...');
  }

  const visit = (columns: any[]) => {
    (columns || []).forEach((column) => {
      const definition = column?.getDefinition?.() || {};
      const children = getGroupSubColumns(column);
      if (!Array.isArray(definition.columns) || children.length === 0) return;

      const foldMeta = getFoldMeta(column);
      if (!foldMeta?.key || foldMeta.disabled) {
        visit(children);
        return;
      }

      toggleFoldMetaGroup(column, true, { persist: false });
    });
  };

  try {
    visit(table.getColumns?.() || []);
  } catch {
    // ignore transient folding errors
  }

  try {
    if (canRedrawTable(table)) {
      table.redraw(true);
    }
  } catch {
    // ignore redraw errors during fold-all
  }

  refreshFoldedLeafLabels(table);

  if (options?.persist !== false) {
    storeCurrentFoldState(table, 'Vista guardada: todas las columnas plegadas.');
  }
};

const foldTeacherMainAllColumns = (table: Tabulator, options?: { persist?: boolean }) => {
  const columnsByKey = findFoldMetaColumnsByKey(table, TEACHER_MAIN_TOP_LEVEL_FOLD_KEYS);

  try {
    TEACHER_MAIN_TOP_LEVEL_FOLD_KEYS.forEach((key) => {
      const column = columnsByKey.get(normalizeText(key));
      if (!column) return;
      toggleFoldMetaGroup(column, true, { persist: false });
    });
  } catch {
    // ignore transient top-level folding errors
  }

  try {
    if (canRedrawTable(table)) {
      table.redraw(true);
    }
  } catch {
    // ignore redraw errors during teacher-main fold-all
  }

  refreshFoldedLeafLabels(table);

  if (options?.persist !== false) {
    storeCurrentFoldState(table, 'Vista guardada: todas las columnas plegadas.');
  }
};

const isTeacherMainFullyFolded = (table: Tabulator | null | undefined) => {
  const columnsByKey = findFoldMetaColumnsByKey(table, TEACHER_MAIN_TOP_LEVEL_FOLD_KEYS);
  if (columnsByKey.size !== TEACHER_MAIN_TOP_LEVEL_FOLD_KEYS.length) return false;

  return TEACHER_MAIN_TOP_LEVEL_FOLD_KEYS.every((key) => {
    const column = columnsByKey.get(normalizeText(key));
    const headerElement = column?.getElement?.();
    return Boolean(headerElement?.classList?.contains('group-folded'));
  });
};

const restoreStoredFoldState = (table: Tabulator) => {
  const state = readStoredFoldState(table);
  const keys = Object.keys(state);
  if (keys.length === 0) return false;

  const groupsByKey = new Map<string, { column: any; level: number }>();
  visitFoldMetaColumns(table.getColumns(), (column, foldMeta) => {
    const definition = column?.getDefinition?.() || {};
    const children = getGroupSubColumns(column);
    if (!Array.isArray(definition.columns) || children.length === 0) return;
    const key = String(foldMeta.key || '');
    if (!key) return;
    groupsByKey.set(key, {
      column,
      level: Number(foldMeta.level || 0),
    });
  });

  try {
    unfoldAllColumns(table, { persist: false });
  } catch {
    // ignore unfold races during restore
  }

  Array.from(groupsByKey.entries())
    .filter(([key]) => Boolean(state[key]))
    .sort((left, right) => left[1].level - right[1].level)
    .forEach(([, entry]) => {
      toggleFoldMetaGroup(entry.column, true, { persist: false });
    });

  try {
    if (canRedrawTable(table)) {
      table.redraw(true);
    }
  } catch {
    // ignore redraw errors during restore
  }
  refreshFoldedLeafLabels(table);

  return true;
};

const buildCellContextMenu = (
  kind: GridKind,
  meta: DashboardMeta,
  annotationState: AnnotationState,
  modalRef: { current: AnnotationModalApi | null },
) => {
  return (e: MouseEvent, cell: any) => {
    const context = buildScopeContextFromCell(cell, kind);
    if (!context) return [];

    setActiveSelection(annotationState, cell, context);
    const targets = resolveContextMenuTargetCells(cell, kind);
    const targetContexts = targets
      .map((targetCell) => buildScopeContextFromCell(targetCell, kind))
      .filter(Boolean) as CellScopeContext[];
    const count = targets.length;
    const multi = count > 1;
    const suffix = multi ? ` (${count})` : '';
    const ownAnnotation = getOwnAnnotation(annotationState, context);

    // For the "clear" disabled state, check if ANY target has a color annotation.
    const anyHasColor = targetContexts.some((ctx) =>
      Boolean(normalizeDashboardAnnotationColor(getOwnAnnotation(annotationState, ctx)?.color)));
    const anyOwnAnnotation = targetContexts.some((ctx) => Boolean(getOwnAnnotation(annotationState, ctx)?.id));

    const applyColorToAll = async (color: DashboardAnnotationColor | '') => {
      for (const ctx of targetContexts) {
        const own = getOwnAnnotation(annotationState, ctx);
        // For "clear", skip cells that have no color.
        if (color === '' && !normalizeDashboardAnnotationColor(own?.color)) continue;
        await saveAnnotation(annotationState, ctx, {
          color,
          comment: own?.comment || '',
          visibility: own?.visibility || 'teachers',
        });
      }
    };

    return [
      {
        label: `Verde (V)${suffix}`,
        action: () => applyColorToAll('green'),
      },
      {
        label: `Amarillo (B)${suffix}`,
        action: () => applyColorToAll('yellow'),
      },
      {
        label: `Rojo (N)${suffix}`,
        action: () => applyColorToAll('red'),
      },
      {
        label: `Sin resaltado (M)${suffix}`,
        disabled: !anyHasColor,
        action: () => applyColorToAll(''),
      },
      {
        separator: true,
      },
      {
        label: ownAnnotation ? 'Editar comentario' : 'Añadir comentario',
        action: () => modalRef.current?.open(context),
      },
      {
        label: `Borrar anotación${suffix}`,
        disabled: !anyOwnAnnotation,
        action: async () => {
          const annotationIds = new Set<string>();
          for (const ctx of targetContexts) {
            const own = getOwnAnnotation(annotationState, ctx);
            if (!own?.id || annotationIds.has(own.id)) continue;
            annotationIds.add(own.id);
            await removeAnnotation(annotationState, own.id);
          }
        },
      },
      {
        separator: true,
      },
      {
        label: `Title Case${suffix}`,
        action: async () => {
          for (const targetCell of targets) {
            const targetField = getCellField(targetCell);
            const current = String(targetCell.getValue() ?? '');
            const titled = toTitleCase(current);
            if (titled === current) continue;
            // For user profile fields (lastName, firstName) always save single-cell only —
            // never spread to the range. Each student has a unique name.
            if (EDITABLE_USER_FIELDS.includes(targetField)) {
              await saveSingleUserFieldCellValue(targetCell, titled, meta);
            } else {
              targetCell.setValue(titled);
              await saveUserFieldFromCell(targetCell, titled, meta);
            }
          }
        },
      },
    ];
  };
};

// Helper to get sub-columns safely, falling back to manual lookup if getColumns() fails
const resolveColumnComponent = (column: any) => {
  if (!column) return null;
  if (typeof column.getDefinition === 'function') return column;

  if (typeof column.getComponent === 'function') {
    try {
      const component = column.getComponent();
      if (component && typeof component.getDefinition === 'function') return component;
    } catch {
      // fall through
    }
  }

  if (typeof column._getSelf === 'function') {
    try {
      const self = column._getSelf();
      const component = self?.getComponent?.();
      if (component && typeof component.getDefinition === 'function') return component;
    } catch {
      // fall through
    }
  }

  const nestedComponent = column?._column?.getComponent?.();
  if (nestedComponent && typeof nestedComponent.getDefinition === 'function') {
    return nestedComponent;
  }

  return null;
};

const getGroupSubColumns = (column: any): any[] => {
  const resolvedColumn = resolveColumnComponent(column);
  const definition = resolvedColumn?.getDefinition?.() || {};
  if (!Array.isArray(definition.columns)) return [];

  let subCols: any[] = [];
  if (typeof resolvedColumn?.getSubColumns === 'function') {
    try {
      subCols = resolvedColumn.getSubColumns();
    } catch {
      // fall through
    }
  }

  if ((!subCols || subCols.length === 0) && typeof resolvedColumn?._getSelf === 'function') {
    try {
      const self = resolvedColumn._getSelf();
      const rawChildren =
        typeof self?.getSubColumns === 'function'
          ? self.getSubColumns()
          : Array.isArray(self?.columns)
            ? self.columns
            : [];
      subCols = rawChildren
        .map((child: any) => child?.getComponent?.() || child)
        .filter(Boolean);
    } catch {
      // fall through
    }
  }

  if (!subCols || subCols.length === 0) {
    const table = resolvedColumn?.getTable?.();
    if (table && Array.isArray(definition.columns)) {
      subCols = definition.columns
        .map((colDef: any) => {
          if (colDef?.field) return table.getColumn(colDef.field);
          return null;
        })
        .filter(Boolean);
    }
  }

  return Array.isArray(subCols) ? subCols : [];
};

const toggleGroupFolding = (column: any) => {
  if (!column) return;
  const foldMeta = getFoldMeta(column);
  if (foldMeta?.key) {
    toggleFoldMetaGroup(column);
    try {
      const table = column.getTable?.();
      if (canRedrawTable(table)) {
        table.redraw(true);
      }
      refreshFoldedLeafLabels(table);
    } catch {
      // ignore redraw errors during header refresh
    }
    return;
  }
  const def = column.getDefinition();
  const subCols = getGroupSubColumns(column);

  if (subCols.length === 0) {
    if (Array.isArray(def.columns)) {
      console.warn('toggleGroupFolding: No sub-columns found for group', def.title);
    }
    return;
  }

  const table = column.getTable();

  // Determine if we are currently folded. 
  // We consider it folded if any hideable column is hidden.
  const isFolded = subCols.some((c: any) => {
    const field = c.getDefinition().field;
    const isHideable = !field?.startsWith('__avg') && field !== 'lastName' && field !== 'firstName';
    return isHideable && !c.isVisible();
  });

  const targetState = isFolded; // if folded, we want to unfold (show all)

  // Find columns that MUST stay visible (avg and identity)
  const anchorCols = subCols.filter((c: any) => {
    const cDef = c.getDefinition();
    return cDef.field?.startsWith('__avg') || cDef.field === 'lastName' || cDef.field === 'firstName';
  });

  subCols.forEach((c: any) => {
    const cDef = c.getDefinition();
    const isAvg = cDef.field?.startsWith('__avg');
    const isIdentity = cDef.field === 'lastName' || cDef.field === 'firstName';
    const isAnchor = isAvg || isIdentity;
    
    if (targetState) {
      c.show();
    } else {
      // If we are folding:
      // Keep anchors visible. 
      // If there are NO anchors in this group, keep the FIRST sub-column visible as an anchor.
      if (isAnchor) {
        c.show();
      } else {
        const isFirstSubCol = c === subCols[0];
        if (anchorCols.length === 0 && isFirstSubCol) {
          c.show();
        } else {
          c.hide();
        }
      }
    }
  });

  const headerEl = column.getElement();
  if (headerEl) {
    headerEl.classList.toggle('group-folded', !targetState);
  }
  
  if (canRedrawTable(table)) {
    table.redraw(true);
  }
  refreshFoldedLeafLabels(table);
};

const configureColumns = (
  columns: any[],
  context: { kind: GridKind; meta: DashboardMeta },
  annotationState: AnnotationState,
  modalRef: { current: AnnotationModalApi | null },
): any[] => {
  const isMobileNarrow = typeof window !== 'undefined' && window.innerWidth < 500;
  // selectableRange + frozen columns = Tabulator warning + broken selection.
  // Strip frozen for range-enabled tables; horizontal scroll handles navigation.
  const isRangeTable = supportsRangeSelection(context.kind);

  const headerMenu = [
    {
      label: "Plegar/Desplegar Grupo",
      action: function (e: any, column: any) {
        toggleGroupFolding(column);
      }
    }
  ];

  return (columns || []).map((column) => {
    // Tooltips for everyone; preserve explicit headerTooltip strings from the projection
    const baseColumn = {
      ...column,
      tooltip: true,
      headerTooltip: column.headerTooltip != null ? column.headerTooltip : true,
    };

    const foldMeta = getFoldMeta(baseColumn);

    if (Array.isArray(baseColumn?.columns) && baseColumn.columns.length > 0) {
      if (foldMeta?.key) {
        return {
          ...baseColumn,
          ...(isMobileNarrow || isRangeTable ? { frozen: false } : {}),
          headerClick: function (_event: any, col: any) {
            if (foldMeta.disabled) return;
            toggleGroupFolding(col);
          },
          titleFormatter: function (col: any) {
            const isFolded = col.getElement?.()?.classList?.contains('group-folded');
            const fullLabel = String(foldMeta.fullLabel || baseColumn.title || '');
            const shortLabel = String(foldMeta.shortLabel || formatAbletonLabel(fullLabel));
            const tooltip = isFolded ? fullLabel : fullLabel;
            return `<div class="group-header-content" title="${escapeHtml(tooltip)}">
              <span class="group-header-title">${escapeHtml(isFolded ? shortLabel : fullLabel)}</span>
              <span class="group-header-icon" aria-hidden="true"></span>
            </div>`;
          },
          columns: configureColumns(baseColumn.columns, context, annotationState, modalRef),
        };
      }
      const isAttendanceMonth = String(baseColumn.cssClass || '').includes('dashboard-attendance-month-group');
      if (isAttendanceMonth) {
        return {
          ...baseColumn,
          ...(isMobileNarrow || isRangeTable ? { frozen: false } : {}),
          columns: configureColumns(baseColumn.columns, context, annotationState, modalRef),
        };
      }
      return {
        ...baseColumn,
        ...(isMobileNarrow || isRangeTable ? { frozen: false } : {}),
        headerContextMenu: headerMenu,
        headerClick: function(e: any, col: any) {
          const def = col.getDefinition();
          if (!Array.isArray(def.columns)) return;

          const rect = col.getElement().getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const isRightEdge = clickX > rect.width - 35;
          
          if (isRightEdge) {
            e.preventDefault();
            e.stopPropagation();
            toggleGroupFolding(col);
          }
        },
        titleFormatter: function(col: any) {
          const title = col.getValue();
          return `<div class="group-header-content" title="${title}">
            <span class="group-header-title">${title}</span>
            <span class="group-header-icon" title="Plegar/Desplegar"></span>
          </div>`;
        },
        columns: configureColumns(baseColumn.columns, context, annotationState, modalRef),
      };
    }

    const {
      kind,
      dateKey: _dateKey,
      ...restColumn
    } = baseColumn || {};
    const fieldName = normalizeText(restColumn?.field || '');
    const isCompactGradeMetaField =
      ['teacher-main', 'gradebook'].includes(context.kind)
      && ['average', 'conceptValue', 'finalGrade'].includes(fieldName);
    const nextColumn: Record<string, any> = {
      ...restColumn,
      ...(isMobileNarrow || isRangeTable ? { frozen: false } : {}),
    };
    if (kind || _dateKey) {
      nextColumn.formatterParams = {
        ...(restColumn?.formatterParams || {}),
        __dashboardMeta: {
          ...((restColumn?.formatterParams && typeof restColumn.formatterParams === 'object')
            ? restColumn.formatterParams.__dashboardMeta || {}
            : {}),
          ...(kind ? { kind } : {}),
          ...(_dateKey ? { dateKey: _dateKey } : {}),
        },
      };
    }

    if (foldMeta?.key) {
      nextColumn.titleFormatter = (col: any) => {
        const fullLabel = String(foldMeta.fullLabel || col.getValue() || '');
        const shortLabel = String(foldMeta.shortLabel || formatAbletonLabel(fullLabel));
        const useShort = Boolean(foldMeta.summaryOnly) || shouldUseShortLeafLabel(col);
        const label = useShort ? shortLabel : fullLabel;
        const tooltip = useShort ? fullLabel : fullLabel;
        return `<span class="fold-header-label" title="${escapeHtml(tooltip)}">${escapeHtml(label)}</span>`;
      };
    }

    if (kind === 'grade-score') {
      nextColumn.headerVertical = 'flip';
      nextColumn.width = 32;
      nextColumn.minWidth = 30;
      nextColumn.resizable = nextColumn.resizable !== false;

      if (context.kind === 'gradebook' && !foldMeta?.key) {
        nextColumn.titleFormatter = (col: any) =>
          `<div class="gradebook-eval-col-title">${escapeHtml(String(col.getValue() || ''))}</div>`;
      }
    }

    if (
      ['teacher-main', 'gradebook'].includes(context.kind)
      && (kind === 'score' || kind === 'concepto' || kind === 'final-grade')
    ) {
      nextColumn.headerVertical = 'flip';
    }

    if (isCompactGradeMetaField) {
      nextColumn.headerVertical = false;
      nextColumn.width = 32;
      nextColumn.minWidth = 30;
      nextColumn.headerHozAlign = 'center';
      nextColumn.cssClass = appendCssClass(nextColumn.cssClass, 'dashboard-grade-meta-compact');
      nextColumn.resizable = nextColumn.resizable !== false;
    }

    if (context.kind === 'gradebook') {
      if (kind === 'score') {
        // Pg / Pc / Prom. — keep their own widths from the projection; only style the label.
        nextColumn.titleFormatter = (col: any) =>
          `<div class="gradebook-eval-col-title">${escapeHtml(col.getValue())}</div>`;
      } else if (kind === 'concepto' || kind === 'final-grade') {
        nextColumn.titleFormatter = (col: any) =>
          `<div class="gradebook-eval-col-title">${escapeHtml(col.getValue())}</div>`;
      }
    }

    if (isCompactGradeMetaField) {
      nextColumn.titleFormatter = (col: any) => {
        const fullLabel = String(foldMeta?.fullLabel || col.getValue() || '');
        const shortLabel = String(foldMeta?.shortLabel || formatAbletonLabel(fullLabel) || fullLabel);
        const useShort = Boolean(foldMeta?.summaryOnly) || shouldUseShortLeafLabel(col);
        const label = useShort ? shortLabel : fullLabel;
        return `<div class="dashboard-grade-meta-title" title="${escapeHtml(fullLabel)}"><span class="dashboard-grade-meta-title__label">${escapeHtml(label)}</span></div>`;
      };
    }

    let baseFormatter: ((cell: any) => string) | null = renderPlainMarkup;

    if (kind === 'risk') {
      baseFormatter = renderRiskMarkup;
    } else if (kind === 'score') {
      nextColumn.sorter = 'number';
      baseFormatter = renderScoreMarkup;
    } else if (kind === 'grade-score') {
      // Custom sorter: numeric scores sort numerically; '✓' sorts after scores; null/empty sorts last
      nextColumn.sorter = (a: any, b: any) => {
        const na = Number(a);
        const nb = Number(b);
        const aEmpty = a === null || a === undefined || a === '';
        const bEmpty = b === null || b === undefined || b === '';
        if (aEmpty && bEmpty) return 0;
        if (aEmpty) return 1;
        if (bEmpty) return -1;
        const aNum = !Number.isNaN(na);
        const bNum = !Number.isNaN(nb);
        if (aNum && bNum) return na - nb;
        if (aNum) return -1; // numbers before symbols
        if (bNum) return 1;
        return String(a).localeCompare(String(b));
      };
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
    } else if (kind === 'attendance-day' && ['attendance-summary', 'teacher-main'].includes(context.kind)) {
      nextColumn.editor = 'input';
      nextColumn.headerSort = false;
      baseFormatter = renderAttendanceMarkup;
      nextColumn.titleFormatter = (cell: any) => {
        const title = String(cell.getValue() || '');
        const field = String(cell.getColumn?.()?.getField?.() || '');
        return `<span class="dashboard-attendance-day-header-title">${title}</span><button class="dashboard-attendance-fill-btn" data-action="fill-present" data-field="${field}" title="Completar columna con presente" type="button" tabindex="-1"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" width="11" height="11"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg></button>`;
      };
    } else if (kind === 'annotation-color') {
      baseFormatter = annotationColorFormatter;
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
    } else if (kind === 'role') {
      baseFormatter = roleFormatter;
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
    } else if (kind === 'row-select') {
      nextColumn.cssClass = appendCssClass(nextColumn.cssClass, 'dashboard-admin-row-select');
      nextColumn.formatter = 'rowSelection';
      nextColumn.titleFormatter = 'rowSelection';
      nextColumn.titleFormatterParams = { rowRange: 'active' };
      baseFormatter = null;
      nextColumn.cellClick = (_event: MouseEvent, cell: any) => {
        cell?.getRow?.()?.toggleSelect?.();
      };
      nextColumn.headerSort = false;
      nextColumn.resizable = false;
      nextColumn.download = false;
      nextColumn.clipboard = false;
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
    } else if (kind === 'course-role') {
      baseFormatter = roleFormatter;
      nextColumn.cssClass = appendCssClass(nextColumn.cssClass, 'dashboard-cell--editable', 'dashboard-cell--editable--course-role');
      nextColumn.editor = 'list';
      nextColumn.editorParams = {
        values: {
          student: 'Student',
          teacher: 'Teacher',
        },
        autocomplete: false,
        clearable: false,
        maxWidth: true,
        verticalNavigation: 'table',
      };
      nextColumn.editable = (cell: any) =>
        Boolean(normalizeText(cell?.getRow?.()?.getData?.()?.enrollmentId || cell?.getData?.()?.enrollmentId || ''));
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
      nextColumn.headerSort = false;
    } else if (kind === 'turno') {
      baseFormatter = renderPlainMarkup;
      nextColumn.cssClass = appendCssClass(nextColumn.cssClass, 'dashboard-cell--editable', 'dashboard-cell--editable--turno');
      nextColumn.editor = 'list';
      nextColumn.editorParams = {
        values: ['M', 'T', 'N'],
        autocomplete: false,
        clearable: false,
        maxWidth: true,
        verticalNavigation: 'table',
      };
      nextColumn.editable = () => Boolean(context.meta?.courseId && context.meta?.year);
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
    } else if (kind === 'concepto') {
      baseFormatter = renderPlainMarkup;
      nextColumn.cssClass = appendCssClass(nextColumn.cssClass, 'dashboard-cell--editable', 'dashboard-cell--editable--concepto');
      nextColumn.editor = 'input';
      nextColumn.editorParams = {
        selectContents: true,
        elementAttributes: {
          class: 'dashboard-native-editor dashboard-native-editor--concepto',
          inputmode: 'decimal',
        },
      };
      nextColumn.editable = () => Boolean(context.meta?.courseId && context.meta?.year);
    } else if (kind === 'notes') {
      baseFormatter = renderPlainMarkup;
      nextColumn.cssClass = appendCssClass(nextColumn.cssClass, 'dashboard-cell--editable', 'dashboard-cell--editable--notes');
      nextColumn.editor = 'input';
      nextColumn.editorParams = {
        selectContents: true,
        elementAttributes: {
          class: 'dashboard-native-editor dashboard-native-editor--notes',
          maxlength: '280',
        },
      };
      nextColumn.editable = () => Boolean(context.meta?.courseId && context.meta?.year);
    } else if (kind === 'final-grade') {
      baseFormatter = renderPlainMarkup;
      nextColumn.cssClass = appendCssClass(nextColumn.cssClass, 'dashboard-cell--editable', 'dashboard-cell--editable--final-grade');
      nextColumn.editor = 'input';
      nextColumn.editorParams = {
        selectContents: true,
        elementAttributes: {
          class: 'dashboard-native-editor dashboard-native-editor--final-grade',
          inputmode: 'decimal',
        },
      };
      nextColumn.editable = () => Boolean(context.meta?.courseId && context.meta?.year);
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
    } else if (kind === 'grupo') {
      baseFormatter = renderPlainMarkup;
      nextColumn.cssClass = appendCssClass(nextColumn.cssClass, 'dashboard-cell--editable', 'dashboard-cell--editable--grupo');
      nextColumn.editor = 'input';
      nextColumn.editorParams = {
        selectContents: true,
        elementAttributes: {
          class: 'dashboard-native-editor dashboard-native-editor--grupo',
          inputmode: 'numeric',
        },
      };
      nextColumn.editable = () => Boolean(context.meta?.courseId && context.meta?.year);
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
    } else if (kind === 'enrollment-courses') {
      baseFormatter = renderEnrollmentCoursesMarkup;
      nextColumn.headerSort = false;
    } else if (kind === 'admin-actions') {
      baseFormatter = renderAdminActionsMarkup;
      nextColumn.headerHozAlign = nextColumn.headerHozAlign || 'center';
      nextColumn.hozAlign = nextColumn.hozAlign || 'center';
      nextColumn.headerSort = false;
    } else if (kind === 'editable-text') {
      nextColumn.editor = 'input';
      // Always editable. With editTriggerEvent:'dblclick' (range tables), Tabulator
      // natively opens the editor on double-click — no need for the custom cellDblClick
      // handler. The custom handler skips editable-text to avoid a double-open race.
      nextColumn.editable = true;
      nextColumn.editorParams = { selectContents: true };
      nextColumn.cssClass = appendCssClass(nextColumn.cssClass, 'dashboard-cell--editable');
    }

    const isAnnotationCell = isAnnotationContextKind(context.kind) && normalizeText(nextColumn.field);
    const keepAnnotationWrapper = isAnnotationCell && !isNativeDashboardEditableKind(kind);

    if (isAnnotationCell) {
      nextColumn.contextMenu = buildCellContextMenu(context.kind, context.meta, annotationState, modalRef);
    }

    if (keepAnnotationWrapper) {
      nextColumn.formatter = (cell: any) =>
        buildCellMarkup(cell, context.kind, annotationState, baseFormatter || renderPlainMarkup);
    } else if (baseFormatter) {
      nextColumn.formatter = baseFormatter;
    }

    return nextColumn;
  });
};

const installGlobalSearch = (
  tables: Tabulator[],
  input: HTMLInputElement,
  persistKey: string,
  options?: {
    hideAbandonedButton?: HTMLButtonElement | null;
  },
) => {
  const filterState = {
    query: normalizeTextLower(getStoredSearchQuery(persistKey)),
    hideAbandoned: Boolean(options?.hideAbandonedButton),
    hideAbandonedActive: false,
  };
  const initializedTables = new WeakSet<Tabulator>();
  const filterFn = (data: any) => {
    if (filterState.hideAbandoned && filterState.hideAbandonedActive && isAbandonedDashboardRow(data)) {
      return false;
    }
    if (!filterState.query) return true;
    return String(data?.__search || '').includes(filterState.query);
  };
  const filterWrapper = (data: any) => filterFn(data);

  const applyTableFilter = (table: Tabulator) => {
    if (!filterState.query && !(filterState.hideAbandoned && filterState.hideAbandonedActive)) {
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

  const hideAbandonedButton = options?.hideAbandonedButton;
  if (hideAbandonedButton && hideAbandonedButton.dataset.bound !== 'true') {
    hideAbandonedButton.dataset.bound = 'true';
    const syncButton = () => {
      hideAbandonedButton.classList.toggle('is-active', filterState.hideAbandonedActive);
      hideAbandonedButton.setAttribute('aria-pressed', filterState.hideAbandonedActive ? 'true' : 'false');
    };
    syncButton();
    hideAbandonedButton.addEventListener('click', () => {
      filterState.hideAbandonedActive = !filterState.hideAbandonedActive;
      syncButton();
      tables.forEach((table) => {
        if (!initializedTables.has(table)) return;
        applyTableFilter(table);
      });
    });
  }

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
  const isComplexTable = context.kind === 'gradebook' || context.kind === 'attendance-summary';
  const isRangeTable = supportsRangeSelection(context.kind);
  const fillPanelHeight = ['teacher-main', 'overview', 'gradebook', 'attendance-summary', 'admin'].includes(context.kind);
  const maxHeight =
    context.kind === 'comments'
      ? '34vh'
      : context.kind === 'attendance-log'
        ? '50vh'
        : false;
  element.dataset.rangeSelection = isRangeTable ? 'true' : 'false';
    const table = new Tabulator(element, {
    index: 'id',
    data: Array.isArray(projection?.rows) ? projection.rows : [],
    columns: configureColumns(Array.isArray(projection?.columns) ? projection.columns : [], context, annotationState, modalRef),
    layout:
      context.kind === 'teacher-main'
        ? 'fitDataTable'
        : context.kind === 'gradebook'
          ? 'fitDataTable'
          : 'fitColumns',
    // dblclick recommended by Tabulator docs when selectableRange is enabled,
    // to prevent editors from triggering on every range-start click.
    editTriggerEvent: isRangeTable ? 'dblclick' : 'focus',
    columnHeaderVertAlign: 'center',
    ...(fillPanelHeight ? { height: '100%' } : {}),
    ...(!fillPanelHeight && maxHeight ? { maxHeight } : {}),
    movableColumns: !isComplexTable,
    headerSort: !isComplexTable,
    resizableColumnFit: false,
    selectableRows: context.kind === 'admin',
    // Native Tabulator range selection (SelectRange module, included in TabulatorFull).
    selectableRange: isRangeTable ? true : false,
    selectableRangeAutoFocus: false,
    clipboard: isRangeTable ? true : false,
    clipboardCopyRowRange: isRangeTable ? 'range' : 'active',
    clipboardPasteParser: isRangeTable ? 'range' : false,
    clipboardPasteAction: isRangeTable
      ? function (this: any, rowData: Record<string, any>[]) {
        return applyRangeClipboardPaste(this.table, rowData, context.meta);
      }
      : false,
    clipboardCopyConfig: isRangeTable
      ? {
        rowHeaders: false,
        columnHeaders: false,
      }
      : {},
    clipboardCopyStyled: false,
    placeholder: projection?.emptyMessage || 'Sin datos.',
    persistence: {
      sort: true,
      columns: ['title', 'width', 'visible'],
    },
    persistenceMode: 'local',
    persistenceID: persistKey,
    popupContainer: root,
    rowHeight:
      context.kind === 'teacher-main' || context.kind === 'attendance-summary'
        ? 27
        : 38,
    ...(context.kind === 'teacher-main'
      ? {
        rowFormatter: (row: any) => {
          applyTeacherMainRowState(row);
        },
      }
      : {}),
  });

  (table as DashboardTabulatorInstance).__musikiFoldStorageKey = buildFoldStorageKey(persistKey);

  return table;
};

const foldTeacherMainGroupsByDefault = (table: Tabulator) => {
  try {
    const storedState = readStoredFoldState(table);
    if (Object.keys(storedState).length > 0) return;
    foldTeacherMainAllColumns(table, { persist: false });
    writeStoredFoldState(table, snapshotCurrentFoldState(table));
  } catch {
    // ignore startup folding races
  }
};

const bindFoldAllButtons = (root: HTMLElement, registry: Map<string, Tabulator>) => {
  root.querySelectorAll<HTMLButtonElement>('[data-dashboard-fold-all]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      const key = normalizeText(button.getAttribute('data-dashboard-fold-all'));
      const table = registry.get(key);
      if (!table) return;
      if (key === 'teacher-main') {
        foldTeacherMainAllColumns(table);
      } else {
        foldAllColumns(table);
      }
    });
  });
};

const bindUnfoldAllButtons = (root: HTMLElement, registry: Map<string, Tabulator>) => {
  root.querySelectorAll<HTMLButtonElement>('[data-dashboard-unfold-all]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      const key = normalizeText(button.getAttribute('data-dashboard-unfold-all'));
      const table = registry.get(key);
      if (!table) return;
      unfoldAllColumns(table);
    });
  });
};

const trackTableBuilt = (table: Tabulator, readyTables: WeakSet<Tabulator>) => {
  table.on('tableBuilt', () => {
    (table as DashboardTabulatorInstance).__musikiTableBuilt = true;
    readyTables.add(table);
  });
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
  const applyBtn = panel.querySelector('[data-attendance-config-apply]');
  if (
    !(startInput instanceof HTMLInputElement) ||
    !(endInput instanceof HTMLInputElement)
  ) {
    return;
  }

  const applyConfig = async () => {
    const courseId = normalizeText(panel.getAttribute('data-course-id'));
    const year = normalizeText(panel.getAttribute('data-year'));
    if (!courseId || !year) return;

    if (applyBtn instanceof HTMLButtonElement) applyBtn.disabled = true;
    startInput.disabled = true;
    endInput.disabled = true;
    showToast('Guardando rango…', 'loading');

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

      if (!response.ok) throw new Error('No se pudo guardar la configuración');

      showToast('Rango guardado — recargando grilla…', 'success');
      setTimeout(() => window.location.reload(), 1200);
    } catch (error: any) {
      console.error('Error saving attendance config:', error);
      showToast(error?.message || 'Error al guardar la configuración', 'error', 4000);
      if (applyBtn instanceof HTMLButtonElement) applyBtn.disabled = false;
      startInput.disabled = false;
      endInput.disabled = false;
    }
  };

  if (applyBtn instanceof HTMLButtonElement) {
    applyBtn.addEventListener('click', applyConfig);
  }
  // Also allow Enter key in either date input to apply
  const onEnter = (e: KeyboardEvent) => { if (e.key === 'Enter') applyConfig(); };
  startInput.addEventListener('keydown', onEnter);
  endInput.addEventListener('keydown', onEnter);
};

const resolveDashboardShell = (root: HTMLElement) =>
  root.closest<HTMLElement>('.dashboard-shell') || document.body;

const buildCsvFilename = (key: string, meta: DashboardMeta) => {
  const course = normalizeText(meta?.courseId || 'curso').replace(/[^a-zA-Z0-9_-]+/g, '-');
  const year = normalizeText(meta?.year || 'year').replace(/[^a-zA-Z0-9_-]+/g, '-');
  switch (key) {
    case 'teacher-main':
      return `musiki-dashboard-main-${course}-${year}.csv`;
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

const parseStudentListText = (text: string): Array<{ name: string; email: string }> => {
  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      // Try tab split first; fall back to 2+ spaces (some browsers/systems paste with spaces)
      let parts = line.split(/\t/);
      if (parts.length < 5) parts = line.split(/\s{2,}/);
      if (parts.length < 5) return [];
      // Only include "Aceptada" rows (col 2)
      if (normalizeText(parts[2]).toLowerCase() !== 'aceptada') return [];
      const rawName = normalizeText(parts[1] || '');
      const email = normalizeText(parts[4] || '').toLowerCase();
      if (!rawName || !email || !email.includes('@')) return [];
      // Deduplicate by email
      if (seen.has(email)) return [];
      seen.add(email);
      const [rawApellido, ...rawNombreParts] = rawName.split(',').map((s) => s.trim()).filter(Boolean);
      const apellido = toTitleCase(rawApellido || '');
      const nombre = toTitleCase(rawNombreParts.join(' ').replace(/\s+/g, ' ').trim());
      const name = apellido && nombre
        ? `${apellido}, ${nombre}`
        : toTitleCase(rawName);
      return [{ name, email }];
    });
};

// Keep old name as alias for backward compat
const parseClipboardStudentList = parseStudentListText;

const bindImportClipboardButton = (root: HTMLElement, meta: DashboardMeta) => {
  root.querySelectorAll('[data-dashboard-import-clipboard]').forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';

    button.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
          alert('El portapapeles está vacío.');
          return;
        }
        const students = parseClipboardStudentList(text);
        if (students.length === 0) {
          showToast('No se encontraron estudiantes válidos en el portapapeles.', 'error', 4000);
          return;
        }
        const turno = await pickTurno();
        if (!turno) return;

        const confirmed = confirm(`Se importarán ${students.length} estudiante${students.length !== 1 ? 's' : ''} (turno ${turno === 'M' ? 'Mañana' : turno === 'T' ? 'Tarde' : 'Noche'}). ¿Continuar?`);
        if (!confirmed) return;

        button.disabled = true;
        showToast(`Importando ${students.length} estudiante${students.length !== 1 ? 's' : ''}…`, 'loading');

        const response = await fetch('/api/admin/import-students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId: meta.courseId, turno, students }),
        });

        const result = await response.json();
        if (!response.ok) {
          showToast(`Error: ${result.error || 'Error desconocido'}`, 'error', 5000);
          button.disabled = false;
        } else {
          const msg = `✓ ${result.enrolled} inscripto${result.enrolled !== 1 ? 's' : ''}${result.alreadyEnrolled ? `, ${result.alreadyEnrolled} ya inscripto${result.alreadyEnrolled !== 1 ? 's' : ''}` : ''}${result.errors ? `, ${result.errors} error${result.errors !== 1 ? 'es' : ''}` : ''}`;
          showToast(msg, 'success', 4000);
          setTimeout(() => window.location.reload(), 1200);
        }
      } catch {
        showToast('No se pudo acceder al portapapeles.', 'error', 4000);
        button.disabled = false;
      }
    });
  });
};

const bindImportCsvButton = (root: HTMLElement, meta: DashboardMeta) => {
  root.querySelectorAll<HTMLButtonElement>('[data-dashboard-import-csv]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';

    const fileInput = root.querySelector<HTMLInputElement>('[data-dashboard-import-csv-input]');
    if (!fileInput) return;

    button.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      fileInput.value = '';
      const text = await file.text();
      if (!text.trim()) { showToast('El archivo está vacío.', 'error', 3000); return; }
      const students = parseStudentListText(text);
      if (students.length === 0) {
        showToast('No se encontraron estudiantes válidos en el archivo.', 'error', 4000);
        return;
      }
      const turno = await pickTurno();
      if (!turno) return;

      const confirmed = confirm(`Se importarán ${students.length} estudiante${students.length !== 1 ? 's' : ''} (turno ${turno === 'M' ? 'Mañana' : turno === 'T' ? 'Tarde' : 'Noche'}) desde el archivo. ¿Continuar?`);
      if (!confirmed) return;
      button.disabled = true;
      showToast(`Importando ${students.length} estudiante${students.length !== 1 ? 's' : ''}…`, 'loading');
      try {
        const response = await fetch('/api/admin/import-students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId: meta.courseId, turno, students }),
        });
        const result = await response.json();
        if (!response.ok) {
          showToast(`Error: ${result.error || 'Error desconocido'}`, 'error', 5000);
          button.disabled = false;
        } else {
          const msg = `✓ ${result.enrolled} inscripto${result.enrolled !== 1 ? 's' : ''}${result.alreadyEnrolled ? `, ${result.alreadyEnrolled} ya inscripto${result.alreadyEnrolled !== 1 ? 's' : ''}` : ''}${result.errors ? `, ${result.errors} error${result.errors !== 1 ? 'es' : ''}` : ''}`;
          showToast(msg, 'success', 4000);
          setTimeout(() => window.location.reload(), 1200);
        }
      } catch {
        showToast('Error al leer el archivo.', 'error', 4000);
        button.disabled = false;
      }
    });
  });
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

const bindFillEmptyPresentButton = (root: HTMLElement, registry: Map<string, Tabulator>, meta: DashboardMeta) => {
  root.querySelectorAll<HTMLButtonElement>('[data-dashboard-fill-empty-present]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', async () => {
      const table = registry.get('teacher-main');
      if (!table) return;

      // Determine active column from musiki range selection state
      const rangeState: RangeSelectionState | undefined = (table as any).__musikiRangeSelectionState;
      const selectedCells: any[] = Array.from(rangeState?.selectedCells || []);
      const attendanceFields = [...new Set(
        selectedCells
          .map((c: any) => c.getColumn?.()?.getField?.() as string | undefined)
          .filter((f): f is string => typeof f === 'string' && f.startsWith('attendance.')),
      )];

      if (attendanceFields.length === 0) {
        alert('Seleccioná una celda o rango en una columna de asistencia primero.');
        return;
      }

      const rows = table.getRows('active');
      const present = normalizeAttendanceInput('1');
      const failures: string[] = [];

      for (const field of attendanceFields) {
        for (const row of rows) {
          const cell = row.getCell(field);
          if (!cell) continue;
          const context = resolvePersistableAttendanceCellContext(cell, meta);
          if (!context) continue;
          // Only fill truly empty cells (no manual override, no live data)
          const cellMeta = context.cellMeta;
          if (cellMeta?.hasManualOverride || Number(cellMeta?.liveValue || 0) > 0) continue;
          try {
            await persistSingleAttendanceCellValue(cell, present, meta);
          } catch (error: any) {
            failures.push(error?.message || `Fila ${context.studentId}`);
          }
        }
      }

      if (failures.length > 0) {
        alert(`Se completaron las celdas vacías, pero fallaron ${failures.length}.`);
      }
    });
  });
};

const bindAddStudentModal = (root: HTMLElement, meta: DashboardMeta) => {
  const triggerBtn = root.querySelector<HTMLButtonElement>('[data-dashboard-add-student]');
  // Dialog lives outside root (sibling in DOM), search document-wide
  const dialog = document.querySelector<HTMLDialogElement>('[data-add-student-dialog]');
  const form = document.querySelector<HTMLFormElement>('[data-add-student-form]');
  const errorEl = document.querySelector<HTMLElement>('[data-add-student-error]');
  if (!triggerBtn || !dialog || !form) return;

  const showError = (msg: string) => {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  };
  const clearError = () => { if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; } };

  const openModal = () => {
    form.reset();
    clearError();
    dialog.showModal();
    (form.querySelector<HTMLInputElement>('[name="lastName"]'))?.focus();
  };

  const closeModal = () => { dialog.close(); };

  triggerBtn.addEventListener('click', openModal);
  dialog.querySelector('[data-add-student-close]')?.addEventListener('click', closeModal);
  dialog.querySelector('[data-add-student-cancel]')?.addEventListener('click', closeModal);

  // Close on backdrop click
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeModal(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const data = new FormData(form);
    const lastName = normalizeText(data.get('lastName'));
    const firstName = normalizeText(data.get('firstName'));
    const email = normalizeText(data.get('email')).toLowerCase();
    const turno = normalizeText(data.get('turno'));
    const grupo = normalizeText(data.get('grupo'));

    if (!lastName && !firstName) { showError('Ingresá al menos apellido o nombre.'); return; }
    if (!email || !email.includes('@')) { showError('Email inválido.'); return; }

    const submitBtn = form.querySelector<HTMLButtonElement>('[data-add-student-submit]');
    const originalText = submitBtn?.textContent ?? 'Agregar';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Agregando...'; }

    try {
      const response = await fetch('/api/admin/add-student-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: meta.courseId, year: meta.year, firstName, lastName, email, turno, grupo }),
      });
      const result = await response.json();
      if (!response.ok) {
        showError(result.error || 'Error desconocido.');
      } else {
        const statusMap: Record<string, string> = {
          enrolled: 'Estudiante inscripto correctamente.',
          already_enrolled: 'El estudiante ya estaba inscripto.',
        };
        closeModal();
        showToast(statusMap[result.status] ?? 'Operación completada.', 'success', 3500);
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch {
      showError('Error de red. Intentá de nuevo.');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
    }
  });
};

const bindAdminDeleteSelectedButton = (root: HTMLElement, table: Tabulator, meta: DashboardMeta) => {
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-dashboard-admin-delete-selected]'),
  );
  if (!buttons.length) return () => {};

  const syncButtons = () => {
    if (!(table as DashboardTabulatorInstance).__musikiTableBuilt) return;
    const selectedRows = Array.isArray(table.getSelectedRows?.()) ? table.getSelectedRows() : [];
    const count = selectedRows.length;
    buttons.forEach((button) => {
      button.disabled = count === 0;
      button.dataset.count = String(count);
      button.title = count > 0
        ? `Borrar ${count} usuario${count !== 1 ? 's' : ''} seleccionado${count !== 1 ? 's' : ''}.`
        : 'Seleccioná usuarios con los checkboxes para borrarlos.';
      button.setAttribute(
        'aria-label',
        count > 0
          ? `Borrar ${count} usuarios seleccionados`
          : 'Borrar usuarios seleccionados',
      );
    });
  };

  const clickHandler = async (event: Event) => {
    const button = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
    const selectedRows = Array.isArray(table.getSelectedRows?.()) ? table.getSelectedRows() : [];
    const selectedUsers = collectAdminUsersFromRows(selectedRows);
    if (!selectedUsers.length) return;
    await deleteAdminUsers(table, meta, selectedUsers, button);
  };

  buttons.forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', clickHandler);
  });

  table.on('rowSelectionChanged', syncButtons);
  table.on('tableBuilt', syncButtons);

  return () => {
    buttons.forEach((button) => {
      button.removeEventListener('click', clickHandler);
    });
    try {
      table.off('rowSelectionChanged', syncButtons);
      table.off('tableBuilt', syncButtons);
    } catch {
      // ignore teardown races
    }
  };
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
    const nextTab = VALID_TEACHER_TABS.includes(tabName) ? tabName : 'main';
    root.dataset.activeTeacherTab = nextTab;
    tabs.forEach((tab) => {
      tab.classList.toggle('active', normalizeText(tab.dataset.dashboardTab) === nextTab);
    });
    shell.querySelectorAll<HTMLElement>('[data-dashboard-topbar-context]').forEach((node) => {
      const targetTab = normalizeText(node.dataset.dashboardTopbarContext);
      node.hidden = targetTab !== nextTab;
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

const bindLiveModeToggle = (
  shell: ParentNode,
  realtimeSync: RealtimeProjectionSyncController,
) => {
  const button = shell.querySelector('[data-dashboard-live-mode-toggle]');
  const indicator = shell.querySelector('[data-dashboard-live-mode-indicator]');
  if (!(button instanceof HTMLButtonElement)) {
    realtimeSync.setEnabled(getStoredLiveModePreference());
    return () => {};
  }

  const syncButtonState = () => {
    const enabled = realtimeSync.isEnabled();
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.classList.toggle('dashboard-grid-btn--primary', enabled);
    button.classList.toggle('is-active', enabled);
    button.dataset.liveMode = enabled ? 'true' : 'false';
    button.setAttribute('aria-label', enabled ? 'Live mode activado' : 'Live mode desactivado');
    button.title = enabled
      ? 'Live mode activado. Escucha cambios de la base y refresca el dashboard automaticamente.'
      : 'Live mode desactivado. El dashboard solo se actualiza al recargar o cambiar curso, año o rango.';

    if (indicator instanceof HTMLElement) {
      indicator.dataset.state = enabled ? 'on' : 'off';
      indicator.title = button.title;
    }
  };

  const handleClick = () => {
    const nextEnabled = !realtimeSync.isEnabled();
    realtimeSync.setEnabled(nextEnabled);
    setStoredLiveModePreference(nextEnabled);
    syncButtonState();
  };

  realtimeSync.setEnabled(getStoredLiveModePreference());
  syncButtonState();

  button.addEventListener('click', handleClick);

  return () => {
    button.removeEventListener('click', handleClick);
  };
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

  refreshAnnotationViews(state, context.tab);
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

    const selectedContexts = resolveSelectedAnnotationContexts(state, currentContext);
    const selectedCount = selectedContexts.length;
    const batchMode = selectedCount > 1;
    const ownAnnotation = getOwnAnnotation(state, currentContext);
    const visibleAnnotation = getDisplayAnnotation(state, currentContext);

    metaNode.textContent = batchMode
      ? `${currentContext.rowLabel} / ${currentContext.columnLabel} · ${selectedCount} celdas`
      : `${currentContext.rowLabel} / ${currentContext.columnLabel}`;
    visibleNode.textContent =
      batchMode
        ? `Se aplicará a ${selectedCount} celdas seleccionadas. Shortcut: ${getCommentShortcutLabel()}`
        : visibleAnnotation && visibleAnnotation.authorUserId !== ownAnnotation?.authorUserId
        ? `Visible ahora: ${visibleAnnotation.authorName || visibleAnnotation.authorEmail || 'Teacher'} · ${dashboardAnnotationVisibilityLabel(visibleAnnotation.visibility)}`
        : `Shortcut: ${getCommentShortcutLabel()}`;

    commentInput.value = ownAnnotation?.comment || '';
    colorSelect.value = ownAnnotation?.color || '';
    visibilitySelect.value = ownAnnotation?.visibility || 'teachers';
    deleteButton.disabled = !selectedContexts.some((selectedContext) => Boolean(getOwnAnnotation(state, selectedContext)?.id));

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
      const selectedContexts = resolveSelectedAnnotationContexts(state, currentContext);
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
      alert(error?.message || 'No se pudo guardar la anotación');
    } finally {
      saveButton.disabled = false;
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (!currentContext) return;
    const selectedContexts = resolveSelectedAnnotationContexts(state, currentContext);
    const ownAnnotationsById = new Map<string, DashboardAnnotationRecord>();
    selectedContexts.forEach((selectedContext) => {
      const annotation = getOwnAnnotation(state, selectedContext);
      if (!annotation?.id) return;
      ownAnnotationsById.set(annotation.id, annotation);
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

    if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === 'a') {
      const target = event.target as HTMLElement | null;
      if (
        !target || (
          !(target instanceof HTMLInputElement)
          && !(target instanceof HTMLTextAreaElement)
          && !(target instanceof HTMLSelectElement)
          && !(target?.isContentEditable)
        )
      ) {
        event.preventDefault();
        const hud = document.getElementById('dashboard-shortcuts-hud');
        if (hud) hud.hidden = !hud.hidden;
        return;
      }
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === 'f') {
      const target = event.target as HTMLElement | null;
      if (
        !target || (
          !(target instanceof HTMLInputElement)
          && !(target instanceof HTMLTextAreaElement)
          && !(target instanceof HTMLSelectElement)
          && !(target?.isContentEditable)
        )
      ) {
        const teacherMainTable = state.registry.get('teacher-main');
        if (teacherMainTable) {
          event.preventDefault();
          event.stopPropagation();
          if (isTeacherMainFullyFolded(teacherMainTable)) {
            unfoldAllColumns(teacherMainTable);
          } else {
            foldTeacherMainAllColumns(teacherMainTable);
          }
          return;
        }
      }
    }
    
    const isVBNM = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && ['v', 'b', 'n', 'm'].includes(key);
    const isC = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === 'c';
    const isChordM = (event.metaKey || event.ctrlKey) && event.altKey && key === 'm';
    const isFallbackEnter =
      !event.metaKey
      && !event.ctrlKey
      && !event.altKey
      && !event.shiftKey
      && key === 'enter';
    const isCommentShortcut = isChordM || isFallbackEnter;

    const target = event.target as HTMLElement | null;
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || target?.isContentEditable
    ) {
      return;
    }

    if (isVBNM && state.selectedContext) {
      event.preventDefault();
      event.stopPropagation();
      let color: DashboardAnnotationColor | '' = '';
      if (key === 'v') color = 'green';
      else if (key === 'b') color = 'yellow';
      else if (key === 'n') color = 'red';
      else if (key === 'm') color = '';

      const targetContexts = resolveSelectedAnnotationContexts(state, state.selectedContext);
      void (async () => {
        for (const targetContext of targetContexts) {
          const own = getOwnAnnotation(state, targetContext);
          await saveAnnotation(state, targetContext, {
            color,
            comment: own?.comment || '',
            visibility: own?.visibility || 'teachers',
          });
        }
      })();
      return;
    }

    if (isC && state.selectedContext) {
      event.preventDefault();
      event.stopPropagation();
      const table = state.registry.get(state.selectedContext.tab);
      if (table) {
        const column = table.getColumn(state.selectedContext.field);
        if (column && typeof column.toggle === 'function') {
           column.toggle();
        }
      }
      return;
    }

    if (isCommentShortcut && state.selectedContext) {
      event.preventDefault();
      modalRef.current?.open(state.selectedContext);
    }
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

const supportsRangeSelection = (kind: GridKind) =>
  ['teacher-main', 'overview', 'gradebook', 'attendance-summary'].includes(kind);

const isInteractiveDashboardTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement
  || target instanceof HTMLTextAreaElement
  || target instanceof HTMLSelectElement
  || target instanceof HTMLButtonElement
  || target instanceof HTMLAnchorElement
  || target instanceof SVGElement
  || target instanceof SVGPathElement
  || (target instanceof HTMLElement && Boolean(
    target.closest(
      '.dashboard-admin-actions, .tabulator-editing, .enrollment-chip-remove',
    ),
  ));

const resolveCellComponentFromTarget = (
  table: Tabulator,
  target: EventTarget | null,
  options?: { allowInteractiveKinds?: boolean },
) => {
  if (!(target instanceof HTMLElement)) return null;

  const cellElement = target.closest<HTMLElement>('.tabulator-cell');
  if (!cellElement) return null;

  const rowElement = cellElement.closest<HTMLElement>('.tabulator-row');
  const row = rowElement ? (table as any)?.rowManager?.findRow?.(rowElement) : null;
  const cell = row?.findCell?.(cellElement) || null;
  if (!cell) return null;

  const field = normalizeText(cell.getField?.() || '');
  if (!field) return null;
  if (field.startsWith('__') && !options?.allowInteractiveKinds) return null;

  const cellKind = normalizeText(getColumnDashboardMeta(cell?.getColumn?.()).kind || '');
  if (
    !options?.allowInteractiveKinds
    && isCustomInteractiveCellKind(cellKind)
  ) {
    return null;
  }

  return cell;
};

// Sync Tabulator's native range selection into __musikiRangeSelectionState
// so the context menu can see which cells are selected.
// The actual drag/highlight/keyboard behavior is handled entirely by Tabulator's
// SelectRange module (enabled via selectableRange: 1 in buildTable).
const bindTableRangeSelection = (table: Tabulator, kind: GridKind) => {
  if (!supportsRangeSelection(kind)) return () => {};

  const state: RangeSelectionState = { selectedCells: new Set<any>() };
  (table as any).__musikiRangeSelectionState = state;

  const syncFromRanges = () => {
    state.selectedCells.clear();
    try {
      const ranges: any[] = (table as any).getRanges?.() || [];
      for (const range of ranges) {
        // getCells() returns a 2-D array: array of rows, each row is array of cells
        const rows: any[][] = range.getCells?.() || [];
        for (const rowCells of rows) {
          if (Array.isArray(rowCells)) {
            for (const cell of rowCells) { if (cell) state.selectedCells.add(cell); }
          } else if (rowCells) {
            state.selectedCells.add(rowCells);
          }
        }
      }
    } catch { /* ignore – table may be partially destroyed */ }
  };

  table.on('rangeAdded', syncFromRanges);
  table.on('rangeChanged', syncFromRanges);
  table.on('rangeRemoved', syncFromRanges);

  return () => {
    try {
      table.off('rangeAdded', syncFromRanges);
      table.off('rangeChanged', syncFromRanges);
      table.off('rangeRemoved', syncFromRanges);
    } catch { /* ignore */ }
    delete (table as any).__musikiRangeSelectionState;
  };
};

/**
 * Prevents Tabulator's range selection from blocking interaction with
 * custom interactive elements (selects, inputs, etc.) inside cells.
 */
const bindInteractiveSuppression = (element: HTMLElement, table?: Tabulator) => {
  const setRangeKeydownBlocked = (blocked: boolean) => {
    const rangeModule = (table as any)?.modules?.selectRange;
    if (rangeModule) {
      rangeModule.blockKeydown = blocked;
    }
  };

  const mouseHandler = (event: MouseEvent) => {
    if (isInteractiveDashboardTarget(event.target)) {
      const shouldBubble = shouldLetInteractiveMouseBubble(event.target);
      if (!shouldBubble && (event.type === 'mousedown' || event.type === 'dblclick')) {
        event.stopPropagation();
      }
      if (shouldBubble) {
        return;
      }
      const control = getInteractiveElementFromTarget(event.target);
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
        window.requestAnimationFrame(() => {
          try {
            control.focus({ preventScroll: true });
            if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
              control.select?.();
            }
          } catch {
            // ignore focus races during redraw
          }
        });
      }
    }
  };

  const keyboardHandler = (event: KeyboardEvent) => {
    if (isInteractiveDashboardTarget(event.target)) {
      setRangeKeydownBlocked(true);
    }
  };

  const focusInHandler = (event: FocusEvent) => {
    if (isInteractiveDashboardTarget(event.target)) {
      setRangeKeydownBlocked(true);
    }
  };

  const focusOutHandler = (event: FocusEvent) => {
    const nextTarget = event.relatedTarget;
    if (isInteractiveDashboardTarget(nextTarget)) return;
    setRangeKeydownBlocked(false);
  };

  // Use capture to catch the event before Tabulator's internal listeners.
  element.addEventListener('mousedown', mouseHandler, { capture: true });
  element.addEventListener('dblclick', mouseHandler, { capture: true });
  element.addEventListener('click', mouseHandler, { capture: true });
  element.addEventListener('keydown', keyboardHandler, { capture: true });
  element.addEventListener('keyup', keyboardHandler, { capture: true });
  element.addEventListener('focusin', focusInHandler);
  element.addEventListener('focusout', focusOutHandler);

  return () => {
    setRangeKeydownBlocked(false);
    element.removeEventListener('mousedown', mouseHandler, { capture: true });
    element.removeEventListener('dblclick', mouseHandler, { capture: true });
    element.removeEventListener('click', mouseHandler, { capture: true });
    element.removeEventListener('keydown', keyboardHandler, { capture: true });
    element.removeEventListener('keyup', keyboardHandler, { capture: true });
    element.removeEventListener('focusin', focusInHandler);
    element.removeEventListener('focusout', focusOutHandler);
  };
};

const focusInteractiveControlInCell = (cell: any) => {
  const cellElement = cell?.getElement?.();
  if (!(cellElement instanceof HTMLElement)) return;

  const control = cellElement.querySelector<HTMLElement>('input, textarea, select, button');
  if (!(control instanceof HTMLElement)) return;

  window.requestAnimationFrame(() => {
    try {
      control.focus({ preventScroll: true });
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        control.select?.();
      }
    } catch {
      // ignore focus races during redraw
    }
  });
};

const bindCustomInteractiveCellFocus = (table: Tabulator) => {
  const focusHandler = (_event: MouseEvent, cell: any) => {
    const kind = getCellKind(cell);
    if (!isCustomInteractiveCellKind(kind)) return;
    focusInteractiveControlInCell(cell);
  };

  table.on('cellClick', focusHandler);

  return () => {
    try {
      table.off('cellClick', focusHandler);
    } catch {
      // ignore teardown races
    }
  };
};

const bindAttendanceManualEditing = (table: Tabulator, meta: DashboardMeta) => {
  const TOUCH_LONG_PRESS_DELAY_MS = 420;

  const resolveAttendanceCellContext = (cell: any) =>
    resolvePersistableAttendanceCellContext(cell, meta);

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
    await persistSingleAttendanceCellValue(cell, normalized, meta);

    const extraCells = getSelectedAttendanceCells(cell);
    const failures: string[] = [];
    for (const selectedCell of extraCells) {
      try {
        await persistSingleAttendanceCellValue(selectedCell, normalized, meta);
      } catch (error: any) {
        failures.push(error?.message || 'No se pudo guardar una celda del rango');
      }
    }

    if (failures.length > 0) {
      alert(`Se guardó la celda activa, pero fallaron ${failures.length} celdas del rango.`);
    }
  };

  let pendingToggleTimer: number | null = null;
  let pendingToggleCellKey = '';
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
    // editable-text user fields (lastName, firstName, etc.) are handled by
    // bindNativeCellPersistence → saveSingleUserFieldCellValue. Do NOT restore them here.
    const editedField = getCellField(cell);
    if (EDITABLE_USER_FIELDS.includes(editedField)) return;

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

  table.on('cellDblClick', (_event: MouseEvent, cell: any) => {
    if (!resolveAttendanceCellContext(cell)) return;
    clearPendingToggle();
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

  // ── Fill column with present button ─────────────────────────────────────
  const rootElement = (table as any)?.element as HTMLElement | undefined;

  const fillColumnHandler = async (event: MouseEvent) => {
    const btn = (event.target instanceof HTMLElement)
      ? event.target.closest<HTMLElement>('[data-action="fill-present"]')
      : null;
    if (!btn) return;
    event.stopPropagation();
    event.preventDefault();

    const field = normalizeText(btn.dataset.field || '');
    if (!field) return;

    const rows = table.getRows('active');
    if (rows.length === 0) return;

    const present = normalizeAttendanceInput('1');
    const failures: string[] = [];
    for (const row of rows) {
      const cell = row.getCell(field);
      if (!cell) continue;
      const context = resolveAttendanceCellContext(cell);
      if (!context) continue;
      try {
        await persistSingleAttendanceCellValue(cell, present, meta);
      } catch (error: any) {
        failures.push(error?.message || `Fila ${context.studentId}`);
      }
    }

    if (failures.length > 0) {
      alert(`Se completó la columna, pero fallaron ${failures.length} celdas.`);
    }
  };

  rootElement?.addEventListener('click', fillColumnHandler);

  return () => {
    clearPendingToggle();
    clearTouchLongPress();
    tableElement?.removeEventListener('touchstart', touchStartHandler);
    tableElement?.removeEventListener('touchend', touchEndHandler);
    tableElement?.removeEventListener('touchcancel', touchMoveCancelHandler);
    tableElement?.removeEventListener('touchmove', touchMoveCancelHandler);
    rootElement?.removeEventListener('click', fillColumnHandler);
  };
};

const bindAdminActions = (host: HTMLElement, table: Tabulator, meta: DashboardMeta) => {
  const clickHandler = async (event: Event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;

    // ── Unenroll chip button ──────────────────────────────────────────────────
    const unenrollButton = target.closest<HTMLButtonElement>('[data-dashboard-unenroll]');
    if (unenrollButton) {
      const enrollmentId = normalizeText(unenrollButton.dataset.enrollmentId || '');
      const enrollmentRole = normalizeTextLower(unenrollButton.dataset.enrollmentRole || 'student');
      const userName = normalizeText(unenrollButton.dataset.userName || 'este usuario');
      const courseId = normalizeText(unenrollButton.closest<HTMLElement>('.enrollment-chip')?.dataset.courseId || '');
      if (!enrollmentId) return;
      const confirmMsg = enrollmentRole === 'teacher'
        ? `¿Quitar inscripción docente de ${userName} en ${courseId || 'este curso'}?`
        : `¿Desinscribir a ${userName} de ${courseId || 'este curso'}?`;
      if (!window.confirm(confirmMsg)) return;
      unenrollButton.disabled = true;
      try {
        const response = await fetch('/api/enroll', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enrollmentId }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || 'No se pudo desinscribir');
        // Remove the chip from the cell
        const chip = unenrollButton.closest<HTMLElement>('.enrollment-chip');
        chip?.remove();
        // Update row data
        const row = table.getRows('active').find((r: any) => {
          const d = r.getData?.() || {};
          return Array.isArray(d.enrollmentCourses) && d.enrollmentCourses.some((e: any) => e.enrollmentId === enrollmentId);
        });
        if (row) {
          const d = row.getData?.() || {};
          const nextCourses = (d.enrollmentCourses || []).filter((e: any) => e.enrollmentId !== enrollmentId);
          row.update?.({ enrollmentCourses: nextCourses, enrollmentSummary: nextCourses.map((e: any) => e.courseId).join(' · ') || '—' });
        }
      } catch (err: any) {
        unenrollButton.disabled = false;
        alert(err?.message || 'No se pudo desinscribir');
      }
      return;
    }

    // ── Edit button → navigate to Admin user detail ──────────────────────────
    const editButton = target.closest<HTMLButtonElement>('[data-dashboard-user-edit]');
    if (editButton) {
      const userId = normalizeText(editButton.dataset.userId || '');
      if (userId) {
        window.location.href = `/admin/user/${encodeURIComponent(userId)}`;
      }
      return;
    }

    // ── Delete button ─────────────────────────────────────────────────────────
    const deleteButton = target.closest<HTMLButtonElement>('[data-dashboard-user-delete]');
    if (!deleteButton) return;

    const selectedRows = Array.isArray(table.getSelectedRows?.()) ? table.getSelectedRows() : [];
    const selectedRowIds = new Set(selectedRows.map((row: any) => getRowComponentId(row)).filter(Boolean));
    const clickedRows = resolveSelectedTargetRows(table, deleteButton);
    const clickedRowId = normalizeText(clickedRows[0]?.getData?.()?.id || '');
    const rowsToDelete =
      selectedRows.length > 1 && clickedRowId && selectedRowIds.has(clickedRowId)
        ? selectedRows
        : clickedRows;

    const selectedUsers = collectAdminUsersFromRows(rowsToDelete);

    if (!selectedUsers.length) {
      const userId = normalizeText(deleteButton.dataset.userId || '');
      if (!userId) return;
      selectedUsers.push({
        id: userId,
        name: normalizeText(deleteButton.dataset.userName || 'este usuario') || 'este usuario',
        email: normalizeText(deleteButton.dataset.userEmail || ''),
        globalRole: normalizeTextLower(deleteButton.dataset.userGlobalRole || ''),
        courseRole: normalizeTextLower(deleteButton.dataset.userCourseRole || ''),
      });
    }

    await deleteAdminUsers(table, meta, selectedUsers, deleteButton);
  };

  host.addEventListener('click', clickHandler, { capture: true });

  return () => {
    host.removeEventListener('click', clickHandler, { capture: true });
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

const createRealtimeProjectionSync = (meta: DashboardMeta): RealtimeProjectionSyncController => {
  const supabaseUrl = normalizeText(meta?.supabaseUrl || '');
  const supabaseKey = normalizeText(meta?.supabaseKey || '');
  const isSafeClientKey =
    supabaseKey.startsWith('sb_publishable_')
    || (supabaseKey.includes('.') && !supabaseKey.startsWith('sb_secret_'));
  if (!supabaseUrl || !supabaseKey || !isSafeClientKey) {
    return {
      isEnabled: () => false,
      setEnabled: () => {},
      destroy: () => {},
    };
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let disposed = false;
  let enabled = false;
  let channel: any = null;
  let refreshTimeout: number | null = null;
  let refreshInFlight = false;
  let refreshQueued = false;

  const clearScheduledRefresh = () => {
    if (refreshTimeout !== null) {
      window.clearTimeout(refreshTimeout);
      refreshTimeout = null;
    }
    refreshQueued = false;
  };

  const stopChannel = () => {
    clearScheduledRefresh();

    if (!channel) return;

    const activeChannel = channel;
    channel = null;
    void supabase.removeChannel(activeChannel);
  };

  const ensureChannel = () => {
    if (disposed || !enabled || channel) return;

    channel = supabase
      .channel(`musiki-dashboard:${normalizeText(meta.courseId)}:${normalizeText(meta.year)}:${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Assignment' }, handleRealtimeEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Submission' }, handleRealtimeEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Enrollment' }, handleRealtimeEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'LiveClassSession' }, handleRealtimeEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'LiveClassAttendance' }, handleRealtimeEvent)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'GradebookAnnotation' }, handleRealtimeEvent)
      .subscribe();
  };

  const runRefresh = async () => {
    if (disposed || !enabled) {
      return;
    }

    if (refreshInFlight) {
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
      if (disposed || !enabled) {
        return;
      }

      const didUpdate = replaceProjectionScriptsFromHtml(html);
      if (didUpdate && typeof window.__musikiDashboardRemount === 'function') {
        window.__musikiDashboardRemount();
      }
    } catch (error) {
      console.error('Error refreshing dashboard projections:', error);
    } finally {
      refreshInFlight = false;
      if (refreshQueued && !disposed && enabled) {
        refreshQueued = false;
        scheduleRefresh();
      }
    }
  };

  const scheduleRefresh = () => {
    if (disposed || !enabled) return;
    clearScheduledRefresh();
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

  return {
    isEnabled: () => enabled,
    setEnabled: (next: boolean) => {
      if (disposed) return;

      enabled = Boolean(next);
      if (!enabled) {
        stopChannel();
        return;
      }

      ensureChannel();
    },
    destroy: () => {
      disposed = true;
      enabled = false;
      stopChannel();
    },
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
  const main = parseJsonScript<GridProjection>('dashboard-teacher-main', { columns: [], rows: [] });
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
    selectedCell: null,
    selectedCellEl: null,
    currentUserId: normalizeText(meta?.userId || ''),
    meta,
  };
  setAnnotations(annotationState, Array.isArray(initialAnnotations) ? initialAnnotations : []);

  const modalRef: { current: AnnotationModalApi | null } = { current: null };
  modalRef.current = createAnnotationModal(root, meta, annotationState);
  const destroyShortcut = bindAnnotationShortcut(annotationState, modalRef);
  const realtimeSync = createRealtimeProjectionSync(meta);
  destroyers.push(bindLiveModeToggle(shell, realtimeSync));

  const mainNode = root.querySelector<HTMLElement>('[data-dashboard-grid="teacher-main"]');
  if (mainNode) {
    const persistKey = buildPersistKey(meta, 'teacher-main');
    const table = buildTable(root, mainNode, main, persistKey, { kind: 'teacher-main', meta }, annotationState, modalRef);
    trackTableBuilt(table, readyTables);
    bindTableSelection(table, 'teacher-main', annotationState);
    destroyers.push(bindNativeEditorFocus(table));
    destroyers.push(bindNativeCellPersistence(mainNode, table, { kind: 'teacher-main', meta }));
    destroyers.push(bindAttendanceManualEditing(table, meta));
    destroyers.push(bindTableRangeSelection(table, 'teacher-main'));
    registry.set('main', table);
    registry.set('teacher-main', table);
    tables.push(table);
    table.on('tableBuilt', () => {
      window.requestAnimationFrame(() => {
        unfoldAllColumns(table, { persist: false });
        restoreStoredFoldState(table);
        foldTeacherMainGroupsByDefault(table);
      });
    });
    const searchInput = root.querySelector<HTMLInputElement>('[data-dashboard-search="teacher-main"]');
    const hideAbandonedButton = root.querySelector<HTMLButtonElement>('[data-dashboard-hide-abandoned]');
    if (searchInput) installGlobalSearch([table], searchInput, persistKey, { hideAbandonedButton });
  }

  const overviewNode = root.querySelector<HTMLElement>('[data-dashboard-grid="overview"]');
  if (overviewNode) {
    const persistKey = buildPersistKey(meta, 'overview');
    const table = buildTable(root, overviewNode, overview, persistKey, { kind: 'overview', meta }, annotationState, modalRef);
    trackTableBuilt(table, readyTables);
    bindTableSelection(table, 'overview', annotationState);
    destroyers.push(bindNativeEditorFocus(table));
    destroyers.push(bindNativeCellPersistence(overviewNode, table, { kind: 'overview', meta }));
    destroyers.push(bindTableRangeSelection(table, 'overview'));
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
    destroyers.push(bindNativeEditorFocus(table));
    destroyers.push(bindNativeCellPersistence(gradebookNode, table, { kind: 'gradebook', meta }));
    destroyers.push(bindTableRangeSelection(table, 'gradebook'));
    registry.set('gradebook', table);
    tables.push(table);
    const searchInput = root.querySelector<HTMLInputElement>('[data-dashboard-search="gradebook"]');
    if (searchInput) installGlobalSearch([table], searchInput, persistKey);
  }

  const attendanceLogNode = root.querySelector<HTMLElement>('[data-dashboard-grid="attendance-log"]');
  const attendanceNode = root.querySelector<HTMLElement>('[data-dashboard-grid="attendance-summary"]');
  if (attendanceNode) {
    const summaryPersistKey = buildPersistKey(meta, 'attendance');
    const summaryTable = buildTable(root, attendanceNode, attendance.summary, summaryPersistKey, {
      kind: 'attendance-summary',
      meta,
    }, annotationState, modalRef);
    trackTableBuilt(summaryTable, readyTables);
    bindTableSelection(summaryTable, 'attendance-summary', annotationState);
    destroyers.push(bindNativeEditorFocus(summaryTable));
    destroyers.push(bindNativeCellPersistence(attendanceNode, summaryTable, { kind: 'attendance-summary', meta }));
    destroyers.push(bindAttendanceManualEditing(summaryTable, meta));
    destroyers.push(bindTableRangeSelection(summaryTable, 'attendance-summary'));
    registry.set('attendance-summary', summaryTable);
    tables.push(summaryTable);

    const summarySearchInput = root.querySelector<HTMLInputElement>('[data-dashboard-search="attendance-summary"]');
    if (summarySearchInput) installGlobalSearch([summaryTable], summarySearchInput, summaryPersistKey);
  }
  if (attendanceLogNode) {
    const summaryPersistKey = buildPersistKey(meta, 'attendance');
    const logTable = buildTable(root, attendanceLogNode, attendance.log, `${summaryPersistKey}:log`, {
      kind: 'attendance-log',
      meta,
    }, annotationState, modalRef);
    trackTableBuilt(logTable, readyTables);
    registry.set('attendance-log', logTable);
    tables.push(logTable);
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
    destroyers.push(bindNativeEditorFocus(table));
    destroyers.push(bindCustomInteractiveCellFocus(table));
    destroyers.push(bindNativeCellPersistence(adminNode, table, { kind: 'admin', meta }));
    destroyers.push(bindAdminActions(adminNode, table, meta));
    destroyers.push(bindAdminDeleteSelectedButton(root, table, meta));
    destroyers.push(bindTableRangeSelection(table, 'admin'));
    registry.set('admin', table);
    tables.push(table);
    const searchInput = root.querySelector<HTMLInputElement>('[data-dashboard-search="admin"]');
    if (searchInput) installGlobalSearch([table], searchInput, persistKey);
  }

  bindTeacherTabs(shell, root, normalizeText(meta?.initialTeacherTab || 'main') || 'main', registry, readyTables);
  bindScopeSelectors(shell);
  bindAttendanceConfig();
  bindCsvButtons(root, registry, meta);
  bindImportClipboardButton(root, meta);
  bindImportCsvButton(root, meta);
  bindAddStudentModal(root, meta);
  bindUnfoldAllButtons(root, registry);
  bindFoldAllButtons(root, registry);
  bindFillEmptyPresentButton(root, registry, meta);

  root.dataset.dashboardTabulatorMounted = 'true';

  return () => {
    destroyShortcut();
    realtimeSync.destroy();
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
