// Foldable sections of the mm concept page (pure; used by the page and by
// src/scripts/mm/fold.ts). Each section is a native <details
// id="mm-sec-<section>"> so it works without JS; the public anchors stay
// #definition, #discussion, #history… (the script maps them to the prefixed
// ids, which cannot collide with other ids on the page). The script
// remembers, per reader, which sections they keep open (localStorage
// `mm-fold:<section>`, the same for every concept) and opens the section an
// anchor (#history, #post-…) points into.

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

/** DOM id of a section (the public anchor is the bare section name). */
export const SECTION_ID_PREFIX = 'mm-sec-';
export const sectionId = (section: string) => `${SECTION_ID_PREFIX}${section}`;

const isSection = (v: string): v is ConceptSection => (CONCEPT_SECTIONS as readonly string[]).includes(v);

/**
 * The element id a URL hash points at: an existing id as is, a public section
 * anchor (#history) mapped to its section id; '' when nothing matches.
 */
export function resolveHashTarget(hash: unknown, exists: (id: string) => boolean): string {
  const id = hashTarget(hash);
  if (!id) return '';
  if (exists(id)) return id;
  return isSection(id) && exists(sectionId(id)) ? sectionId(id) : '';
}

/**
 * Where the page should land: the hash target when it resolves; else, for a
 * reader arriving from an old thread URL (?from=thread, no usable hash), the
 * Discussion section; else nowhere ('').
 */
export function arrivalTarget(opts: { hash: unknown; from: string | null; exists: (id: string) => boolean }): string {
  const target = resolveHashTarget(opts.hash, opts.exists);
  if (target) return target;
  return opts.from === 'thread' && opts.exists(sectionId('discussion')) ? sectionId('discussion') : '';
}
