import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollTopToReveal } from './trace-layout.ts';

const base = { scrollTop: 100, viewHeight: 200 };

test('block already visible keeps scroll position', () => {
  assert.equal(scrollTopToReveal({ ...base, blockTop: 150, blockHeight: 50 }), 100);
});
test('block above the view scrolls up to its top', () => {
  assert.equal(scrollTopToReveal({ ...base, blockTop: 40, blockHeight: 50 }), 40);
});
test('block below the view scrolls down just enough', () => {
  assert.equal(scrollTopToReveal({ ...base, blockTop: 350, blockHeight: 50 }), 200);
});
test('block taller than the view aligns to its top', () => {
  assert.equal(scrollTopToReveal({ ...base, blockTop: 400, blockHeight: 500 }), 400);
});
test('sticky offset reserves room at the top', () => {
  assert.equal(scrollTopToReveal({ ...base, blockTop: 110, blockHeight: 50, stickyOffset: 20 }), 90);
});
test('never returns a negative scrollTop', () => {
  assert.equal(scrollTopToReveal({ scrollTop: 10, viewHeight: 100, blockTop: 0, blockHeight: 20 }), 0);
});
