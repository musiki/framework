// Foldable sections of the mm concept page (pure; used by the page and by
// src/scripts/mm/fold.ts). Each section is a native <details id="<section>">
// so it works without JS; the script remembers, per reader, which sections
// they keep open (localStorage `mm-fold:<section>`, the same for every
// concept) and opens the section an anchor (#history, #post-…) points into.

/** The concept page's sections, in page order; each id is also its anchor. */
export const CONCEPT_SECTIONS = ['definition', 'discussion', 'new-version', 'relations', 'status', 'history'] as const;
export type ConceptSection = (typeof CONCEPT_SECTIONS)[number];

/** Open until the reader closes them: the definition and the discussion. */
export const FOLD_DEFAULT_OPEN: Readonly<Record<ConceptSection, boolean>> = Object.freeze({
  definition: true,
  discussion: true,
  'new-version': false,
  relations: false,
  status: false,
  history: false,
});

export const FOLD_KEY_PREFIX = 'mm-fold:';
export const foldKey = (section: string) => `${FOLD_KEY_PREFIX}${section}`;

/** Stored value → open state ('1' open, '0' closed), or null when nothing usable is stored. */
export function parseFoldValue(raw: unknown): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}
export const foldValue = (open: boolean) => (open ? '1' : '0');

/** Whether a section starts open: an anchor into it forces it open; else the reader's choice; else the default. */
export function initialFoldOpen(opts: { defaultOpen: boolean; stored: boolean | null; targeted: boolean }): boolean {
  if (opts.targeted) return true;
  return opts.stored ?? opts.defaultOpen;
}

/** The fragment of a URL hash ('#history' → 'history'), decoded; '' when none or malformed. */
export function hashTarget(hash: unknown): string {
  if (typeof hash !== 'string' || hash.length < 2 || hash[0] !== '#') return '';
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return '';
  }
}
