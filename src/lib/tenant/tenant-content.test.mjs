import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesTenant } from './tenant-content.ts';

test('matchesTenant matches exact tenant string on data or entry.data', () => {
  assert.equal(matchesTenant({ data: { tenant: 'hem' } }, 'hem'), true);
  assert.equal(matchesTenant({ data: { tenant: 'hem' } }, 'musiki'), false);
  assert.equal(matchesTenant({ tenant: 'musiki' }, 'musiki'), true);
  assert.equal(matchesTenant({ tenant: 'musiki' }, 'hem'), false);
});

test('matchesTenant treats missing tenant as musiki default', () => {
  assert.equal(matchesTenant({ data: {} }, 'musiki'), true);
  assert.equal(matchesTenant({ data: {} }, 'hem'), false);
  assert.equal(matchesTenant({}, 'musiki'), true);
  assert.equal(matchesTenant({}, 'hem'), false);
});

test('matchesTenant supports array of tenants and wildcard', () => {
  assert.equal(matchesTenant({ tenant: ['musiki', 'hem'] }, 'hem'), true);
  assert.equal(matchesTenant({ tenant: ['musiki', 'hem'] }, 'musiki'), true);
  assert.equal(matchesTenant({ tenant: '*' }, 'hem'), true);
  assert.equal(matchesTenant({ tenant: 'all' }, 'musiki'), true);
});
