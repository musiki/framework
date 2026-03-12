export type DashboardAlign = 'left' | 'center' | 'right';

export interface DashboardGridColumn {
  title: string;
  field?: string;
  columns?: DashboardGridColumn[];
  frozen?: boolean;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  hozAlign?: DashboardAlign;
  headerHozAlign?: DashboardAlign;
  headerSort?: boolean;
  kind?: string;
  dateKey?: string;
  cssClass?: string;
}

export interface DashboardGridProjection {
  columns: DashboardGridColumn[];
  rows: Record<string, any>[];
  emptyMessage?: string;
}

export interface DashboardAttendanceProjection {
  summary: DashboardGridProjection;
  log: DashboardGridProjection;
}

export const toDashboardProjectionJson = (value: unknown) =>
  JSON.stringify(value ?? null).replaceAll('<', '\\u003c');

export const normalizeDashboardText = (value: unknown) => String(value ?? '').trim();

export const normalizeDashboardTextLower = (value: unknown) =>
  normalizeDashboardText(value).toLowerCase();

export const splitDashboardName = (value: unknown) => {
  const normalized = normalizeDashboardText(value);
  if (!normalized) {
    return { firstName: '—', lastName: '' };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return {
      firstName: parts[0] || normalized,
      lastName: '',
    };
  }

  return {
    firstName: parts[0] || normalized,
    lastName: parts.slice(1).join(' '),
  };
};

export const fieldKeyFromId = (prefix: string, value: unknown) => {
  const raw = normalizeDashboardText(value);
  const encoded = encodeURIComponent(raw || 'field').replaceAll('%', '_');
  return `${prefix}__${encoded}`;
};

export const asDashboardNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const formatDashboardScore = (value: unknown) => {
  const parsed = asDashboardNumber(value);
  if (parsed === null) return '';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1).replace(/\.0$/, '');
};

export const formatDashboardAbsence = (value: unknown) => {
  const parsed = asDashboardNumber(value);
  if (parsed === null || parsed <= 0) return '0';
  const normalized = Math.round(parsed * 2) / 2;
  return Number.isInteger(normalized)
    ? String(normalized)
    : normalized.toFixed(1).replace(/\.0$/, '');
};

export const buildSearchBlob = (parts: unknown[]) =>
  parts
    .map((value) => normalizeDashboardTextLower(value))
    .filter(Boolean)
    .join(' ');
