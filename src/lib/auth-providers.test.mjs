import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogtoHemProvider, isTenantAuthProviderConfigured } from './auth-providers.ts';

test('logto-hem: absent without issuer or client id', () => {
  assert.deepEqual(buildLogtoHemProvider({}), []);
  assert.deepEqual(buildLogtoHemProvider({ LOGTO_ISSUER_URL: 'https://l.example/oidc' }), []);
  assert.deepEqual(buildLogtoHemProvider({ LOGTO_HEM_CLIENT_ID: 'x' }), []);
});

test('logto-hem: configured provider is French and PKCE-protected', () => {
  const [p] = buildLogtoHemProvider({
    LOGTO_ISSUER_URL: 'https://l.example/oidc', LOGTO_HEM_CLIENT_ID: 'cid', LOGTO_HEM_CLIENT_SECRET: 'sec',
  });
  assert.equal(p.id, 'logto-hem');
  assert.equal(p.issuer, 'https://l.example/oidc');
  assert.equal(p.clientId, 'cid');
  assert.equal(p.clientSecret, 'sec');
  assert.equal(p.authorization.params.ui_locales, 'fr');
  assert.deepEqual(p.checks, ['pkce', 'state']);
  assert.equal(p.onProfile({ sub: 's', name: 'N', email: 'e' }).id, 's');
});

test('isTenantAuthProviderConfigured: logto-<tenant> needs issuer and that tenant client id', () => {
  const issuer = { LOGTO_ISSUER_URL: 'https://l.example/oidc' };
  assert.equal(isTenantAuthProviderConfigured('logto-hem', {}), false);
  assert.equal(isTenantAuthProviderConfigured('logto-hem', issuer), false);
  assert.equal(isTenantAuthProviderConfigured('logto-hem', { LOGTO_HEM_CLIENT_ID: 'x' }), false);
  assert.equal(isTenantAuthProviderConfigured('logto-hem', { ...issuer, LOGTO_SO_CLIENT_ID: 'x' }), false);
  assert.equal(isTenantAuthProviderConfigured('logto-hem', { ...issuer, LOGTO_HEM_CLIENT_ID: 'x' }), true);
  assert.equal(isTenantAuthProviderConfigured('logto-so', { ...issuer, LOGTO_SO_CLIENT_ID: 'x' }), true);
  // musiki providers are not gated
  for (const id of ['logto', 'google', 'authentik', undefined]) {
    assert.equal(isTenantAuthProviderConfigured(id, {}), true, String(id));
  }
});

test("isTenantAuthProviderConfigured accepts an env getter", () => {
  const env = { LOGTO_ISSUER_URL: "https://l.example/oidc", LOGTO_HEM_CLIENT_ID: "x" };
  assert.equal(isTenantAuthProviderConfigured("logto-hem", (key) => env[key]), true);
  assert.equal(isTenantAuthProviderConfigured("logto-hem", () => undefined), false);
});
