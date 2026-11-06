import test from 'node:test';
import assert from 'node:assert/strict';
import { createFatalLogger } from './fatal-log.ts';

const setup = (opts = {}) => {
  let t = 0;
  const lines = [];
  const log = createFatalLogger({ now: () => t, write: (e) => lines.push(e), ...opts });
  return { log, lines, advance: (ms) => { t += ms; } };
};

test('logs the first occurrence and suppresses repeats inside the window', () => {
  const { log, lines, advance } = setup({ windowMs: 1000 });
  for (let i = 0; i < 50; i += 1) { log('a', { n: i }); advance(10); }
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], { n: 0 });
});

test('reports how many repeats were suppressed once the window has passed', () => {
  const { log, lines, advance } = setup({ windowMs: 1000 });
  log('a', { n: 0 });
  log('a', { n: 1 });
  log('a', { n: 2 });
  advance(1500);
  log('a', { n: 3 });
  assert.equal(lines.length, 2);
  assert.equal(lines[1].repeatedSincePreviousLog, 2);
});

test('distinct failures are logged independently', () => {
  const { log, lines } = setup();
  log('a', { n: 1 });
  log('b', { n: 2 });
  assert.equal(lines.length, 2);
});

test('memory stays bounded when many distinct keys arrive', () => {
  const { log, lines } = setup({ maxKeys: 3 });
  for (let i = 0; i < 10; i += 1) log(`k${i}`, { i });
  assert.equal(lines.length, 10);
});
