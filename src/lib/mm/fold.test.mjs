import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONCEPT_SECTIONS, FOLD_DEFAULT_OPEN, foldKey, foldValue, hashTarget, initialFoldOpen, parseFoldValue,
} from './fold.ts';

test('concept sections: page order, anchors, defaults (definition + discussion open)', () => {
  assert.deepEqual([...CONCEPT_SECTIONS], ['definition', 'discussion', 'new-version', 'relations', 'status', 'history']);
  assert.deepEqual(CONCEPT_SECTIONS.filter((s) => FOLD_DEFAULT_OPEN[s]), ['definition', 'discussion']);
  assert.ok(Object.isFrozen(FOLD_DEFAULT_OPEN));
  for (const s of CONCEPT_SECTIONS) assert.match(s, /^[a-z-]+$/);
});

test('fold storage: one key per section (shared by every concept), 1/0 values', () => {
  assert.equal(foldKey('history'), 'mm-fold:history');
  assert.equal(foldValue(true), '1');
  assert.equal(foldValue(false), '0');
  assert.equal(parseFoldValue('1'), true);
  assert.equal(parseFoldValue('0'), false);
  for (const junk of [null, undefined, '', 'true', 1]) assert.equal(parseFoldValue(junk), null);
});

test('initialFoldOpen: anchor forces open, then the reader, then the default', () => {
  assert.equal(initialFoldOpen({ defaultOpen: false, stored: null, targeted: false }), false);
  assert.equal(initialFoldOpen({ defaultOpen: true, stored: null, targeted: false }), true);
  assert.equal(initialFoldOpen({ defaultOpen: true, stored: false, targeted: false }), false);
  assert.equal(initialFoldOpen({ defaultOpen: false, stored: true, targeted: false }), true);
  assert.equal(initialFoldOpen({ defaultOpen: false, stored: false, targeted: true }), true);
});

test('hashTarget decodes the fragment; junk is empty', () => {
  assert.equal(hashTarget('#history'), 'history');
  assert.equal(hashTarget('#post-abc'), 'post-abc');
  assert.equal(hashTarget('#caf%C3%A9'), 'café');
  for (const junk of ['', '#', 'history', '#%E0%A4%A', null]) assert.equal(hashTarget(junk), '');
});
