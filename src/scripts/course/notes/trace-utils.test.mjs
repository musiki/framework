import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { segmentParagraphs, computeOrphanLabels } from './trace-utils.mjs';

describe('segmentParagraphs', () => {
  test('splits on double newline', () => {
    const result = segmentParagraphs('First.\n\nSecond.');
    assert.equal(result.length, 2);
    assert.equal(result[0].text, 'First.');
    assert.equal(result[0].index, 0);
    assert.equal(result[1].text, 'Second.');
    assert.equal(result[1].index, 1);
  });

  test('from/to positions slice correctly', () => {
    const md = 'Hello\n\nWorld';
    const [a, b] = segmentParagraphs(md);
    assert.equal(md.slice(a.from, a.to), 'Hello');
    assert.equal(md.slice(b.from, b.to), 'World');
  });

  test('filters empty segments', () => {
    const result = segmentParagraphs('\n\nOnly one.\n\n\n');
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'Only one.');
  });

  test('splits on HR separator', () => {
    const result = segmentParagraphs('Before\n---\nAfter');
    assert.equal(result.length, 2);
    assert.equal(result[0].text, 'Before');
    assert.equal(result[1].text, 'After');
  });

  test('each segment has a unique string id', () => {
    const [a, b] = segmentParagraphs('Hello world\n\nFoo bar');
    assert.equal(typeof a.id, 'string');
    assert.notEqual(a.id, b.id);
  });

  test('returns empty array for empty string', () => {
    assert.deepEqual(segmentParagraphs(''), []);
  });
});

describe('computeOrphanLabels', () => {
  test('label on only one paragraph is an orphan', () => {
    const codes = [
      { label: 'identity', paraIndex: 0 },
      { label: 'claim',    paraIndex: 1 },
      { label: 'identity', paraIndex: 2 },
    ];
    const orphans = computeOrphanLabels(codes);
    assert.ok(orphans.has('claim'));
    assert.ok(!orphans.has('identity'));
  });

  test('all labels are orphans when each appears once', () => {
    const codes = [{ label: 'a', paraIndex: 0 }, { label: 'b', paraIndex: 1 }];
    assert.equal(computeOrphanLabels(codes).size, 2);
  });

  test('returns empty set for no codes', () => {
    assert.equal(computeOrphanLabels([]).size, 0);
  });
});
