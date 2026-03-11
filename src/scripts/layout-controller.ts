export const LAYOUT_MODES = ['grid', 'teacher', 'presentation', 'screenshare'] as const;

export type LayoutMode = (typeof LAYOUT_MODES)[number];

export const normalizeLayoutMode = (value: string | null | undefined): LayoutMode => {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (normalized === 'speaker') return 'teacher';
  if (LAYOUT_MODES.includes(normalized as LayoutMode)) return normalized as LayoutMode;

  return 'presentation';
};

export const setLayout = (
  root: HTMLElement | null | undefined,
  nextLayout: string | null | undefined,
): LayoutMode => {
  const layout = normalizeLayoutMode(nextLayout);
  if (root) {
    root.dataset.layout = layout;
  }
  return layout;
};
