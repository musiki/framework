// Pure layout helpers for the mm concept graph (src/scripts/mm/graph.ts).
// No DOM, no D3: label folding, boxes, overlap checks and the fit-to-view
// transform, so they can be unit tested with node --test.

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
