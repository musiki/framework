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

test('studio sign-in error messages', () => {
  assert.equal(t('en', 'studio.errors.accessDenied'), 'This account does not have access to the studio.');
  assert.equal(t('en', 'studio.errors.generic'), 'Sign-in failed. Please try again.');
  assert.notEqual(t('es', 'studio.errors.accessDenied'), t('en', 'studio.errors.accessDenied'));
});

test('mm: nb is complete for the mm namespace and non-empty', async () => {
  const { nb } = await import('./nb.ts');
  const nbKeys = new Map(leaves(nb.mm, 'mm.'));
  for (const [k] of leaves(en.mm, 'mm.')) assert.ok(nbKeys.get(k)?.trim(), `missing or empty nb: ${k}`);
  assert.equal(nbKeys.size, leaves(en.mm).length, 'nb has keys that en does not');
});

test('mm: nb translates mm keys and falls back to en elsewhere', () => {
  assert.equal(t('en', 'mm.nav.about'), 'About');
  assert.equal(t('nb', 'mm.nav.about'), 'Om');
  assert.equal(t('nb', 'roles.supervisor'), 'Supervisor');
  assert.equal(t('nb', 'mm.nav.account', { name: 'Ada' }), 'Logget inn som Ada');
});
