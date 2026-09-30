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
