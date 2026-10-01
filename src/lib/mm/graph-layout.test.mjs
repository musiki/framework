import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateLabel, boxesOverlap, hiddenByOverlap, boundsOf, fitTransform, linkDistance, levelOfDetail, placeCard, shouldDock } from './graph-layout.ts';

test('truncateLabel keeps short labels and folds long ones with an ellipsis', () => {
  assert.equal(truncateLabel('Sonic ecology', 18), 'Sonic ecology');
  assert.equal(truncateLabel('  Sonic   ecology ', 18), 'Sonic ecology');
  const folded = truncateLabel('Acousmatic listening practices in urban space', 18);
  assert.ok(Array.from(folded).length <= 18, folded);
  assert.ok(folded.endsWith('…'));
  assert.equal(folded, 'Acousmatic listen…');
  assert.equal(truncateLabel('Acousmatic listening practices', 14), 'Acousmatic…');
  // no usable word boundary: hard cut
  assert.equal(truncateLabel('Hyperinstrumentalisation', 10), 'Hyperinst…');
  // code points, not UTF-16 units
  assert.equal(Array.from(truncateLabel('𝄞𝄞𝄞𝄞𝄞𝄞𝄞𝄞', 5)).length, 5);
  // trailing punctuation is dropped before the ellipsis
  assert.equal(truncateLabel('Noise, signal and meaning', 8), 'Noise…');
  assert.equal(truncateLabel('abc', 1), 'a');
});

test('boxesOverlap on centred boxes, with gap', () => {
  const a = { x: 0, y: 0, w: 20, h: 10 };
  assert.equal(boxesOverlap(a, { x: 19, y: 0, w: 20, h: 10 }), true);
  assert.equal(boxesOverlap(a, { x: 21, y: 0, w: 20, h: 10 }), false);
  assert.equal(boxesOverlap(a, { x: 20, y: 0, w: 20, h: 10 }), false); // touching is not overlapping
  assert.equal(boxesOverlap(a, { x: 20.5, y: 0, w: 20, h: 10 }, 1), true);
  assert.equal(boxesOverlap(a, { x: 0, y: 11, w: 20, h: 10 }), false);
});

test('hiddenByOverlap keeps the first of a clash, respects obstacles and forced labels', () => {
  const labels = [
    { x: 0, y: 0, w: 40, h: 12 },
    { x: 10, y: 2, w: 40, h: 12 }, // overlaps 0
    { x: 200, y: 0, w: 40, h: 12 }, // free
    { x: 100, y: 0, w: 40, h: 12 }, // on a node
  ];
  const nodes = [{ x: 100, y: 0, w: 60, h: 24 }];
  assert.deepEqual([...hiddenByOverlap(labels, nodes)].sort(), [1, 3]);
  // a forced (highlighted) label wins over an earlier one and ignores obstacles
  assert.deepEqual([...hiddenByOverlap(labels, nodes, new Set([1, 3]))].sort(), [0]);
  assert.equal(hiddenByOverlap([]).size, 0);
});

test('boundsOf', () => {
  assert.equal(boundsOf([]), null);
  assert.deepEqual(boundsOf([{ x: 0, y: 0, w: 10, h: 4 }, { x: 100, y: 50, w: 20, h: 10 }]), { x0: -5, y0: -2, x1: 110, y1: 55 });
});

test('fitTransform centres and scales the spread of the centres', () => {
  const pts = [{ x: 0, y: 0 }, { x: 400, y: 200 }];
  const t = fitTransform(pts, 800, 500, { x: 100, y: 50 });
  // available 600 x 400 for a 400 x 200 spread -> k = min(1.5, 2) = 1.5
  assert.equal(t.k, 1.5);
  // centre (200, 100) maps to the view centre (400, 250)
  assert.equal(200 * t.k + t.x, 400);
  assert.equal(100 * t.k + t.y, 250);
  // clamped to the scale extent
  assert.equal(fitTransform([{ x: 0, y: 0 }, { x: 1, y: 1 }], 800, 500, { x: 10, y: 10 }).k, 4);
  assert.equal(fitTransform([{ x: 0, y: 0 }, { x: 1e5, y: 0 }], 375, 420, { x: 10, y: 10 }).k, 0.2);
  // one node: centred at k = 1
  assert.deepEqual(fitTransform([{ x: 10, y: 20 }], 300, 200, { x: 0, y: 0 }), { k: 1, x: 140, y: 80 });
  assert.deepEqual(fitTransform([], 300, 200, { x: 0, y: 0 }), { k: 1, x: 150, y: 100 });
});

test('linkDistance grows with the label and box widths, with a floor', () => {
  assert.equal(linkDistance(0, 0, 0), 90);
  assert.ok(linkDistance(120, 120, 60) > linkDistance(60, 60, 30));
});

test('levelOfDetail thresholds and the show-all toggle', () => {
  assert.deepEqual(levelOfDetail(1, false), { fullLabels: false, edgeLabels: true });
  assert.deepEqual(levelOfDetail(0.5, false), { fullLabels: false, edgeLabels: false });
  assert.deepEqual(levelOfDetail(2, false), { fullLabels: true, edgeLabels: true });
  assert.deepEqual(levelOfDetail(0.3, true), { fullLabels: true, edgeLabels: true });
});

test('placeCard: right of the node, flipping left / below / above near the edges, always inside the frame', () => {
  const frame = { w: 800, h: 520 };
  const card = { w: 280, h: 140 };
  const node = (x, y) => ({ x, y, w: 100, h: 26 });
  assert.deepEqual(placeCard(node(200, 260), card, frame), { x: 258, y: 190, side: 'right' });
  const l = placeCard(node(700, 260), card, frame);
  assert.equal(l.side, 'left');
  assert.equal(l.x, 700 - 50 - 8 - 280);
  // narrow frame: neither side fits, below the node
  const b = placeCard(node(150, 100), card, { w: 320, h: 520 });
  assert.equal(b.side, 'below');
  assert.equal(b.y, 100 + 13 + 8);
  // narrow and near the bottom: above
  const a = placeCard(node(150, 480), card, { w: 320, h: 520 });
  assert.equal(a.side, 'above');
  assert.equal(a.y, 480 - 13 - 8 - 140);
  // vertical clamping at the top edge
  assert.equal(placeCard(node(200, 5), card, frame).y, 4);
  // nothing fits: clamped, still inside
  const c = placeCard(node(100, 60), { w: 300, h: 300 }, { w: 320, h: 320 });
  assert.equal(c.side, 'clamped');
  assert.ok(c.x >= 0 && c.x + 300 <= 320 && c.y >= 0 && c.y + 300 <= 320);
  // a card bigger than the frame does not go negative
  const big = placeCard(node(50, 50), { w: 900, h: 700 }, frame);
  assert.ok(big.x >= 0 && big.y >= 0);
});

test('shouldDock: phone-width frames dock the card', () => {
  assert.equal(shouldDock(375), true);
  assert.equal(shouldDock(479), true);
  assert.equal(shouldDock(480), false);
  assert.equal(shouldDock(800), false);
});

// ---------------------------------------------------------------------------
// Typed relations
// ---------------------------------------------------------------------------

import {
  hullPolygon, hullPath, hullLabelAnchor, areaLabelSide, areaGroups, areaPadding, agreementWidth, isContested, edgeDash, arrowMarker,
  relationSentence, clipToBox, offsetSegment, pairSlots, cycleIndex,
} from './graph-layout.ts';

test('hullPolygon wraps every box with the padding; straight sides, sharp corners', () => {
  const boxes = [{ x: 0, y: 0, w: 40, h: 20 }, { x: 100, y: 0, w: 20, h: 20 }, { x: 50, y: 80, w: 10, h: 10 }];
  const poly = hullPolygon(boxes, 10);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  assert.equal(Math.min(...xs), -30); // 0 - 20 - 10
  assert.equal(Math.max(...xs), 120); // 100 + 10 + 10
  assert.equal(Math.min(...ys), -20);
  assert.equal(Math.max(...ys), 95); // 80 + 5 + 10
  // Every vertex is a padded box corner (no arcs, no extra points).
  const corners = new Set(boxes.flatMap((b) => [-1, 1].flatMap((sx) => [-1, 1].map((sy) => `${b.x + sx * (b.w / 2 + 10)},${b.y + sy * (b.h / 2 + 10)}`))));
  for (const [x, y] of poly) assert.ok(corners.has(`${x},${y}`), `${x},${y}`);
  // Every padded box lies inside the hull (convex polygon, counter-clockwise in d3's orientation).
  const inside = ([px, py]) => poly.every(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length];
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax) <= 1e-9;
  }) || poly.every(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length];
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax) >= -1e-9;
  });
  for (const c of corners) assert.ok(inside(c.split(',').map(Number)), c);
});

test('hullPolygon: one box is its padded rectangle; nothing to wrap is null; bad coordinates skipped', () => {
  const one = hullPolygon([{ x: 10, y: 10 }], 5);
  assert.equal(one.length, 4);
  assert.deepEqual(new Set(one.map((p) => p.join(','))), new Set(['5,5', '15,5', '15,15', '5,15']));
  assert.equal(hullPolygon([], 5), null);
  assert.equal(hullPolygon([{ x: NaN, y: 0 }], 5), null);
  // Degenerate (points on a line, no size, no padding): the two extremes.
  assert.deepEqual(new Set(hullPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0).map((p) => p.join(','))), new Set(['0,0', '10,0']));
});

test('hullPath is straight segments only (M/L/Z), rounded to 0.1px; nested padding encloses the inner hull', () => {
  const d = hullPath([{ x: 0, y: 0, w: 20, h: 10 }, { x: 60.04, y: 30 }], 8);
  assert.match(d, /^M[-\d.,]+(L[-\d.,]+)+Z$/);
  assert.doesNotMatch(d, /[AQCST]/);
  assert.ok(d.includes('68'), d);
  assert.equal(hullPath([], 8), '');
  // Outer area (more padding, a superset of boxes) contains every inner vertex.
  const inner = [{ x: 0, y: 0, w: 30, h: 20 }, { x: 50, y: 40, w: 30, h: 20 }];
  const outer = [...inner, { x: -60, y: 30, w: 30, h: 20 }];
  const pi = hullPolygon(inner, areaPadding(0)), po = hullPolygon(outer, areaPadding(1));
  const cross = (poly, [px, py]) => poly.map(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length];
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  });
  for (const v of pi) {
    const c = cross(po, v);
    assert.ok(c.every((x) => x <= 1e-9) || c.every((x) => x >= -1e-9), `inner vertex ${v} outside the outer hull`);
  }
  assert.equal(areaPadding(0), 16);
  assert.equal(areaPadding(2), 40);
});

test('hullLabelAnchor: middle of the highest (or lowest) side; nested levels alternate', () => {
  assert.deepEqual(hullLabelAnchor([[0, 10], [0, 0], [20, 0], [20, 10]]), { x: 10, y: 0 });
  assert.deepEqual(hullLabelAnchor([[0, 10], [0, 0], [20, 0], [20, 10]], 'bottom'), { x: 10, y: 10 });
  assert.equal(areaLabelSide(0), 'bottom');
  assert.equal(areaLabelSide(1), 'top');
  assert.equal(areaLabelSide(2), 'bottom');
  assert.deepEqual(hullLabelAnchor([[5, 5]]), { x: 5, y: 5 });
  assert.equal(hullLabelAnchor(null), null);
});

test('areaGroups: one area per (type, container); inferred members; nesting levels; outermost first', () => {
  const edges = [
    { source: 'technics', target: 'memory', type: 'contains' },
    { source: 'memory', target: 'pharmakon', type: 'contains' },
    { source: 'memory', target: 'archive', type: 'contains' },
    { source: 'technics', target: 'pharmakon', type: 'contains', inferred: true },
    { source: 'technics', target: 'archive', type: 'contains', inferred: true },
    { source: 'memory', target: 'technics', type: 'derives' }, // not an area type
  ];
  const g = areaGroups(edges, new Set(['contains']));
  assert.deepEqual(g, [
    { key: 'contains|technics', type: 'contains', container: 'technics', members: ['archive', 'memory', 'pharmakon'], level: 1 },
    { key: 'contains|memory', type: 'contains', container: 'memory', members: ['archive', 'pharmakon'], level: 0 },
  ]);
  // A cycle (bad data) terminates.
  const cyc = areaGroups([{ source: 'a', target: 'b', type: 'x' }, { source: 'b', target: 'a', type: 'x' }], new Set(['x']));
  assert.equal(cyc.length, 2);
  assert.deepEqual(areaGroups(edges, new Set()), []);
});

test('agreementWidth: 1.5px with no stances, net agreement moves it, bounded 1–4px', () => {
  assert.equal(agreementWidth(0, 0), 1.5);
  assert.equal(agreementWidth(1, 0), 2);
  assert.equal(agreementWidth(3, 1), 2.5);
  assert.equal(agreementWidth(10, 0), 4);
  assert.equal(agreementWidth(0, 1), 1);
  assert.equal(agreementWidth(0, 9), 1);
  assert.equal(agreementWidth(undefined, null), 1.5);
});

test('isContested: disagree >= agree with at least two stances', () => {
  assert.equal(isContested(0, 0), false);
  assert.equal(isContested(0, 1), false); // one stance is not a contest
  assert.equal(isContested(1, 1), true);
  assert.equal(isContested(0, 2), true);
  assert.equal(isContested(2, 3), true);
  assert.equal(isContested(3, 2), false);
  assert.equal(isContested(2, 0), false);
});

test('edgeDash: the type pattern, or a broken one when contested (distinct from every plain pattern)', () => {
  assert.equal(edgeDash('solid', false), null);
  assert.equal(edgeDash('double', false), null);
  assert.equal(edgeDash('dashed', false), '6 4');
  assert.equal(edgeDash('dotted', false), '2 3');
  const plain = new Set(['solid', 'dashed', 'dotted', 'double'].map((s) => edgeDash(s, false)));
  for (const s of ['solid', 'dashed', 'dotted', 'double']) {
    const c = edgeDash(s, true);
    assert.ok(c && !plain.has(c), `${s}: ${c}`);
  }
});

test('arrowMarker: one per palette slot, none for areas, undirected or symmetric types', () => {
  const base = { render: 'line', arrow: true, symmetric: false, color: 'purple' };
  assert.deepEqual(arrowMarker(base), { id: 'mm-arrow-purple', color: 'var(--mm-purple-text)', path: 'M0,0L10,5L0,10Z', viewBox: '0 0 10 10', size: 9 });
  assert.equal(arrowMarker({ ...base, color: 'green' }).color, 'var(--mm-green)');
  assert.equal(arrowMarker({ ...base, symmetric: true }), null);
  assert.equal(arrowMarker({ ...base, arrow: false }), null);
  assert.equal(arrowMarker({ ...base, render: 'area' }), null);
  assert.equal(arrowMarker({ ...base, color: 'x"><script' }).id, 'mm-arrow-ink');
});

test('relationSentence: A label B; read from the focused target it turns round with the inverse label', () => {
  const labels = (id) => ({ tech: 'Technics', mem: 'Memory' })[id];
  const contains = { label: 'contains', labelNb: 'inneholder', inverseLabel: 'is contained in', inverseLabelNb: 'er inneholdt i', symmetric: false };
  const e = { source: 'tech', target: 'mem' };
  assert.deepEqual(relationSentence(e, contains, labels, null, 'en'), { subject: 'Technics', verb: { text: 'contains', lang: 'en' }, object: 'Memory', inverse: false });
  assert.deepEqual(relationSentence(e, contains, labels, 'tech', 'en').inverse, false);
  assert.deepEqual(relationSentence(e, contains, labels, 'mem', 'en'), { subject: 'Memory', verb: { text: 'is contained in', lang: 'en' }, object: 'Technics', inverse: true });
  assert.deepEqual(relationSentence(e, contains, labels, 'mem', 'nb').verb, { text: 'er inneholdt i', lang: 'nb' });
  // Symmetric, or no inverse: always source first.
  const contrasts = { label: 'contrasts with', inverseLabel: null, symmetric: true };
  assert.equal(relationSentence(e, contrasts, labels, 'mem', 'en').subject, 'Technics');
  assert.equal(relationSentence(e, { ...contains, inverseLabel: null, inverseLabelNb: null }, labels, 'mem', 'en').inverse, false);
});

test('clipToBox: where the line leaves the box (plus a gap)', () => {
  const box = { x: 0, y: 0, w: 40, h: 20 };
  assert.deepEqual(clipToBox({ x: 100, y: 0 }, box), { x: 20, y: 0 });
  assert.deepEqual(clipToBox({ x: 0, y: -100 }, box, 2), { x: 0, y: -12 });
  const p = clipToBox({ x: 100, y: 100 }, box);
  assert.deepEqual(p, { x: 10, y: 10 }); // the top/bottom side is hit first
  assert.deepEqual(clipToBox({ x: 0, y: 0 }, box), { x: 0, y: 0 });
  assert.deepEqual(clipToBox({ x: 5, y: 0 }, box), { x: 0, y: 0 }); // inside
});

test('offsetSegment shifts sideways; pairSlots spreads relations between the same two concepts', () => {
  assert.deepEqual(offsetSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 2), [{ x: 0, y: -2 }, { x: 10, y: -2 }]);
  assert.deepEqual(offsetSegment({ x: 0, y: 0 }, { x: 0, y: 0 }, 2), [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
  const slots = pairSlots([
    { source: 'a', target: 'b' }, { source: 'b', target: 'a' }, { source: 'a', target: 'c' }, { source: 'a', target: 'b' },
  ]);
  assert.deepEqual(slots, [-1, 0, 0, 1]);
  // Reversed direction flips the sign: offsetSegment's side follows the direction of travel, so
  // a→b at −0.5 and b→a at −0.5 (its own frame) sit on opposite sides of the pair's axis.
  assert.deepEqual(pairSlots([{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }]), [-0.5, -0.5]);
  const [ab] = offsetSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, -0.5 * 6);
  const [ba] = offsetSegment({ x: 10, y: 0 }, { x: 0, y: 0 }, -0.5 * 6);
  assert.ok(ab.y * ba.y < 0);
});

test('cycleIndex', () => {
  assert.equal(cycleIndex(3, -1), 0);
  assert.equal(cycleIndex(3, -1, -1), 2);
  assert.equal(cycleIndex(3, 2), 0);
  assert.equal(cycleIndex(3, 0, -1), 2);
  assert.equal(cycleIndex(0, 0), -1);
});

// --- timeline -------------------------------------------------------------
import { visibleAt, timelineDays, stepDay, dayEnd, DAY_MS } from './graph-layout.ts';

const D = (s) => Date.parse(`${s}T12:00:00Z`);
const tl = {
  nodes: [
    { id: 'technics', createdAt: '2026-01-01T09:00:00Z' },
    { id: 'memory', createdAt: '2026-01-03T09:00:00Z' },
    { id: 'pharmakon', createdAt: '2026-01-05T09:00:00Z' },
    { id: 'legacy', createdAt: '' }, // unknown date: there from the start
  ],
  edges: [
    { source: 'technics', target: 'memory', type: 'contains', createdAt: '2026-01-04T10:00:00Z' },
    { source: 'memory', target: 'pharmakon', type: 'contains', createdAt: '2026-01-06T10:00:00Z' },
    { source: 'technics', target: 'pharmakon', type: 'contains', inferred: true, createdAt: '2026-01-06T10:00:00Z' },
    { source: 'pharmakon', target: 'technics', type: 'derives', createdAt: '2026-01-02T10:00:00Z' }, // older than an end (bad data)
    { source: 'legacy', target: 'technics', type: 'derives', createdAt: null },
  ],
  areas: [
    { key: 'contains|technics', type: 'contains', container: 'technics', members: ['memory', 'pharmakon'], level: 1 },
    { key: 'contains|memory', type: 'contains', container: 'memory', members: ['pharmakon'], level: 0 },
  ],
};

test('visibleAt: concepts by createdAt; a relation only when it and both ends exist', () => {
  const a = visibleAt(tl, D('2026-01-02'));
  assert.deepEqual([...a.nodes].sort(), ['legacy', 'technics']);
  assert.deepEqual([...a.edges], [4]); // the pharmakon→technics line waits for pharmakon
  assert.equal(a.areas.size, 0);
  const b = visibleAt(tl, D('2026-01-04'));
  assert.deepEqual([...b.nodes].sort(), ['legacy', 'memory', 'technics']);
  assert.deepEqual([...b.edges].sort(), [0, 4]);
  assert.deepEqual([...b.areas], [['contains|technics', ['memory']]]); // areas follow their relations
  const c = visibleAt(tl, D('2026-01-05'));
  assert.deepEqual([...c.edges].sort(), [0, 3, 4]);
  assert.deepEqual([...c.areas], [['contains|technics', ['memory']]]); // pharmakon exists, its area relation not yet
});

test('visibleAt: an inferred relation appears with the last relation it rests on', () => {
  const before = visibleAt(tl, Date.parse('2026-01-06T09:59:59Z'));
  assert.ok(!before.edges.has(2) && !before.edges.has(1));
  const after = visibleAt(tl, Date.parse('2026-01-06T10:00:00Z')); // inclusive
  assert.ok(after.edges.has(1) && after.edges.has(2));
  assert.deepEqual([...after.areas], [['contains|technics', ['memory', 'pharmakon']], ['contains|memory', ['pharmakon']]]);
  // Now: everything.
  const now = visibleAt(tl, Infinity);
  assert.equal(now.nodes.size, 4);
  assert.equal(now.edges.size, 5);
  // Without areas the map is empty.
  assert.equal(visibleAt({ nodes: tl.nodes, edges: tl.edges }, Infinity).areas.size, 0);
});

test('timelineDays: first creation day to today, stepping through distinct creation days', () => {
  const now = D('2026-01-10');
  const t = timelineDays(tl, now);
  const day = (s) => Math.floor(D(s) / DAY_MS);
  assert.equal(t.first, day('2026-01-01'));
  assert.equal(t.last, day('2026-01-10'));
  assert.deepEqual(t.steps, ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-10'].map(day));
  // Future dates (clock skew) are clamped to today; no dates at all → one day.
  const skew = timelineDays({ nodes: [{ id: 'x', createdAt: '2027-01-01T00:00:00Z' }], edges: [] }, now);
  assert.deepEqual(skew, { first: day('2026-01-10'), last: day('2026-01-10'), steps: [day('2026-01-10')] });
  assert.deepEqual(timelineDays({ nodes: [], edges: [] }, now).steps, [day('2026-01-10')]);
  // dayEnd is the last millisecond of the UTC day.
  assert.equal(dayEnd(day('2026-01-04')), Date.parse('2026-01-04T23:59:59.999Z'));
});

test('stepDay: next / previous creation day, null at the ends', () => {
  const steps = [10, 12, 15, 20];
  assert.equal(stepDay(steps, 10, 1), 12);
  assert.equal(stepDay(steps, 11, 1), 12);
  assert.equal(stepDay(steps, 13, -1), 12);
  assert.equal(stepDay(steps, 12, -1), 10);
  assert.equal(stepDay(steps, 20, 1), null);
  assert.equal(stepDay(steps, 10, -1), null);
  assert.equal(stepDay([], 3, 1), null);
});

import { cloudPolygon, cloudLabelAnchor, polygonPath, slideAlong } from './graph-layout.ts';

/** Signed cross products of point p against every side of a polygon (all one sign: inside or on). */
const sides = (poly, [px, py]) => poly.map(([ax, ay], i) => {
  const [bx, by] = poly[(i + 1) % poly.length];
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
});
const insidePoly = (poly, p) => { const c = sides(poly, p); return c.every((x) => x <= 1e-6) || c.every((x) => x >= -1e-6); };
const isConvex = (poly) => {
  const turns = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
  return turns.every((x) => x <= 1e-6) || turns.every((x) => x >= -1e-6);
};

test('cloudPolygon: a faceted, convex, straight-edged region round every box and its padding', () => {
  const boxes = [{ x: 0, y: 0, w: 60, h: 26 }, { x: 160, y: 20, w: 80, h: 26 }, { x: 70, y: 120, w: 50, h: 26 }];
  const pad = 16;
  const poly = cloudPolygon(boxes, pad);
  assert.ok(poly.length > hullPolygon(boxes, pad).length, 'more vertices than the plain hull');
  assert.ok(isConvex(poly));
  // Every box with a cut-corner padding (the box itself grown by pad, corners cut) lies inside.
  for (const b of boxes) {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      assert.ok(insidePoly(poly, [b.x + sx * (b.w / 2 + pad / 2), b.y + sy * (b.h / 2 + pad / 2)]), `${b.x},${b.y}`);
      assert.ok(insidePoly(poly, [b.x + sx * b.w / 2, b.y + sy * (b.h / 2 + pad)]), 'padding above/below the box');
    }
  }
  // Straight segments only in its path.
  const d = polygonPath(poly);
  assert.match(d, /^M[-\d.,]+(L[-\d.,]+)+Z$/);
  assert.doesNotMatch(d, /[AQCST]/);
  // Deterministic.
  assert.deepEqual(cloudPolygon(boxes, pad), poly);
});

test('cloudPolygon: one box is a cut-corner octagon; empty input is null; nested padding encloses the inner cloud', () => {
  const one = cloudPolygon([{ x: 0, y: 0, w: 20, h: 10 }], 6);
  assert.equal(one.length, 8);
  assert.ok(isConvex(one));
  assert.equal(cloudPolygon([], 6), null);
  assert.equal(cloudPolygon([{ x: NaN, y: 1 }], 6), null);
  assert.equal(polygonPath(null), '');
  const inner = [{ x: 0, y: 0, w: 30, h: 20 }, { x: 50, y: 40, w: 30, h: 20 }];
  const outer = [...inner, { x: -60, y: 30, w: 30, h: 20 }];
  const pi = cloudPolygon(inner, areaPadding(0)), po = cloudPolygon(outer, areaPadding(1));
  for (const v of pi) assert.ok(insidePoly(po, v), `inner vertex ${v} outside the outer cloud`);
});

test('cloudLabelAnchor: on the outline straight above (or below) the middle of the cloud', () => {
  const sq = [[0, 10], [0, 0], [20, 0], [20, 10]];
  assert.deepEqual(cloudLabelAnchor(sq), { x: 10, y: 0 });
  assert.deepEqual(cloudLabelAnchor(sq, 'bottom'), { x: 10, y: 10 });
  const poly = cloudPolygon([{ x: 0, y: 0, w: 40, h: 20 }, { x: 100, y: 30, w: 40, h: 20 }], 12);
  const top = cloudLabelAnchor(poly);
  const ys = poly.map((p) => p[1]);
  assert.ok(Math.abs(top.x - (Math.min(...poly.map((p) => p[0])) + Math.max(...poly.map((p) => p[0]))) / 2) < 1e-9);
  assert.ok(top.y >= Math.min(...ys) - 1e-9 && top.y < 0, `${top.y}`);
  assert.ok(insidePoly(poly, [top.x, top.y + 0.01]) && !insidePoly(poly, [top.x, top.y - 0.5]));
  assert.ok(cloudLabelAnchor(poly, 'bottom').y > 30);
  assert.equal(cloudLabelAnchor(null), null);
});

test('slideAlong: the label stays on its segment, centred unless pushed along it', () => {
  const p = { x: 0, y: 0 }, q = { x: 100, y: 0 };
  assert.deepEqual(slideAlong(p, q, { x: 0, y: 0 }), { x: 50, y: 0 });
  // A push across the line is dropped; one along it moves the label, kept clear of the ends.
  assert.deepEqual(slideAlong(p, q, { x: 0, y: 30 }), { x: 50, y: 0 });
  assert.deepEqual(slideAlong(p, q, { x: 20, y: 30 }), { x: 70, y: 0 });
  assert.deepEqual(slideAlong(p, q, { x: 500, y: 0 }, { w: 40, h: 10 }), { x: 80, y: 0 });
  // Diagonal: the result is on the line.
  const r = slideAlong({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 10, y: -3 });
  assert.ok(Math.abs(r.x - r.y) < 1e-9);
  // A label longer than its line stays at the middle.
  assert.deepEqual(slideAlong(p, { x: 10, y: 0 }, { x: 5, y: 0 }, { w: 40, h: 10 }), { x: 5, y: 0 });
  assert.deepEqual(slideAlong(p, p, { x: 5, y: 5 }), { x: 0, y: 0 });
});

import { pointInPolygon, escapeVector } from './graph-layout.ts';

test('pointInPolygon: inside, outside, degenerate', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon({ x: 5, y: 5 }, sq), true);
  assert.equal(pointInPolygon({ x: 15, y: 5 }, sq), false);
  assert.equal(pointInPolygon({ x: -1, y: -1 }, sq), false);
  const cloud = cloudPolygon([{ x: 0, y: 0, w: 60, h: 26 }, { x: 120, y: 40, w: 60, h: 26 }], 16);
  assert.equal(pointInPolygon({ x: 60, y: 20 }, cloud), true);
  assert.equal(pointInPolygon({ x: 60, y: 200 }, cloud), false);
  assert.equal(pointInPolygon({ x: 0, y: 0 }, null), false);
  assert.equal(pointInPolygon({ x: 0, y: 0 }, [[0, 0], [1, 1]]), false);
});

test('escapeVector: null when apart; the shortest way out otherwise, and moving by it clears the polygon', () => {
  const sq = [[0, 0], [100, 0], [100, 60], [0, 60]];
  assert.equal(escapeVector({ x: 200, y: 30, w: 40, h: 20 }, sq), null);
  assert.equal(escapeVector({ x: 125, y: 30, w: 40, h: 20 }, sq), null); // touching edge at x = 105 > 100
  // Overlapping the right side by 15px: out to the right.
  const e = escapeVector({ x: 105, y: 30, w: 40, h: 20 }, sq);
  assert.ok(Math.abs(e.x - 15) < 1e-9 && Math.abs(e.y) < 1e-9 && Math.abs(e.depth - 15) < 1e-9, JSON.stringify(e));
  // With a gap the move goes that much further.
  assert.ok(Math.abs(escapeVector({ x: 105, y: 30, w: 40, h: 20 }, sq, 5).depth - 20) < 1e-9);
  // Deep inside near the top: out through the top.
  const t = escapeVector({ x: 50, y: 12, w: 20, h: 10 }, sq);
  assert.ok(t.y < 0 && Math.abs(t.x) < 1e-9 && Math.abs(t.depth - 17) < 1e-9, JSON.stringify(t));
  // On a faceted cloud: after the move, no corner of the box is inside and the box no longer overlaps.
  const cloud = cloudPolygon([{ x: 0, y: 0, w: 60, h: 26 }, { x: 140, y: 50, w: 60, h: 26 }, { x: 40, y: 120, w: 60, h: 26 }], 28);
  for (const b of [{ x: 70, y: 60, w: 90, h: 26 }, { x: 190, y: 90, w: 80, h: 26 }, { x: -40, y: 70, w: 70, h: 26 }]) {
    const v = escapeVector(b, cloud, 4);
    assert.ok(v && v.depth > 0, JSON.stringify(b));
    const moved = { ...b, x: b.x + v.x, y: b.y + v.y };
    assert.equal(escapeVector(moved, cloud, 3.9), null, JSON.stringify(moved));
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      assert.equal(pointInPolygon({ x: moved.x + sx * moved.w / 2, y: moved.y + sy * moved.h / 2 }, cloud), false);
    }
  }
  assert.equal(escapeVector({ x: 0, y: 0, w: 1, h: 1 }, null), null);
  // A reusable result object is filled in and returned.
  const scratch = { x: 0, y: 0, depth: 0 };
  assert.equal(escapeVector({ x: 105, y: 30, w: 40, h: 20 }, sq, 0, scratch), scratch);
  assert.ok(Math.abs(scratch.x - 15) < 1e-9 && Math.abs(scratch.depth - 15) < 1e-9);
  assert.equal(escapeVector({ x: 300, y: 30, w: 40, h: 20 }, sq, 0, scratch), null);
});
