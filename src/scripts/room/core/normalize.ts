export const normalizeText = (value: unknown) => { if (typeof value === 'object' && value !== null) return JSON.stringify(value); return String(value ?? '').trim(); };

export const normalizePreviewZoom = (value: unknown, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(4, Math.max(0.8, Math.round(parsed * 100) / 100));
};
