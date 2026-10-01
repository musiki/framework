// Pure layout helpers for the mm concept graph (src/scripts/mm/graph.ts).
// No DOM: label folding, boxes, overlap checks, the fit-to-view transform and
// the typed-relation drawing rules (area hulls, agreement width, contested
// pattern, arrowheads, the sentence a relation reads as), so they can be unit
// tested with node --test. d3-polygon (pure maths) computes the hulls.

import { polygonHull } from 'd3-polygon';
import { dashArray, strokeColor, typeInverse, typeLabel, type Localized, type TypeLike } from './relation-type-ui.ts';

export type Box = { x: number; y: number; w: number; h: number }; // centre x/y, full width/height
export type Bounds = { x0: number; y0: number; x1: number; y1: number };
export type ZoomTransform = { k: number; x: number; y: number };

/** Fold a label to at most `max` characters (the ellipsis counts), on a word
 * boundary when one is close enough; whole code points only. */
export function truncateLabel(label: string, max: number): string {
  const s = label.trim().replace(/\s+/g, ' ');
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  if (max < 2) return chars.slice(0, Math.max(max, 1)).join('');
  const head = chars.slice(0, max - 1).join('');
  const cut = head.lastIndexOf(' ');
  const base = cut >= Math.ceil((max - 1) * 0.6) ? head.slice(0, cut) : head;
  return `${base.replace(/[\s,;:.\-–—]+$/u, '')}…`;
}

/** Axis-aligned overlap of two centred boxes, with an optional gap. */
export function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + gap * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + gap * 2;
}

/** Greedy de-cluttering: walk `labels` in priority order (the caller sorts,
 * highlighted first) and hide every label that overlaps an obstacle (node
 * boxes) or a label already kept. `forced` labels are always kept. Returns
 * the set of hidden indices (into `labels`). */
export function hiddenByOverlap(labels: Box[], obstacles: Box[] = [], forced: ReadonlySet<number> = new Set(), gap = 1): Set<number> {
  const kept: Box[] = [];
  const hidden = new Set<number>();
  const order = labels.map((_, i) => i).sort((a, b) => Number(forced.has(b)) - Number(forced.has(a)));
  for (const i of order) {
    const box = labels[i];
    const clash = !forced.has(i) && (obstacles.some((o) => boxesOverlap(box, o, gap)) || kept.some((k) => boxesOverlap(box, k, gap)));
    if (clash) hidden.add(i);
    else kept.push(box);
  }
  return hidden;
}

/** Bounds of a set of centred boxes (null when empty). */
export function boundsOf(boxes: Box[]): Bounds | null {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x - b.w / 2);
    y0 = Math.min(y0, b.y - b.h / 2);
    x1 = Math.max(x1, b.x + b.w / 2);
    y1 = Math.max(y1, b.y + b.h / 2);
  }
  return { x0, y0, x1, y1 };
}

/** Transform (screen = world * k + [x, y]) that fits `points` (world
 * coordinates of node centres) into a view of `width` x `height`. Node boxes
 * do not grow with the zoom (semantic zoom), so `margin` is the screen-space
 * room kept around the centres (half the widest box plus padding): the zoom
 * only has to fit the spread of the centres. */
export function fitTransform(
  points: { x: number; y: number }[],
  width: number,
  height: number,
  margin: { x: number; y: number },
  scaleExtent: [number, number] = [0.2, 4],
): ZoomTransform {
  const b = boundsOf(points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })));
  if (!b) return { k: 1, x: width / 2, y: height / 2 };
  const availW = Math.max(1, width - 2 * margin.x);
  const availH = Math.max(1, height - 2 * margin.y);
  const spanW = b.x1 - b.x0;
  const spanH = b.y1 - b.y0;
  const raw = Math.min(spanW > 0 ? availW / spanW : Infinity, spanH > 0 ? availH / spanH : Infinity);
  const k = clamp(Number.isFinite(raw) ? raw : 1, scaleExtent[0], scaleExtent[1]);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return { k, x: width / 2 - cx * k, y: height / 2 - cy * k };
}

/** Link rest length from the (folded) widths of its end boxes and its label. */
export function linkDistance(sourceW: number, targetW: number, labelW: number, min = 90): number {
  return Math.max(min, (sourceW + targetW) / 2 * 0.55 + labelW * 0.9 + 36);
}

/** Level of detail at zoom k. `showAll` (the toolbar toggle) wins. */
export function levelOfDetail(k: number, showAll: boolean, fullLabelsAt = 1.5, edgeLabelsAt = 0.75): { fullLabels: boolean; edgeLabels: boolean } {
  if (showAll) return { fullLabels: true, edgeLabels: true };
  return { fullLabels: k >= fullLabelsAt, edgeLabels: k >= edgeLabelsAt };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export type CardPlacement = { x: number; y: number; side: 'right' | 'left' | 'below' | 'above' | 'clamped' };

/** Below this frame width the card docks at the bottom of the frame instead of floating by the node. */
export const CARD_DOCK_BELOW = 480;
export const shouldDock = (frameWidth: number, dockBelow = CARD_DOCK_BELOW): boolean => frameWidth < dockBelow;

/**
 * Top-left corner of the hover card for a node box (centre x/y, full w/h, in
 * frame pixels) inside a frame of `frame` size. Prefers the right of the
 * node, then left, below, above (the first side where the whole card fits,
 * vertically centred on the node and clamped to the frame); when none fits
 * the card is clamped inside the frame next to the node's side with most room.
 */
export function placeCard(
  node: Box,
  card: { w: number; h: number },
  frame: { w: number; h: number },
  gap = 8,
  pad = 4,
): CardPlacement {
  const maxX = Math.max(pad, frame.w - card.w - pad);
  const maxY = Math.max(pad, frame.h - card.h - pad);
  const cy = clamp(node.y - card.h / 2, pad, maxY);
  const cx = clamp(node.x - card.w / 2, pad, maxX);
  const right = node.x + node.w / 2 + gap;
  const left = node.x - node.w / 2 - gap - card.w;
  const below = node.y + node.h / 2 + gap;
  const above = node.y - node.h / 2 - gap - card.h;
  if (right + card.w <= frame.w - pad) return { x: right, y: cy, side: 'right' };
  if (left >= pad) return { x: left, y: cy, side: 'left' };
  if (below + card.h <= frame.h - pad) return { x: cx, y: below, side: 'below' };
  if (above >= pad) return { x: cx, y: above, side: 'above' };
  const roomRight = frame.w - (node.x + node.w / 2);
  const roomLeft = node.x - node.w / 2;
  return { x: clamp(roomRight >= roomLeft ? right : left, pad, maxX), y: cy, side: 'clamped' };
}

// ---------------------------------------------------------------------------
// Typed relations: areas, agreement, arrows, sentences
// ---------------------------------------------------------------------------

export type Point = { x: number; y: number };
/** A node for hulls: centre and (optional) box size. */
export type HullBox = { x: number; y: number; w?: number; h?: number };

/**
 * Convex hull (counter-clockwise, as d3-polygon returns it) of the boxes, each
 * grown by `padding` on every side. Built from box corners, so its sides are
 * straight and its corners sharp (no rounding: the brand is flat). Null when
 * there is nothing to wrap.
 */
export function hullPolygon(boxes: HullBox[], padding: number): [number, number][] | null {
  const pts: [number, number][] = [];
  const p = Math.max(0, padding);
  for (const b of boxes) {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    const hw = (b.w ?? 0) / 2 + p, hh = (b.h ?? 0) / 2 + p;
    pts.push([b.x - hw, b.y - hh], [b.x + hw, b.y - hh], [b.x + hw, b.y + hh], [b.x - hw, b.y + hh]);
  }
  if (!pts.length) return null;
  const hull = polygonHull(pts);
  if (hull) return hull;
  // Degenerate (every corner on one line: zero-size boxes, no padding): the extreme points.
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return [sorted[0], sorted[sorted.length - 1]];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** SVG path of `hullPolygon(boxes, padding)`: straight segments, closed; '' when empty. */
export function hullPath(boxes: HullBox[], padding: number): string {
  const poly = hullPolygon(boxes, padding);
  if (!poly) return '';
  return `M${poly.map(([x, y]) => `${r1(x)},${r1(y)}`).join('L')}Z`;
}

/**
 * Where an area's label sits: the midpoint of the hull side that lies highest
 * (smallest mean y; ties: the leftmost) — or, with `side: 'bottom'`, lowest —
 * so the label reads along that edge. Nested areas alternate sides (see
 * `areaLabelSide`) so an inner area's tab does not sit on its outer one's.
 */
export function hullLabelAnchor(poly: [number, number][] | null, side: 'top' | 'bottom' = 'top'): Point | null {
  if (!poly?.length) return null;
  if (poly.length === 1) return { x: poly[0][0], y: poly[0][1] };
  const sign = side === 'top' ? 1 : -1;
  let best: Point | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const m = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
    if (!best || sign * m.y < sign * best.y - 1e-9 || (Math.abs(m.y - best.y) <= 1e-9 && m.x < best.x)) best = m;
  }
  return best;
}

/**
 * The outline of a cloud (an `area` relation type drawn round its container
 * and members): a faceted region with straight sides only (the brand is flat:
 * no curves, no rounding). Each box is grown by `padding` and its corners are
 * cut (`facet` of the padding), the convex hull of those points is taken, and
 * every side longer than `facetLen` is split into short facets bowed slightly
 * outwards (on a parabola over the side, so the outline stays convex and
 * never cuts into the padding). Deterministic; null when there is nothing to
 * wrap.
 */
export function cloudPolygon(boxes: HullBox[], padding: number, facet = 0.45, facetLen = Math.max(28, padding * 3)): [number, number][] | null {
  const p = Math.max(0, padding);
  const c = p * clamp(facet, 0, 1);
  const pts: [number, number][] = [];
  for (const b of boxes) {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    const hw = (b.w ?? 0) / 2 + p, hh = (b.h ?? 0) / 2 + p;
    const cx = Math.min(c, hw), cy = Math.min(c, hh);
    pts.push(
      [b.x - hw + cx, b.y - hh], [b.x + hw - cx, b.y - hh], [b.x + hw, b.y - hh + cy], [b.x + hw, b.y + hh - cy],
      [b.x + hw - cx, b.y + hh], [b.x - hw + cx, b.y + hh], [b.x - hw, b.y + hh - cy], [b.x - hw, b.y - hh + cy],
    );
  }
  if (!pts.length) return null;
  const hull = polygonHull(pts);
  if (!hull) {
    const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return [sorted[0], sorted[sorted.length - 1]];
  }
  let mx = 0, my = 0;
  for (const [x, y] of hull) { mx += x; my += y; }
  mx /= hull.length; my /= hull.length;
  // Exterior angle at each hull vertex: a side's bow is kept small enough that its first and last
  // facets turn by less than half of it, so the outline stays convex at the original corners.
  const turn = hull.map((v, i) => {
    const a = hull[(i + hull.length - 1) % hull.length], b = hull[(i + 1) % hull.length];
    const t1 = Math.atan2(v[1] - a[1], v[0] - a[0]), t2 = Math.atan2(b[1] - v[1], b[0] - v[0]);
    const d = Math.abs(t2 - t1) % (2 * Math.PI);
    return d > Math.PI ? 2 * Math.PI - d : d;
  });
  const out: [number, number][] = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    out.push(a);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const n = Math.floor(len / Math.max(1, facetLen));
    if (n < 1) continue;
    // Outward normal: the side of the edge away from the hull's centre.
    let nx = dy / len, ny = -dx / len;
    if (nx * ((a[0] + b[0]) / 2 - mx) + ny * ((a[1] + b[1]) / 2 - my) < 0) { nx = -nx; ny = -ny; }
    const ends = Math.min(turn[i], turn[(i + 1) % hull.length]);
    const bow = Math.min(len * 0.04, p * 0.35, (len / 4) * Math.tan(ends / 2) * 0.9);
    for (let j = 1; j <= n; j++) {
      const t = j / (n + 1);
      const h = bow * 4 * t * (1 - t);
      out.push([a[0] + dx * t + nx * h, a[1] + dy * t + ny * h]);
    }
  }
  return out;
}

/** SVG path of a polygon: straight segments, closed, rounded to 0.1px; '' when empty. */
export function polygonPath(poly: [number, number][] | null): string {
  if (!poly?.length) return '';
  return `M${poly.map(([x, y]) => `${r1(x)},${r1(y)}`).join('L')}Z`;
}

/**
 * Where a cloud's label sits: on its outline straight above (`top`) or below
 * (`bottom`) the middle of its bounding box, so a horizontal label reads
 * across that edge whatever the facets. Null when there is no outline.
 */
export function cloudLabelAnchor(poly: [number, number][] | null, side: 'top' | 'bottom' = 'top'): Point | null {
  if (!poly?.length) return null;
  let x0 = Infinity, x1 = -Infinity;
  for (const [x] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const x = (x0 + x1) / 2;
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
    const y = a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    if (best === null || (side === 'top' ? y < best : y > best)) best = y;
  }
  if (best === null) return hullLabelAnchor(poly, side);
  return { x, y: best };
}

/**
 * Centre of a horizontal label of `size` sliding along the segment p→q: the
 * segment's midpoint moved by the part of `offset` that runs along the
 * segment, kept far enough from the ends that the label stays on the line.
 * The label therefore always sits on its line, centred on the midpoint unless
 * another label pushes it along.
 */
export function slideAlong(p: Point, q: Point, offset: Point, size: { w: number; h: number } = { w: 0, h: 0 }): Point {
  const dx = q.x - p.x, dy = q.y - p.y;
  const len = Math.hypot(dx, dy);
  const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  if (!len) return m;
  const ux = dx / len, uy = dy / len;
  const extent = (size.w / 2) * Math.abs(ux) + (size.h / 2) * Math.abs(uy);
  const room = Math.max(0, len / 2 - extent);
  const a = clamp(offset.x * ux + offset.y * uy, -room, room);
  return { x: m.x + ux * a, y: m.y + uy * a };
}

/** Label side of an area at nesting `level`: odd levels on the top edge, even ones (innermost) on the bottom. */
export const areaLabelSide = (level: number): 'top' | 'bottom' => (level % 2 === 1 ? 'top' : 'bottom');

export type AreaEdge = { source: string; target: string; type: string; inferred?: boolean };
export type AreaGroup = {
  /** `type|container` */
  key: string;
  type: string;
  /** The concept that contains (the relation's source: "A contains B"). */
  container: string;
  /** Contained concepts (asserted or inferred), sorted, without the container. */
  members: string[];
  /** Nesting level: 0 when no other area sits inside, else 1 + the deepest inner area. */
  level: number;
};

/**
 * Area relations grouped into areas: one per (type, container), the container
 * being the relation's source ("technics contains memory"). Inferred relations
 * of the type add members, so an area wraps whatever its nested areas hold.
 * An area whose members include another area's container is one level up
 * (drawn with more padding, so the inner hull sits inside the outer one).
 * Cycle-safe. Sorted outermost first (drawing order: inner areas on top).
 */
export function areaGroups(edges: AreaEdge[], areaTypes: ReadonlySet<string>): AreaGroup[] {
  const byKey = new Map<string, { type: string; container: string; members: Set<string> }>();
  for (const e of edges) {
    if (!areaTypes.has(e.type) || e.source === e.target) continue;
    const key = `${e.type}|${e.source}`;
    const g = byKey.get(key) ?? { type: e.type, container: e.source, members: new Set<string>() };
    g.members.add(e.target);
    byKey.set(key, g);
  }
  const containers = new Map<string, string[]>(); // concept -> keys of the areas it contains
  for (const [key, g] of byKey) containers.set(g.container, [...(containers.get(g.container) ?? []), key]);
  const levels = new Map<string, number>();
  const levelOf = (key: string, path: Set<string>): number => {
    const known = levels.get(key);
    if (known !== undefined) return known;
    if (path.has(key)) return 0;
    path.add(key);
    let level = 0;
    for (const m of byKey.get(key)!.members) {
      for (const inner of containers.get(m) ?? []) if (inner !== key) level = Math.max(level, 1 + levelOf(inner, path));
    }
    path.delete(key);
    levels.set(key, level);
    return level;
  };
  const out: AreaGroup[] = [...byKey].map(([key, g]) => ({
    key, type: g.type, container: g.container, members: [...g.members].filter((m) => m !== g.container).sort(), level: levelOf(key, new Set()),
  }));
  return out.sort((a, b) => b.level - a.level || a.key.localeCompare(b.key));
}

/** Padding of an area hull at nesting `level` (outer areas keep a band around the inner ones). */
export const areaPadding = (level: number, base = 16, step = 12): number => base + Math.max(0, level) * step;

/** Line width from the net agreement (agree − disagree): 1.5px with no stances, ±0.5px per stance, bounded 1–4px. */
export function agreementWidth(agree: number, disagree: number): number {
  const net = (Number(agree) || 0) - (Number(disagree) || 0);
  return clamp(1.5 + net * 0.5, 1, 4);
}

/** Contested: at least two stances and no more agreement than disagreement. */
export function isContested(agree: number, disagree: number): boolean {
  const a = Number(agree) || 0, d = Number(disagree) || 0;
  return a + d >= 2 && d >= a;
}

/**
 * Stroke pattern of a relation line: the type's own pattern, or, when the
 * relation is contested, a "broken" version of it (long runs cut by wide
 * gaps) that stays distinct from every plain pattern. Null = solid.
 */
export function edgeDash(stroke: string, contested: boolean): string | null {
  if (!contested) return dashArray(stroke);
  switch (stroke) {
    case 'dashed': return '6 4 6 10';
    case 'dotted': return '2 3 2 10';
    default: return '12 7';
  }
}

export type ArrowMarker = { id: string; color: string; path: string; viewBox: string; size: number };

/**
 * The arrowhead of a type's lines, or null (areas, undirected types, and
 * symmetric types, which read the same both ways). One marker per palette
 * slot, filled in the slot's stroke colour, drawn in user space so it keeps
 * its size whatever the line width.
 */
export function arrowMarker(t: Pick<TypeLike, 'render' | 'arrow' | 'symmetric' | 'color'>): ArrowMarker | null {
  if (t.render === 'area' || t.arrow !== true || t.symmetric === true) return null;
  const slot = /^[a-z]+$/.test(t.color) ? t.color : 'ink';
  return { id: `mm-arrow-${slot}`, color: strokeColor(t.color), path: 'M0,0L10,5L0,10Z', viewBox: '0 0 10 10', size: 9 };
}

export type Sentence = { subject: string; verb: Localized; object: string; inverse: boolean };

/**
 * How a relation reads: "A <label> B"; read from its target (the focused
 * concept is the target) it turns round with the type's other-way label —
 * "B <inverse> A" — when the type has one and is not symmetric. Labels are the
 * concepts' display labels (the caller localizes them).
 */
export function relationSentence(
  e: { source: string; target: string },
  t: Pick<TypeLike, 'label' | 'labelNb' | 'inverseLabel' | 'inverseLabelNb' | 'symmetric'>,
  labels: (id: string) => string,
  focusId: string | null,
  lang: 'en' | 'nb' | 'nn',
): Sentence {
  const inv = focusId !== null && focusId === e.target && focusId !== e.source ? typeInverse(t, lang) : null;
  if (inv) return { subject: labels(e.target), verb: inv, object: labels(e.source), inverse: true };
  return { subject: labels(e.source), verb: typeLabel(t, lang), object: labels(e.target), inverse: false };
}

/**
 * The point where the ray from a box's centre towards `toward` leaves the box
 * (grown by `gap`), so a line ends on a concept's border and its arrowhead
 * shows. The centre itself when `toward` is the centre.
 */
export function clipToBox(toward: Point, box: Box, gap = 0): Point {
  const dx = toward.x - box.x, dy = toward.y - box.y;
  if (!dx && !dy) return { x: box.x, y: box.y };
  const hw = box.w / 2 + gap, hh = box.h / 2 + gap;
  const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  if (s >= 1) return { x: box.x, y: box.y }; // `toward` is inside the box
  return { x: box.x + dx * s, y: box.y + dy * s };
}

/** The segment a→b moved sideways by `d` (positive: to the left of the direction of travel in screen space, y down). */
export function offsetSegment(a: Point, b: Point, d: number): [Point, Point] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len || !d) return [{ ...a }, { ...b }];
  const nx = (dy / len) * d, ny = (-dx / len) * d;
  return [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }];
}

/**
 * Sideways slot of each line so that several relations between the same two
 * concepts sit side by side: for n lines of one pair, slots −(n−1)/2 … (n−1)/2
 * in input order, signed along the pair's canonical direction (so A→B and
 * B→A share one frame).
 */
export function pairSlots(edges: { source: string; target: string }[]): number[] {
  const groups = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const key = e.source < e.target ? `${e.source}\u0000${e.target}` : `${e.target}\u0000${e.source}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const out = edges.map(() => 0);
  for (const idx of groups.values()) {
    idx.forEach((i, j) => {
      const slot = j - (idx.length - 1) / 2;
      const e = edges[i];
      out[i] = (e.source < e.target ? slot : -slot) || 0; // no -0
    });
  }
  return out;
}

/** The next index in a cycle of `n` items after `current` (−1 = none yet) in direction `dir`. */
export function cycleIndex(n: number, current: number, dir: 1 | -1 = 1): number {
  if (n <= 0) return -1;
  if (current < 0 || current >= n) return dir > 0 ? 0 : n - 1;
  return (current + dir + n) % n;
}

// --- timeline (emergence of the graph) ---------------------------------------

export const DAY_MS = 86_400_000;
/** UTC day number of a time. */
const dayOf = (ms: number) => Math.floor(ms / DAY_MS);
/** The last millisecond of UTC day `day` (the slider's threshold for that day). */
export const dayEnd = (day: number): number => (day + 1) * DAY_MS - 1;
/** Creation time of an item; missing or unreadable dates count as "always there". */
const timeOf = (iso: string | null | undefined): number => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
};

export type TimelineItems = {
  nodes: { id: string; createdAt?: string | null }[];
  /** Asserted and inferred relations; an inferred one carries the date of the last relation it rests on (graph payload). */
  edges: { source: string; target: string; type?: string; createdAt?: string | null }[];
  areas?: AreaGroup[];
};
export type VisibleAt = {
  nodes: Set<string>;
  /** Indices into `items.edges`. */
  edges: Set<number>;
  /** Area key → members shown at that date (only areas with a shown container and at least one member). */
  areas: Map<string, string[]>;
};

/**
 * What of the graph exists at time `at` (ms, inclusive): concepts created by
 * then; relations created by then whose two ends exist (an inferred relation
 * therefore appears with the last relation it rests on); areas follow their
 * relations (container → member of the area's type), in the order given.
 * Status and agreement are always the current ones (no history in stage 1).
 */
export function visibleAt(items: TimelineItems, at: number): VisibleAt {
  const nodes = new Set(items.nodes.filter((n) => timeOf(n.createdAt) <= at).map((n) => n.id));
  const edges = new Set<number>();
  const contained = new Set<string>(); // `type|container|member` of the shown relations
  items.edges.forEach((e, i) => {
    if (timeOf(e.createdAt) > at || !nodes.has(e.source) || !nodes.has(e.target)) return;
    edges.add(i);
    contained.add(`${e.type ?? ''}|${e.source}|${e.target}`);
  });
  const areas = new Map<string, string[]>();
  for (const g of items.areas ?? []) {
    if (!nodes.has(g.container)) continue;
    const members = g.members.filter((m) => contained.has(`${g.type}|${g.container}|${m}`));
    if (members.length) areas.set(g.key, members);
  }
  return { nodes, edges, areas };
}

/**
 * The slider's range in UTC days, from the first creation to `now`, and the
 * steps Play walks through: every day on which something was created, then
 * today. Dates after `now` (clock skew) count as today.
 */
export function timelineDays(items: TimelineItems, now: number): { first: number; last: number; steps: number[] } {
  const last = dayOf(now);
  const days = new Set<number>([last]);
  for (const x of [...items.nodes, ...items.edges]) {
    const ms = timeOf(x.createdAt);
    if (Number.isFinite(ms)) days.add(Math.min(last, dayOf(ms)));
  }
  const steps = [...days].sort((a, b) => a - b);
  return { first: steps[0], last, steps };
}

/** The next (dir 1) or previous (dir -1) step after `day`, or null at the end. */
export function stepDay(steps: number[], day: number, dir: 1 | -1): number | null {
  if (dir > 0) return steps.find((s) => s > day) ?? null;
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i] < day) return steps[i];
  return null;
}
