import test from 'node:test';
import assert from 'node:assert/strict';
import { TENANTS } from './tenants.ts';
import { decideAuthRoute, filterProvidersPayload, sanitizeAuthErrorCode, studioLoginErrorKey } from './auth-gate.ts';

const { musiki, so } = TENANTS;

test('musiki: every action passes, own providers allowed', () => {
  for (const action of ['providers', 'session', 'csrf', 'signout', 'verify-request', 'error']) {
    assert.deepEqual(decideAuthRoute(musiki, action), { kind: 'pass' }, action);
  }
  assert.deepEqual(decideAuthRoute(musiki, 'signin'), { kind: 'pass' });
  assert.deepEqual(decideAuthRoute(musiki, 'signin', 'google'), { kind: 'pass' });
  assert.deepEqual(decideAuthRoute(musiki, 'callback', 'logto'), { kind: 'pass' });
});

test('foreign provider on signin/callback is not-found, both directions', () => {
  assert.deepEqual(decideAuthRoute(musiki, 'signin', 'logto-so'), { kind: 'not-found' });
  assert.deepEqual(decideAuthRoute(musiki, 'callback', 'logto-so'), { kind: 'not-found' });
  assert.deepEqual(decideAuthRoute(so, 'signin', 'google'), { kind: 'not-found' });
  assert.deepEqual(decideAuthRoute(so, 'callback', 'logto'), { kind: 'not-found' });
});

test('so: own provider signin/callback passes', () => {
  assert.deepEqual(decideAuthRoute(so, 'signin', 'logto-so'), { kind: 'pass' });
  assert.deepEqual(decideAuthRoute(so, 'callback', 'logto-so'), { kind: 'pass' });
});

test('so: default Auth.js pages are replaced', () => {
  assert.deepEqual(decideAuthRoute(so, 'providers'), { kind: 'filter-providers' });
  assert.deepEqual(decideAuthRoute(so, 'signin'), { kind: 'redirect', location: '/studio/login' });
  assert.deepEqual(decideAuthRoute(so, 'error', undefined, 'AccessDenied'),
    { kind: 'redirect', location: '/studio/login?error=AccessDenied' });
});

test('so: session/csrf/signout pass through', () => {
  for (const action of ['session', 'csrf', 'signout']) {
    assert.deepEqual(decideAuthRoute(so, action), { kind: 'pass' }, action);
  }
});

test('error codes are sanitized to letters', () => {
  assert.equal(sanitizeAuthErrorCode('AccessDenied'), 'AccessDenied');
  assert.equal(sanitizeAuthErrorCode('<script>x</script>'), 'scriptxscript');
  assert.equal(sanitizeAuthErrorCode(''), 'Default');
  assert.equal(sanitizeAuthErrorCode(null), 'Default');
  assert.equal(sanitizeAuthErrorCode('123'), 'Default');
  assert.deepEqual(decideAuthRoute(so, 'error', undefined, 'a&b=c'),
    { kind: 'redirect', location: '/studio/login?error=abc' });
});

test('providers payload keeps only tenant providers', () => {
  const payload = { google: { id: 'google' }, logto: { id: 'logto' }, 'logto-so': { id: 'logto-so' } };
  assert.deepEqual(filterProvidersPayload(so, payload), { 'logto-so': { id: 'logto-so' } });
  assert.deepEqual(filterProvidersPayload(so, null), {});
});

test('login error key mapping', () => {
  assert.equal(studioLoginErrorKey(null), null);
  assert.equal(studioLoginErrorKey(''), null);
  assert.equal(studioLoginErrorKey('AccessDenied'), 'studio.errors.accessDenied');
  assert.equal(studioLoginErrorKey('Configuration'), 'studio.errors.generic');
});
