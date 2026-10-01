import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTenantRequest, needsDashboardSession } from './request.ts';

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
    ['/r/contains', '/mm-app/r/contains'], ['/r/%2561', '/mm-app/r/%2561'], ['/graph', '/mm-app/graph'], ['/about', '/mm-app/about'], ['/join', '/mm-app/join'], ['/admin', '/mm-app/admin'],
    ['/concepts', '/mm-app/concepts'], ['/pharmakon', '/mm-app/concept/pharmakon']];
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
  for (const p of ['/login', '/studio', '/studio/login', '/api/studio/me', '/cursos/x', '/foro/x',
    '/api/public/instruments', '/search.json', '/slides/x', '/f/../../cursos']) {
    assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: p }).action, 'not-found', p);
  }
  // musiki's top-level pages are reserved words: never a concept permalink either
  for (const p of ['/cursos', '/foro', '/dashboard']) {
    assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: p }).action, 'not-found', p);
  }
  // any other slug-shaped single segment is a concept permalink: only ever the mm concept page
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/cursus' }).rewrite, '/mm-app/concept/cursus');
});

test('mm host: root concept slugs rewrite to the concept page; odd spellings are not-found', () => {
  const d = decideTenantRequest({ host: 'mm.zztt.org', pathname: '/tertiary-retention' });
  assert.equal(d.action, 'next');
  assert.equal(d.rewrite, '/mm-app/concept/tertiary-retention');
  for (const p of ['/Tertiary-retention', '/%74ertiary', '/tertiary.retention', '/tertiary-retention/', '/caf%C3%A9', '/%2e%2e']) {
    assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: p }).action, 'not-found', p);
  }
  assert.equal(decideTenantRequest({ host: 'musiki.org.ar', pathname: '/tertiary-retention' }).rewrite, undefined);
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/tertiary-retention' }).action, 'not-found');
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

test('allowlist applies to the decoded path too (router matches decodeURI)', () => {
  for (const p of ['/api/public/%6Dm/x', '/api/public/%6dm/x', '/api/public/m%6D', '/api/public/%6D%6D/concepts.json', '/%73tudio']) {
    assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: p }).action, 'not-found', p);
  }
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/api/public/instruments' }).action, 'next');
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/%61pi/mm/x' }).action, 'not-found');
});

test('undecodable paths are not-found on scoped tenants', () => {
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/f/%E0%A4%A' }).action, 'not-found');
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/studio/%E0%A4%A' }).action, 'not-found');
});

test('mm: encoded non-ascii concept slugs still rewrite raw', () => {
  const d = decideTenantRequest({ host: 'mm.zztt.org', pathname: '/c/caf%C3%A9' });
  assert.equal(d.action, 'next');
  assert.equal(d.rewrite, '/mm-app/c/caf%C3%A9');
});

test('musiki unaffected by the decoded-path check', () => {
  assert.equal(decideTenantRequest({ host: 'musiki.org.ar', pathname: '/api/public/%6Dm/x' }).action, 'next');
  assert.equal(decideTenantRequest({ host: 'musiki.org.ar', pathname: '/f/%E0%A4%A' }).action, 'next');
});

test('mm host: /lily/<hash>.svg passes without rewrite; so host refuses it', () => {
  const d = decideTenantRequest({ host: 'mm.zztt.org', pathname: '/lily/0123456789abcdef0123456789abcdef.svg' });
  assert.equal(d.action, 'next');
  assert.equal(d.rewrite, undefined);
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/lily//x.svg' }).action, 'not-found');
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/lily/0123456789abcdef0123456789abcdef.svg' }).action, 'not-found');
});

test('dashboard session guard: full-route tenants only, /dashboard exactly or below', () => {
  const musiki = decideTenantRequest({ host: 'musiki.org.ar', pathname: '/' }).tenant;
  const mm = decideTenantRequest({ host: 'mm.zztt.org', pathname: '/' }).tenant;
  const so = decideTenantRequest({ host: 'so.zztt.org', pathname: '/' }).tenant;
  assert.equal(needsDashboardSession(musiki, '/dashboard'), true);
  assert.equal(needsDashboardSession(musiki, '/dashboard/x'), true);
  for (const p of ['/dashboards', '/dashboard-notes', '/', '/cursos']) assert.equal(needsDashboardSession(musiki, p), false, p);
  for (const p of ['/dashboard', '/dashboard/x', '/dashboards']) {
    assert.equal(needsDashboardSession(mm, p), false, p);
    assert.equal(needsDashboardSession(so, p), false, p);
  }
});

test('mm host: the bare /lily mount and deeper /lily paths are not-found (never musiki\'s catch-all)', () => {
  for (const p of ['/lily', '/lily/', '/lily/a/b']) {
    const d = decideTenantRequest({ host: 'mm.zztt.org', pathname: p });
    assert.equal(d.action, 'not-found', p);
    assert.equal(d.rewrite, undefined, p);
  }
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/lily/0123456789abcdef0123456789abcdef.svg' }).action, 'next');
});
