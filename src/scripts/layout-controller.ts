export const LAYOUT_MODES = [
  'grid',
  'teacher',
  'presentation',
  'screenshare',
  'concept',
  'whiteboard',
  'lilypond',
] as const;

export type LayoutMode = (typeof LAYOUT_MODES)[number];

export interface StageLayoutState {
  mode: LayoutMode | 'split';
  base: LayoutMode;
  split?: LayoutMode | null;
  overlay?: LayoutMode | null;
}

export const normalizeLayoutMode = (value: string | null | undefined): LayoutMode => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();

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
    // Reset secondary states when setting a primary layout
    delete root.dataset.layoutSplit;
    delete root.dataset.layoutOverlay;
  }
  return layout;
};

export const setSplitLayout = (
  root: HTMLElement | null | undefined,
  left: LayoutMode,
  right: LayoutMode,
) => {
  if (root) {
    root.dataset.layout = 'split';
    root.dataset.layoutSplitLeft = left;
    root.dataset.layoutSplitRight = right;
    delete root.dataset.layoutOverlay;
  }
};

export const setOverlayLayout = (
  root: HTMLElement | null | undefined,
  overlay: LayoutMode | null,
) => {
  if (root) {
    if (overlay) {
      root.dataset.layoutOverlay = overlay;
    } else {
      delete root.dataset.layoutOverlay;
    }
  }
};
