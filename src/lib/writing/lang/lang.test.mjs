import test from 'node:test';
import assert from 'node:assert/strict';
import { getLangPack, traceStopwords, normalizeContentLang } from './index.ts';
import { STOPWORDS, startsWithConnector } from '../../../scripts/course/notes/trace-utils.mjs';

test('packs are language-pure', () => {
  assert.ok(getLangPack('es').stopwords.has('para'));
  assert.ok(!getLangPack('es').stopwords.has('that'));
  assert.ok(getLangPack('en').stopwords.has('that'));
  assert.ok(!getLangPack('en').stopwords.has('para'));
});

test('es tracer set equals the previous 187-word mixed list (musiki unchanged)', () => {
  const es = traceStopwords('es');
  assert.equal(es.size, 187);
  assert.ok(es.has('para') && es.has('through'));
  assert.equal(STOPWORDS.size, 187);
});

test('en tracer set never contains Spanish stopwords', () => {
  const en = traceStopwords('en');
  for (const w of ['para', 'como', 'también', 'través']) assert.ok(!en.has(w), w);
});

test('connectors by language', () => {
  assert.equal(startsWithConnector('Sin embargo, el ritmo'), true);
  assert.equal(startsWithConnector('However, rhythm', 'en'), true);
  assert.equal(startsWithConnector('However, rhythm', 'es'), false);
  assert.equal(startsWithConnector('For example, a fugue', 'en'), true);
});

test('normalizeContentLang', () => {
  assert.equal(normalizeContentLang('en'), 'en');
  assert.equal(normalizeContentLang('fr'), 'es');
  assert.equal(normalizeContentLang(undefined), 'es');
});
