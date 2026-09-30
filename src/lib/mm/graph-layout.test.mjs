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
  hullPolygon, hullPath, hullLabelAnchor, areaGroups, areaPadding, agreementWidth, isContested, edgeDash, arrowMarker,
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

test('hullLabelAnchor: middle of the highest side', () => {
  assert.deepEqual(hullLabelAnchor([[0, 10], [0, 0], [20, 0], [20, 10]]), { x: 10, y: 0 });
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
