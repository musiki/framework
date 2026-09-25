import test from 'node:test';
import assert from 'node:assert/strict';
import { t } from './index.ts';
import { en } from './en.ts';
import { es } from './es.ts';

test('translates by locale', () => {
  assert.equal(t('en', 'roles.supervisor'), 'Supervisor');
  assert.equal(t('es', 'roles.supervisor'), 'Director/a');
});

test('fr falls back to en until hem joins', () => {
  assert.equal(t('fr', 'roles.author'), 'Author');
});

test('interpolates variables', () => {
  assert.equal(t('en', 'studio.invite.expires', { days: 14 }), 'Expires in 14 days.');
});

test('stored trace keys map to English labels', () => {
  assert.equal(t('en', 'trace.role.sintesis'), 'Synthesis');
});

function leaves(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefix + k, v]] : leaves(v, `${prefix}${k}.`));
}

test('no empty strings in any dictionary, and es has every en key', () => {
  const esKeys = new Set(leaves(es).map(([k]) => k));
  for (const [k, v] of leaves(en)) {
    assert.ok(v.trim(), `empty en: ${k}`);
    assert.ok(esKeys.has(k), `missing es: ${k}`);
  }
  for (const [k, v] of leaves(es)) assert.ok(v.trim(), `empty es: ${k}`);
});
