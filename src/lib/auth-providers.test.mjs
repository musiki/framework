import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogtoHemProvider } from './auth-providers.ts';

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
