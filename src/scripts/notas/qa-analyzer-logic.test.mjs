// src/scripts/notas/qa-analyzer-logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFrequency, computeKwic, STOPWORDS } from './qa-analyzer-logic.ts';

test('computeFrequency returns top words excluding stopwords', () => {
  const text = 'música ritmo música tiempo ritmo música la la la el el';
  const result = computeFrequency(text, 5);
  assert.equal(result[0].word, 'música');
  assert.equal(result[0].count, 3);
  assert.equal(result[1].word, 'ritmo');
  assert.equal(result[1].count, 2);
  // Stopwords 'la' and 'el' must not appear
  assert.ok(!result.find(r => r.word === 'la'));
  assert.ok(!result.find(r => r.word === 'el'));
});

test('computeFrequency pct: top word is always 100', () => {
  const text = 'abc abc abc xyz xyz';
  const result = computeFrequency(text, 10);
  assert.equal(result[0].pct, 100);
  assert.ok(result[1].pct < 100);
});

test('computeKwic finds all occurrences with context', () => {
  const text = 'la música es bella. Sin música no hay vida. Música everywhere.';
  const lines = computeKwic(text, 'música', 10);
  assert.equal(lines.length, 3);
  assert.ok(lines[0].match.toLowerCase() === 'música');
  assert.ok(lines[0].before.length <= 10);
  assert.ok(lines[0].after.length <= 10);
});

test('computeKwic returns empty for missing word', () => {
  const lines = computeKwic('hello world', 'xyz');
  assert.deepEqual(lines, []);
});

test('computeKwic is case-insensitive', () => {
  const lines = computeKwic('Música y música y MÚSICA', 'música');
  assert.equal(lines.length, 3);
});
