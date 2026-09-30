// Pure helpers for the relation modeler UI (graph page table, type form,
// /r/<slug> page). No astro/db imports: shared by the pages (SSR) and the
// client script (src/scripts/mm/relation-types.ts); tested in
// relation-type-ui.test.mjs.
//
// - Labels in the reader's language (hand-written Bokmål when present).
// - The visual sample of a type's encoding as a list of SVG shapes (the page
//   renders them as elements, the form's live preview builds them with
//   createElementNS — never markup strings). Colours are brand tokens only.
// - The form: which options the rules leave open (area needs hierarchical;
//   symmetric and hierarchical exclude each other) and a mirror of the
//   server's validation that also builds the FLAT JSON body the API expects
//   (real booleans, null to clear an optional field on edit).
//
// The enum lists repeat relation-types-core's (the client must not bundle the
// core); the test asserts they stay equal.

export const TYPE_COLORS = ['green', 'purple', 'blue', 'pink', 'yellow', 'red', 'ink'] as const;
export type TypeColor = (typeof TYPE_COLORS)[number];
export const TYPE_STROKES = ['solid', 'dashed', 'dotted', 'double'] as const;
export type TypeStroke = (typeof TYPE_STROKES)[number];
export const TYPE_RENDERS = ['line', 'area'] as const;
export type TypeRender = (typeof TYPE_RENDERS)[number];
export const TYPE_PROPERTIES = ['symmetric', 'transitive', 'hierarchical'] as const;
export type TypeProperty = (typeof TYPE_PROPERTIES)[number];

/** What the UI needs of a relation type (a RelationTypeView satisfies it). */
export type TypeLike = {
  slug: string;
  label: string;
  labelNb?: string | null;
  inverseLabel?: string | null;
  inverseLabelNb?: string | null;
  render: string;
  stroke: string;
  arrow: boolean;
  color: string;
  symmetric: boolean;
  transitive: boolean;
  hierarchical: boolean;
};

type ReaderLang = 'en' | 'nb' | 'nn';
export type Localized = { text: string; lang: 'en' | 'nb' };

const nbFirst = (en: string, nb: string | null | undefined, lang: ReaderLang): Localized =>
  lang !== 'en' && nb && nb.trim() ? { text: nb, lang: 'nb' } : { text: en, lang: 'en' };

/** The type's label for a reader: hand-written Bokmål for nb/nn when present, else English. */
export function typeLabel(t: Pick<TypeLike, 'label' | 'labelNb'>, lang: ReaderLang): Localized {
  return nbFirst(t.label, t.labelNb, lang);
}

/**
 * The reading from the other end ("is contained in"), or null when the type
 * has none or is symmetric (it reads the same both ways). An English inverse
 * stands in for a missing Bokmål one only when there is no nb inverse at all.
 */
export function typeInverse(t: Pick<TypeLike, 'inverseLabel' | 'inverseLabelNb' | 'symmetric'>, lang: ReaderLang): Localized | null {
  if (t.symmetric) return null;
  if (lang !== 'en' && t.inverseLabelNb && t.inverseLabelNb.trim()) return { text: t.inverseLabelNb, lang: 'nb' };
  if (t.inverseLabel && t.inverseLabel.trim()) return { text: t.inverseLabel, lang: 'en' };
  return null;
}

/** The logical properties a type has, in a fixed order. */
export const typeProperties = (t: Pick<TypeLike, TypeProperty>): TypeProperty[] => TYPE_PROPERTIES.filter((p) => t[p] === true);

export const typePath = (slug: string) => `/r/${encodeURIComponent(slug)}`;

// ---------------------------------------------------------------------------
// Encoding → colours and stroke patterns (brand tokens only)
// ---------------------------------------------------------------------------

const isColor = (c: unknown): c is TypeColor => (TYPE_COLORS as readonly string[]).includes(c as string);
const isStroke = (s: unknown): s is TypeStroke => (TYPE_STROKES as readonly string[]).includes(s as string);

/**
 * Stroke colour of a palette slot. The pastel purple is decoration only (the
 * brand's text rule), so lines use its darker text step; the other slots use
 * their own token. Unknown slots fall back to ink.
 */
export function strokeColor(color: string): string {
  if (!isColor(color)) return 'var(--mm-ink)';
  return color === 'purple' ? 'var(--mm-purple-text)' : `var(--mm-${color})`;
}

/**
 * Fill of an area of a palette slot: the slot's tint. The brand has no red or
 * ink tint: red uses the pink tint (its surface partner), ink the ink-5 grey.
 * Text on any of these is ink.
 */
export function tintColor(color: string): string {
  switch (color) {
    case 'green': case 'purple': case 'blue': case 'pink': case 'yellow': return `var(--mm-${color}-tint)`;
    case 'red': return 'var(--mm-pink-tint)';
    default: return 'var(--mm-ink-5)';
  }
}

/**
 * The pastel slots (green, yellow, blue, pink) are 1.3-1.6:1 on white, under
 * the 3:1 WCAG 1.4.11 asks of graphics. They keep their brand colour but are
 * drawn over a flat ink underlay (lines: 1px wider; area borders: 1px ink
 * outline each side; arrowheads: an ink outline). Purple lines already use the
 * darker text step, red and ink are dark enough.
 */
export const INK_UNDERLAY_COLORS = ['green', 'yellow', 'blue', 'pink'] as const;
export const needsInkUnderlay = (color: unknown): boolean => (INK_UNDERLAY_COLORS as readonly string[]).includes(color as string);

/** SVG stroke-dasharray of a stroke pattern (null = solid; `double` is two solid strokes). */
export function dashArray(stroke: string): string | null {
  switch (stroke) {
    case 'dashed': return '6 4';
    case 'dotted': return '2 3';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Sample SVG spec
// ---------------------------------------------------------------------------

export type SvgShape = { tag: 'line' | 'rect' | 'path'; attrs: Record<string, string | number> };
export type SampleSpec = { width: number; height: number; shapes: SvgShape[] };

export const SAMPLE_W = 64;
export const SAMPLE_H = 24;

/**
 * The shapes of a type's sample (viewBox 0 0 64 24), drawn by the page and the
 * form preview alike. Line: a horizontal stroke in the slot colour with the
 * type's pattern, two parallel strokes for `double`, a filled arrowhead in the
 * slot colour when directed (never for symmetric types). Area: a square
 * of the slot's tint with a 2px border in the slot colour and pattern. Flat:
 * butt caps, miter joins, no radius.
 */
export function sampleSpec(t: Pick<TypeLike, 'render' | 'stroke' | 'arrow' | 'color' | 'symmetric'>): SampleSpec {
  const stroke = strokeColor(t.color);
  const pattern = isStroke(t.stroke) ? t.stroke : 'solid';
  const dash = dashArray(pattern);
  const base = (extra: Record<string, string | number> = {}) => ({
    stroke, 'stroke-width': 2, 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', fill: 'none',
    ...(dash ? { 'stroke-dasharray': dash } : {}), ...extra,
  });
  const shapes: SvgShape[] = [];
  const ink = needsInkUnderlay(t.color);
  /** Ink copy of a coloured stroke, drawn first (under it): `grow` px wider, same geometry and dash. */
  const under = (attrs: Record<string, string | number>, grow: number): SvgShape =>
    ({ tag: 'width' in attrs ? 'rect' : 'line', attrs: { ...attrs, stroke: 'var(--mm-ink)', 'stroke-width': Number(attrs['stroke-width']) + grow } });
  if (t.render === 'area') {
    // Square area: 20×20 centred, border drawn inside the box.
    const size = 20, x = (SAMPLE_W - size) / 2, y = (SAMPLE_H - size) / 2;
    shapes.push({ tag: 'rect', attrs: { x, y, width: size, height: size, fill: tintColor(t.color) } });
    const borders = pattern === 'double'
      ? [base({ x: x + 1, y: y + 1, width: size - 2, height: size - 2, 'stroke-width': 1 }), base({ x: x + 4, y: y + 4, width: size - 8, height: size - 8, 'stroke-width': 1 })]
      : [base({ x: x + 1, y: y + 1, width: size - 2, height: size - 2 })];
    // 1px ink each side of a 2px border; the 1px strokes of `double` get 0.5px each side so the gap between them stays visible.
    if (ink) for (const b of borders) shapes.push(under(b, pattern === 'double' ? 1 : 2));
    for (const b of borders) shapes.push({ tag: 'rect', attrs: b });
    return { width: SAMPLE_W, height: SAMPLE_H, shapes };
  }
  const arrow = t.arrow === true && t.symmetric !== true;
  const x1 = 4, x2 = arrow ? SAMPLE_W - 12 : SAMPLE_W - 4, y = SAMPLE_H / 2;
  const strokes = pattern === 'double'
    ? [base({ x1, y1: y - 2, x2, y2: y - 2, 'stroke-width': 1.5 }), base({ x1, y1: y + 2, x2, y2: y + 2, 'stroke-width': 1.5 })]
    : [base({ x1, y1: y, x2, y2: y })];
  if (ink) for (const b of strokes) shapes.push(under(b, 1));
  for (const b of strokes) shapes.push({ tag: 'line', attrs: b });
  if (arrow) {
    const tip = SAMPLE_W - 4;
    shapes.push({ tag: 'path', attrs: { d: `M${tip - 9},${y - 5} L${tip},${y} L${tip - 9},${y + 5} Z`, fill: stroke, ...(ink ? { stroke: 'var(--mm-ink)', 'stroke-width': 1, 'stroke-linejoin': 'miter' } : { stroke: 'none' }) } });
  }
  return { width: SAMPLE_W, height: SAMPLE_H, shapes };
}

/**
 * The attributes to set on a sample shape's element. Colours are CSS custom
 * properties, which SVG presentation attributes do not resolve reliably, so
 * `stroke` and `fill` go into the element's style (a plain declaration list
 * of brand tokens; set as an attribute, never through markup).
 */
export function svgAttrs(shape: SvgShape): Record<string, string> {
  const out: Record<string, string> = {};
  const style: string[] = [];
  for (const [k, v] of Object.entries(shape.attrs)) {
    if (k === 'stroke' || k === 'fill') style.push(`${k}:${v}`);
    else out[k] = String(v);
  }
  if (style.length) out.style = style.join(';');
  return out;
}

// ---------------------------------------------------------------------------
// Form rules and validation (mirror of relation-types-core)
// ---------------------------------------------------------------------------

export type FormState = {
  render: string;
  symmetric: boolean;
  hierarchical: boolean;
};

export type FormRules = {
  /** Options the rules close in the current state. */
  disabled: { symmetric: boolean; hierarchical: boolean; area: boolean };
  /** An area type is hierarchical: the box is checked and locked. */
  forceHierarchical: boolean;
};

/**
 * Which inputs the rules leave open: an area must be hierarchical (so the
 * hierarchical box is checked and locked, and symmetric closes); symmetric and
 * hierarchical exclude each other; a symmetric type cannot be an area.
 */
export function formRules(s: FormState): FormRules {
  const area = s.render === 'area';
  const hierarchical = area || s.hierarchical;
  return {
    disabled: { symmetric: hierarchical, hierarchical: area || s.symmetric, area: s.symmetric },
    forceHierarchical: area,
  };
}

const MAX_LABEL = 200;
const MAX_DEFINITION = 20000;
const SKOS_RE = /^[A-Za-z][A-Za-z0-9]*:[A-Za-z][A-Za-z0-9_-]*$/;
const WIKIDATA_RE = /^[PQ][1-9][0-9]{0,11}$/;
const MAPPING_MAX = 100;

/** Raw form values (strings from inputs, booleans from checkboxes). */
export type FormValues = {
  label?: string; labelNb?: string; inverseLabel?: string; inverseLabelNb?: string;
  render?: string; stroke?: string; arrow?: boolean; color?: string;
  symmetric?: boolean; transitive?: boolean; hierarchical?: boolean;
  skos?: string; wikidata?: string; definition?: string;
};

export type FormErrorCode =
  | 'labelRequired' | 'tooLong' | 'invalidChoice' | 'areaNeedsHierarchical' | 'symmetricHierarchical'
  | 'invalidSkos' | 'invalidWikidata' | 'definitionRequired' | 'definitionTooLong';
export type FormError = { field: string; code: FormErrorCode };

export type FormResult = { ok: true; body: Record<string, unknown> } | { ok: false; errors: FormError[] };

const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Validates the form as the server would and builds the body: create → the
 * flat POST body (type fields + `definition`; empty optional fields left
 * out); edit → the PATCH type-fields body (every field, null clears an
 * optional one; no definition — that is its own PATCH). Errors are listed per
 * field in form order; the server stays the authority.
 */
export function buildTypeBody(v: FormValues, mode: 'create' | 'edit'): FormResult {
  const errors: FormError[] = [];
  const label = trimmed(v.label);
  if (!label) errors.push({ field: 'label', code: 'labelRequired' });
  else if (label.length > MAX_LABEL) errors.push({ field: 'label', code: 'tooLong' });
  const optional: Record<string, string | null> = {};
  for (const f of ['labelNb', 'inverseLabel', 'inverseLabelNb'] as const) {
    const s = trimmed(v[f]);
    if (s.length > MAX_LABEL) errors.push({ field: f, code: 'tooLong' });
    optional[f] = s || null;
  }
  const render = v.render ?? 'line';
  const stroke = v.stroke ?? 'solid';
  const color = v.color ?? 'ink';
  if (!(TYPE_RENDERS as readonly string[]).includes(render)) errors.push({ field: 'render', code: 'invalidChoice' });
  if (!isStroke(stroke)) errors.push({ field: 'stroke', code: 'invalidChoice' });
  if (!isColor(color)) errors.push({ field: 'color', code: 'invalidChoice' });
  const symmetric = v.symmetric === true;
  const transitive = v.transitive === true;
  const hierarchical = v.hierarchical === true;
  if (render === 'area' && !hierarchical) errors.push({ field: 'hierarchical', code: 'areaNeedsHierarchical' });
  if (symmetric && hierarchical) errors.push({ field: 'symmetric', code: 'symmetricHierarchical' });
  const skos = trimmed(v.skos);
  if (skos && (skos.length > MAPPING_MAX || !SKOS_RE.test(skos))) errors.push({ field: 'skos', code: 'invalidSkos' });
  const wikidata = trimmed(v.wikidata);
  if (wikidata && (wikidata.length > MAPPING_MAX || !WIKIDATA_RE.test(wikidata))) errors.push({ field: 'wikidata', code: 'invalidWikidata' });
  const definition = typeof v.definition === 'string' ? v.definition.replace(/\r\n/g, '\n').trim() : '';
  if (mode === 'create') {
    if (!definition) errors.push({ field: 'definition', code: 'definitionRequired' });
    else if (definition.length > MAX_DEFINITION) errors.push({ field: 'definition', code: 'definitionTooLong' });
  }
  if (errors.length) return { ok: false, errors };

  const fields: Record<string, unknown> = {
    label, ...optional, render, stroke, arrow: v.arrow === true, color, symmetric, transitive, hierarchical,
    skos: skos || null, wikidata: wikidata || null,
  };
  if (mode === 'edit') return { ok: true, body: fields };
  const body: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(fields)) if (val !== null) body[k] = val;
  body.definition = definition;
  return { ok: true, body };
}

/** The legend order after moving `slug` one place up (-1) or down (+1); unchanged at the ends. */
export function moveSlug(order: readonly string[], slug: string, dir: -1 | 1): string[] {
  const out = [...order];
  const i = out.indexOf(slug);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Slugs of the types whose visibility box is checked (the graph's filter). */
export const visibleSlugs = (boxes: Iterable<{ slug: string; checked: boolean }>): string[] =>
  [...boxes].filter((b) => b.checked).map((b) => b.slug);

/** Name of the event the modeler table dispatches on `document` when a visibility box changes. */
export const RELATION_FILTER_EVENT = 'mm:relation-filter';
export type RelationFilterDetail = { visible: string[] };
