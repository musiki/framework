import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_URL = 'https://musiki.org.ar';
const { resolveAuthRedirectUrl, resolveRequestAuthOrigin, resolveAuthBaseOrigin } = await import('./auth-origin.ts');

const req = (host) => new Request('http://127.0.0.1:4321/api/auth/session', {
  headers: { 'x-forwarded-host': host, 'x-forwarded-proto': 'https' },
});

test('so host keeps its own origin despite AUTH_URL', () => {
  assert.equal(resolveRequestAuthOrigin(req('so.zztt.org')), 'https://so.zztt.org');
  assert.equal(resolveAuthBaseOrigin('https://so-dev.zztt.org'), 'https://so-dev.zztt.org');
  assert.equal(resolveAuthRedirectUrl({ baseUrl: 'https://so.zztt.org', url: '/studio' }), 'https://so.zztt.org/studio');
});

test('musiki behavior unchanged', () => {
  assert.equal(resolveRequestAuthOrigin(req('musiki.org.ar')), 'https://musiki.org.ar');
  assert.equal(resolveAuthRedirectUrl({ baseUrl: 'https://musiki.org.ar', url: '/dashboard' }), 'https://musiki.org.ar/dashboard');
});

test('unknown hosts cannot hijack the origin', () => {
  assert.equal(resolveRequestAuthOrigin(req('evil.example.com')), 'https://musiki.org.ar');
});

test('redirects to foreign origins fall back to the tenant origin', () => {
  assert.equal(
    resolveAuthRedirectUrl({ baseUrl: 'https://so.zztt.org', url: 'https://evil.example.com/x', fallbackPath: '/studio' }),
    'https://so.zztt.org/studio',
  );
});
