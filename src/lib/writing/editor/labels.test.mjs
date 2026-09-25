import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ES_LABELS, buildEditorLabels, formatLabel } from './labels.ts';

test('buildEditorLabels("es") deep-equals DEFAULT_ES_LABELS (musiki default, unchanged)', () => {
  assert.deepEqual(buildEditorLabels('es'), DEFAULT_ES_LABELS);
});

test('buildEditorLabels("en") has no empty values', () => {
  const en = buildEditorLabels('en');
  for (const [key, value] of Object.entries(en)) {
    assert.ok(typeof value === 'string' && value.trim(), `empty en label: ${key}`);
  }
});

test('buildEditorLabels("en") spot-check has no Spanish-only characters', () => {
  const en = buildEditorLabels('en');
  const spanishOnly = /[ñáéíóúü¿¡]/i;
  assert.equal(spanishOnly.test(en.loading), false, en.loading);
  assert.equal(spanishOnly.test(en.notFound), false, en.notFound);
});

test('formatLabel fills {vars} placeholders', () => {
  assert.equal(formatLabel('Por {name} · {time}', { name: 'Ana', time: 'hace 2 min' }), 'Por Ana · hace 2 min');
  assert.equal(formatLabel('no vars here', { unused: 'x' }), 'no vars here');
  assert.equal(formatLabel('missing {var}', {}), 'missing {var}');
});
