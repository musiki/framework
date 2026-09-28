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

test('scoped tenants: /_* reaching middleware is not-found (static handler serves real assets)', () => {
  for (const host of ['so.zztt.org', 'mm.zztt.org']) {
    for (const p of ['/_astro/app.123.js', '/_astro/some-public-wiki-slug', '/_image', '/_actions/x', '/_x']) {
      assert.equal(decideTenantRequest({ host, pathname: p }).action, 'not-found', `${host}${p}`);
    }
  }
  assert.equal(decideTenantRequest({ host: 'musiki.org.ar', pathname: '/_astro/app.123.js' }).action, 'next');
});

test('scoped tenants: raw paths with // are not-found', () => {
  for (const host of ['so.zztt.org', 'mm.zztt.org']) {
    for (const p of ['/api//auth/x', '/api//mm/x', '/f//x', '//', '//f', '/studio//x', '/api/public//mm/x']) {
      assert.equal(decideTenantRequest({ host, pathname: p }).action, 'not-found', `${host}${p}`);
    }
  }
  assert.equal(decideTenantRequest({ host: 'musiki.org.ar', pathname: '/api//auth/x' }).action, 'next');
});

test('mm host: rewrite target is built from the raw encoded path, never decoded', () => {
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/f/%25' }).rewrite, '/mm-app/f/%25');
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/f/%2561' }).rewrite, '/mm-app/f/%2561');
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/c/%C3%A9t%C3%A9' }).rewrite, '/mm-app/c/%C3%A9t%C3%A9');
  // encoded spellings of other routes are not the mm family
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/%61bout' }).action, 'not-found');
});

test('so host: mm public api is not reachable, so public api is', () => {
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/api/public/mm/concepts.json' }).action, 'not-found');
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/api/public/mm' }).action, 'not-found');
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/api/public/instruments' }).action, 'next');
});

test('dev override applies', () => {
  assert.equal(decideTenantRequest({ host: 'localhost:4321', pathname: '/cursos', envTenant: 'so' }).action, 'not-found');
});

test('so host: /studio/not-found itself passes (no rewrite loop)', () => {
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/studio/not-found' }).action, 'next');
  assert.equal(decideTenantRequest({ host: 'so-dev.zztt.org', pathname: '/studio/not-found' }).action, 'next');
});

test('so-dev host: prerendered routes obey allowlist', () => {
  assert.equal(decideTenantRequest({ host: 'so-dev.zztt.org', pathname: '/slides/some-slug' }).action, 'not-found');
  assert.equal(decideTenantRequest({ host: 'so-dev.zztt.org', pathname: '/public-search.json' }).action, 'not-found');
});

test('mm host: public pages are rewritten to the internal mount, with internal target', () => {
  const cases = [['/', '/mm-app/'], ['/f/stiegler', '/mm-app/f/stiegler'], ['/c/x', '/mm-app/c/x'],
    ['/graph', '/mm-app/graph'], ['/about', '/mm-app/about'], ['/join', '/mm-app/join'], ['/admin', '/mm-app/admin']];
  for (const [p, target] of cases) {
    const d = decideTenantRequest({ host: 'mm.zztt.org', pathname: p });
    assert.equal(d.tenant.id, 'mm');
    assert.equal(d.action, 'next', p);
    assert.equal(d.rewrite, target, p);
  }
});

test('mm host: apis and auth pass without rewrite', () => {
  for (const p of ['/api/mm/concepts', '/api/public/mm/concepts.json', '/api/auth/session']) {
    const d = decideTenantRequest({ host: 'mm.zztt.org', pathname: p });
    assert.equal(d.action, 'next', p);
    assert.equal(d.rewrite, undefined, p);
  }
});

test('mm host: musiki and so routes are not-found', () => {
  for (const p of ['/cursos', '/foro', '/dashboard', '/login', '/studio', '/studio/login', '/api/studio/me',
    '/api/public/instruments', '/search.json', '/slides/x', '/f/../../cursos']) {
    assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: p }).action, 'not-found', p);
  }
});

test('/mm-app/* is not-found on every host', () => {
  for (const host of ['mm.zztt.org', 'musiki.org.ar', 'so.zztt.org', 'localhost:4321']) {
    for (const p of ['/mm-app', '/mm-app/', '/mm-app/f/x', '/MM-APP/', '/mm%2Dapp/']) {
      const d = decideTenantRequest({ host, pathname: p });
      assert.equal(d.action, 'not-found', `${host}${p}`);
      assert.equal(d.rewrite, undefined);
    }
  }
});

test('musiki and so never get a rewrite for mm-looking paths', () => {
  assert.deepEqual(decideTenantRequest({ host: 'musiki.org.ar', pathname: '/about' }).rewrite, undefined);
  assert.equal(decideTenantRequest({ host: 'musiki.org.ar', pathname: '/about' }).action, 'next');
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/about' }).action, 'not-found');
});

test('dev override to mm applies', () => {
  assert.equal(decideTenantRequest({ host: 'localhost:4321', pathname: '/', envTenant: 'mm' }).rewrite, '/mm-app/');
});
