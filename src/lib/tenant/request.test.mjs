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
    ['/concepts', '/mm-app/concepts'], ['/pharmakon', '/mm-app/root/pharmakon']];
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
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/cursus' }).rewrite, '/mm-app/root/cursus');
});

test('mm host: root concept slugs rewrite to the concept page; odd spellings are not-found', () => {
  const d = decideTenantRequest({ host: 'mm.zztt.org', pathname: '/tertiary-retention' });
  assert.equal(d.action, 'next');
  assert.equal(d.rewrite, '/mm-app/root/tertiary-retention');
  for (const p of ['/Tertiary-retention', '/%74ertiary', '/tertiary.retention', '/caf%C3%A9', '/%2e%2e']) {
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

test('mm host: a root concept slug with a trailing slash redirects to the slug; nothing else does', () => {
  assert.deepEqual(
    (({ action, location }) => ({ action, location }))(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/x/' })),
    { action: 'redirect', location: '/x' },
  );
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/tertiary-retention/' }).location, '/tertiary-retention');
  for (const p of ['/X/', '/%2e/', '/%2E/', '/./', '/x//', '/graph/', '/about/', '/dashboard/', '/x/t/', '/x/y/z/', '/a--b/', '//',
    '/f/x/', '/x/T1/', '/x/y//']) {
    assert.notEqual(decideTenantRequest({ host: 'mm.zztt.org', pathname: p }).action, 'redirect', p);
  }
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/X/' }).action, 'not-found');
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/%2e/' }).action, 'not-found');
  // reserved words with a slash keep their own page
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/graph/' }).rewrite, '/mm-app/graph/');
  // other tenants never
  assert.notEqual(decideTenantRequest({ host: 'musiki.org.ar', pathname: '/x/' }).action, 'redirect');
  assert.notEqual(decideTenantRequest({ host: 'so.zztt.org', pathname: '/x/' }).action, 'redirect');
});

const TID = '0b7c1a2e-3f4d-4a5b-8c6d-7e8f9a0b1c2d';

test('mm host: root board shapes rewrite under /mm-app/b; their trailing slash redirects', () => {
  const cases = [
    ['/stiegler', '/mm-app/root/stiegler'],
    ['/stiegler/tt1', '/mm-app/b/stiegler/tt1'],
    [`/stiegler/t/${TID}`, `/mm-app/b/stiegler/t/${TID}`],
    [`/stiegler/tt1/t/${TID}`, `/mm-app/b/stiegler/tt1/t/${TID}`],
  ];
  for (const [p, target] of cases) {
    const d = decideTenantRequest({ host: 'mm.zztt.org', pathname: p });
    assert.equal(d.action, 'next', p);
    assert.equal(d.rewrite, target, p);
    const slash = decideTenantRequest({ host: 'mm.zztt.org', pathname: `${p}/` });
    assert.equal(slash.action, 'redirect', `${p}/`);
    assert.equal(slash.location, p, `${p}/`);
  }
  // old forum URLs keep their internal pages (which answer 301)
  assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: '/f/stiegler/tt1' }).rewrite, '/mm-app/f/stiegler/tt1');
});

test('mm host: odd spellings of board shapes are not-found (raw and encoded)', () => {
  for (const p of ['/Stiegler/tt1', '/stiegler/TT1', '/%73tiegler/tt1', '/stiegler/%74t1', `/stiegler/%74/${TID}`,
    `/stiegler/t/${TID.toUpperCase()}`, '/stiegler/t/x', '/stiegler//tt1', '/stiegler/tt1/t', '/stiegler/t',
    '/stiegler/a.b', '/stiegler/%2e%2e', '/stiegler/..', `/stiegler/tt1/t/${TID}/x`, '/stiegler/tt1/x',
    '/_astro/x/y', '/cursos/x', '/dashboard/x', '/mm-app/b/x/y', '/lily/a/b']) {
    assert.equal(decideTenantRequest({ host: 'mm.zztt.org', pathname: p }).action, 'not-found', p);
  }
});

test('musiki and so: board shapes are not theirs to rewrite', () => {
  assert.equal(decideTenantRequest({ host: 'musiki.org.ar', pathname: '/stiegler/tt1' }).rewrite, undefined);
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/stiegler/tt1' }).action, 'not-found');
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: `/stiegler/t/${TID}` }).action, 'not-found');
  assert.notEqual(decideTenantRequest({ host: 'so.zztt.org', pathname: '/stiegler/tt1/' }).action, 'redirect');
});
