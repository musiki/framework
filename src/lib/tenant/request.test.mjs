import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTenantRequest } from './request.ts';

test('musiki host passes through untouched', () => {
  const d = decideTenantRequest({ host: 'musiki.org.ar', pathname: '/foro' });
  assert.equal(d.tenant.id, 'musiki');
  assert.equal(d.action, 'next');
});

test('so host: allowed routes pass, others are not-found', () => {
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/studio' }).action, 'next');
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/foro' }).action, 'not-found');
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/search.json' }).action, 'not-found');
});

test('so host: built assets pass', () => {
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/_astro/app.123.js' }).action, 'next');
});

test('dev override applies', () => {
  assert.equal(decideTenantRequest({ host: 'localhost:4321', pathname: '/cursos', envTenant: 'so' }).action, 'not-found');
});
