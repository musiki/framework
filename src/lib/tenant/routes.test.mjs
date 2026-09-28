import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TENANTS } from './tenants.ts';
import { isRouteAllowed } from './routes.ts';

const so = TENANTS.so;

test('musiki allows everything', () => {
  for (const p of ['/', '/cursos', '/foro', '/api/enroll', '/studio']) {
    assert.equal(isRouteAllowed(TENANTS.musiki, p), true, p);
  }
});

test('so allows only studio, studio api, public site api and auth', () => {
  for (const p of ['/studio', '/studio/', '/studio/settings/access', '/api/studio/me', '/api/auth/session', '/api/public/site', '/api/public/instruments']) {
    assert.equal(isRouteAllowed(so, p), true, p);
  }
  for (const p of ['/', '/cursos', '/foro', '/dashboard', '/login', '/api/enroll', '/api/graph-data',
    '/studiox', '/api/studiox', '/api/authz', '/api/notes/list', '/api/publicx']) {
    assert.equal(isRouteAllowed(so, p), false, p);
  }
});

test('musiki (default tenant) reaches /api/public/instruments', () => {
  assert.equal(isRouteAllowed(TENANTS.musiki, '/api/public/instruments'), true);
});

test('a tenant not configured with api:public (e.g. mm, not yet in TENANTS) is refused /api/public/instruments', () => {
  // mm isn't wired into TENANTS on this branch yet; a narrowly-scoped
  // tenant (any RouteFamily list that doesn't include 'api:public') stands
  // in for it here, generically.
  const notYetConfigured = { ...so, id: 'mm', routes: ['studio', 'auth'] };
  assert.equal(isRouteAllowed(notYetConfigured, '/api/public/instruments'), false);
});

// Sweep: every page file must be unreachable from `so` unless it lives under an allowed prefix.
const PAGES = path.resolve('src/pages');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(astro|ts|js|mjs|md|mdx)$/.test(e.name) && !e.name.endsWith('.test.mjs') ? [full] : [];
  });
}
function sampleRoute(file) {
  let rel = '/' + path.relative(PAGES, file).replace(/\\/g, '/').replace(/\.(astro|ts|js|mjs|md|mdx)$/, '');
  rel = rel.replace(/\/index$/, '') || '/';
  return rel.replace(/\[\.\.\.[^\]]+\]/g, 'x/y').replace(/\[[^\]]+\]/g, 'x');
}
const ALLOWED_PREFIXES = ['/studio', '/api/studio', '/api/public', '/api/auth'];
const underAllowed = (r) => ALLOWED_PREFIXES.some((p) => r === p || r.startsWith(p + '/'));

test('route sweep: no musiki route is reachable from so', () => {
  const routes = walk(PAGES).map(sampleRoute);
  assert.ok(routes.length > 20, 'expected to find the musiki page tree');
  for (const r of routes) {
    if (underAllowed(r)) continue;
    assert.equal(isRouteAllowed(so, r), false, `leak: ${r} reachable from so`);
  }
});
