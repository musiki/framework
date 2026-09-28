import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SOOG_DASHBOARD_COURSES, showsSoogDashboard } from './courses.ts';

test('SOOG_DASHBOARD_COURSES is exactly i1 and i2', () => {
  assert.deepEqual([...SOOG_DASHBOARD_COURSES], ['i1', 'i2']);
});

test('showsSoogDashboard: true for i1 and i2', () => {
  assert.equal(showsSoogDashboard('i1'), true);
  assert.equal(showsSoogDashboard('i2'), true);
  assert.equal(showsSoogDashboard(' I1 '), true);
});

test('showsSoogDashboard: false for other courses and empty values', () => {
  for (const v of ['i3', 'cym', 's123', 'i', 'i12', '', null, undefined]) {
    assert.equal(showsSoogDashboard(v), false, String(v));
  }
  assert.equal(showsSoogDashboard(/** @type {any} */ (1)), false);
});

test('vendored soog-dashboard.js carries a version header matching its export', async () => {
  const url = new URL('../../../public/vendor/soog-dashboard/soog-dashboard.js', import.meta.url);
  const src = fs.readFileSync(url, 'utf8');
  const header = src.slice(0, 400);
  const m = header.match(/SOOG_DASHBOARD_VERSION = '(\d+\.\d+\.\d+)'/);
  assert.ok(m, 'header comment has SOOG_DASHBOARD_VERSION');
  assert.match(header, new RegExp(`soog-dashboard ${m[1].replace(/\./g, '\\.')}`));
  const exported = src.match(/export const SOOG_DASHBOARD_VERSION = '([^']+)'/);
  assert.ok(exported, 'exports SOOG_DASHBOARD_VERSION');
  assert.equal(exported[1], m[1]);
});

test('SOOG_DASHBOARD_LABELS_ES only uses keys the vendored element supports', async () => {
  const { SOOG_DASHBOARD_LABELS_ES } = await import('./courses.ts');
  const src = fs.readFileSync(new URL('../../../public/vendor/soog-dashboard/soog-dashboard.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('export const DEFAULT_LABELS = {'), src.indexOf('};', src.indexOf('export const DEFAULT_LABELS = {')));
  const known = new Set([...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]));
  assert.ok(known.size > 20);
  for (const key of Object.keys(SOOG_DASHBOARD_LABELS_ES)) assert.ok(known.has(key), `unknown label key ${key}`);
  assert.equal(SOOG_DASHBOARD_LABELS_ES.title, 'Dashboard MOAIE');
  assert.equal(SOOG_DASHBOARD_LABELS_ES.profileLabels.length, 10);
  assert.deepEqual(Object.keys(SOOG_DASHBOARD_LABELS_ES.axisNames), ['M', 'O', 'A', 'I', 'E']);
});
