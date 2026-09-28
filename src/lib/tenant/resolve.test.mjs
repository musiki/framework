import test from 'node:test';
import assert from 'node:assert/strict';
import { TENANTS } from './tenants.ts';
import {
  normalizeHost, findTenantByHost, resolveTenant, tenantForAuthProvider, isAuthProviderAllowed,
} from './resolve.ts';

test('normalizeHost lowercases, strips port, trailing dot and forwarded lists', () => {
  assert.equal(normalizeHost('SO.zztt.org:443'), 'so.zztt.org');
  assert.equal(normalizeHost('so.zztt.org.'), 'so.zztt.org');
  assert.equal(normalizeHost('so.zztt.org, 10.0.0.1'), 'so.zztt.org');
  assert.equal(normalizeHost(null), '');
});

test('known hosts resolve to their tenant', () => {
  assert.equal(resolveTenant('so.zztt.org').id, 'so');
  assert.equal(resolveTenant('so-dev.zztt.org').id, 'so');
  assert.equal(resolveTenant('musiki.org.ar').id, 'musiki');
  assert.equal(resolveTenant('mm.zztt.org').id, 'mm');
  assert.equal(resolveTenant('MM.zztt.org:443').id, 'mm');
});

test('mm tenant config', () => {
  const mm = TENANTS.mm;
  assert.equal(mm.locale, 'en');
  assert.deepEqual(mm.spaceKinds, ['commons']);
  assert.deepEqual(mm.authProviders, ['logto-mm']);
  assert.equal(mm.homePath, '/');
  assert.ok(!/musiki/i.test(mm.brand.name));
  assert.equal(mm.brand.theme, 'mm');
});

test('unknown host falls back to musiki', () => {
  assert.equal(resolveTenant('evil.example.com').id, 'musiki');
  assert.equal(resolveTenant('localhost:4321').id, 'musiki');
  assert.equal(findTenantByHost('evil.example.com'), null);
});

test('env override wins only with a valid tenant id', () => {
  assert.equal(resolveTenant('localhost', 'so').id, 'so');
  assert.equal(resolveTenant('localhost', 'nope').id, 'musiki');
});

test('hosts and auth providers are unique across tenants', () => {
  const hosts = Object.values(TENANTS).flatMap((t) => t.hosts);
  assert.equal(new Set(hosts).size, hosts.length);
  const providers = Object.values(TENANTS).flatMap((t) => t.authProviders);
  assert.equal(new Set(providers).size, providers.length);
});

test('providers map to tenants and are only allowed on their tenant', () => {
  assert.equal(tenantForAuthProvider('logto-so')?.id, 'so');
  assert.equal(tenantForAuthProvider('google')?.id, 'musiki');
  assert.equal(tenantForAuthProvider('unknown'), null);
  assert.equal(isAuthProviderAllowed(TENANTS.so, 'google'), false);
  assert.equal(isAuthProviderAllowed(TENANTS.so, 'logto-so'), true);
  assert.equal(isAuthProviderAllowed(TENANTS.musiki, 'logto-so'), false);
  assert.equal(tenantForAuthProvider('logto-mm')?.id, 'mm');
  assert.equal(isAuthProviderAllowed(TENANTS.mm, 'logto-mm'), true);
  for (const foreign of ['logto', 'google', 'authentik', 'logto-so']) {
    assert.equal(isAuthProviderAllowed(TENANTS.mm, foreign), false, foreign);
  }
  assert.equal(isAuthProviderAllowed(TENANTS.so, 'logto-mm'), false);
  assert.equal(isAuthProviderAllowed(TENANTS.musiki, 'logto-mm'), false);
});
