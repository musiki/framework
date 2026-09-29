import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TENANTS } from './tenants.ts';
import { isRouteAllowed, mapMmPath, isInternalMmPath, isMmPagePath } from './routes.ts';

const so = TENANTS.so;
const mm = TENANTS.mm;

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

test('so api:public excludes the mm public api', () => {
  for (const p of ['/api/public/mm', '/api/public/mm/concepts.json']) {
    assert.equal(isRouteAllowed(so, p), false, p);
  }
  for (const p of ['/api/public/mmx', '/api/public/site']) {
    assert.equal(isRouteAllowed(so, p), true, p);
  }
});

test('mapMmPath keeps raw encoding', () => {
  assert.equal(mapMmPath('/f/%25'), '/mm-app/f/%25');
  assert.equal(mapMmPath('/f/%2561'), '/mm-app/f/%2561');
});

test('mm (no api:public family) is refused /api/public/instruments and so data', () => {
  assert.equal(isRouteAllowed(mm, '/api/public/instruments'), false);
  assert.equal(isRouteAllowed(mm, '/api/public/site'), false);
});

test('mm allows / exactly, its page prefixes, its apis and auth', () => {
  for (const p of ['/', '/f', '/f/stiegler', '/c', '/c/tertiary-retention', '/graph', '/about', '/join',
    '/admin', '/admin/invites', '/api/mm', '/api/mm/concepts', '/api/public/mm', '/api/public/mm/concepts.json',
    '/api/auth/session', '/api/auth/signin/logto-mm']) {
    assert.equal(isRouteAllowed(mm, p), true, p);
  }
  for (const p of ['//', '/x', '/cursos', '/foro', '/dashboard', '/login', '/studio', '/studio/login', '/api/studio/me',
    '/api/public', '/api/public/mmx', '/api/mmx', '/fx', '/cx', '/graphs', '/aboutx', '/joinx', '/adminx',
    '/search.json', '/public-search.json', '/slides/x', '/mm-app', '/mm-app/', '/api/graph-data']) {
    assert.equal(isRouteAllowed(mm, p), false, p);
  }
});

test('mapMmPath maps public mm pages to the internal mount', () => {
  assert.equal(mapMmPath('/'), '/mm-app/');
  assert.equal(mapMmPath('/f'), '/mm-app/f');
  assert.equal(mapMmPath('/f/stiegler'), '/mm-app/f/stiegler');
  assert.equal(mapMmPath('/c/tertiary-retention'), '/mm-app/c/tertiary-retention');
  assert.equal(mapMmPath('/graph'), '/mm-app/graph');
  assert.equal(mapMmPath('/about'), '/mm-app/about');
  assert.equal(mapMmPath('/join'), '/mm-app/join');
  assert.equal(mapMmPath('/admin/members'), '/mm-app/admin/members');
});

test('mapMmPath returns null for everything else', () => {
  for (const p of ['', '//', '/cursos', '/fx', '/aboutx', '/api/mm/concepts', '/api/public/mm/concepts.json',
    '/api/auth/session', '/studio', '/mm-app', '/mm-app/f']) {
    assert.equal(mapMmPath(p), null, p);
  }
});

test('mapMmPath never escapes the mount via dot segments', () => {
  assert.equal(mapMmPath('/f/../../cursos'), null);
  assert.equal(mapMmPath('/f/%2e%2e/%2E%2E/cursos'), null);
});

test('isMmPagePath matches the mm page family only', () => {
  assert.equal(isMmPagePath('/'), true);
  assert.equal(isMmPagePath('/c/x'), true);
  assert.equal(isMmPagePath('/api/mm'), false);
});

test('isInternalMmPath catches every spelling of the mount', () => {
  for (const p of ['/mm-app', '/mm-app/', '/mm-app/f/x', '/MM-APP/', '//mm-app/', '/mm%2Dapp/', '/mm%2dapp']) {
    assert.equal(isInternalMmPath(p), true, p);
  }
  for (const p of ['/', '/mm', '/mm-apps', '/f/mm-app', '/api/mm']) {
    assert.equal(isInternalMmPath(p), false, p);
  }
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
const underAllowed = (r) => ALLOWED_PREFIXES.some((p) => r === p || r.startsWith(p + '/'))
  && !(r === '/api/public/mm' || r.startsWith('/api/public/mm/'));

test('route sweep: no musiki route is reachable from so', () => {
  const routes = walk(PAGES).map(sampleRoute);
  assert.ok(routes.length > 20, 'expected to find the musiki page tree');
  for (const r of routes) {
    if (underAllowed(r)) continue;
    assert.equal(isRouteAllowed(so, r), false, `leak: ${r} reachable from so`);
  }
});

// mm sweep: every existing page is either refused on mm, or — when its URL
// coincides with an mm page path (/, /about, /admin/…) — served only through
// the rewrite to /mm-app/*, never as the musiki page. Only auth and the mm
// families are reachable; /mm-app/* itself is internal.
const MM_OWN_PREFIXES = ['/api/auth', '/api/mm', '/api/public/mm'];
const underMmOwn = (r) => MM_OWN_PREFIXES.some((p) => r === p || r.startsWith(p + '/'));

test('route sweep: no musiki route is reachable from mm', () => {
  const routes = walk(PAGES).map(sampleRoute);
  assert.ok(routes.length > 20, 'expected to find the musiki page tree');
  for (const r of routes) {
    if (r === '/mm-app' || r.startsWith('/mm-app/')) continue;
    if (underMmOwn(r)) continue;
    if (!isRouteAllowed(mm, r)) continue;
    const target = mapMmPath(r);
    assert.ok(target && target.startsWith('/mm-app/'), `leak: ${r} reachable from mm without rewrite`);
  }
});

test('mapMmPath maps channel paths (group, group/channel, both thread forms) verbatim', () => {
  const T = '00000000-0000-4000-8000-000000000030';
  assert.equal(mapMmPath('/f/stiegler/welcome'), '/mm-app/f/stiegler/welcome');
  assert.equal(mapMmPath(`/f/stiegler/technics-and-time/t/${T}`), `/mm-app/f/stiegler/technics-and-time/t/${T}`);
  assert.equal(mapMmPath(`/f/stiegler/t/${T}`), `/mm-app/f/stiegler/t/${T}`);
  // '/f/<group>/t' reaches the channel page with the reserved slug "t", which the page 404s
  assert.equal(mapMmPath('/f/stiegler/t'), '/mm-app/f/stiegler/t');
  // dot segments cannot climb out of the mount
  assert.equal(mapMmPath('/f/stiegler/%2e%2e/%2e%2e/%2e%2e/x'), null);
  assert.equal(isMmPagePath('/f/stiegler/welcome/t/x'), true);
});
