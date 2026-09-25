import test from 'node:test';
import assert from 'node:assert/strict';
import { decideSpaceAccess } from './access.ts';
import { validateAccessRuleInput, validateInviteInput, emailDomain } from './space-roles.ts';

const NOW = new Date('2026-10-01T00:00:00Z');
const base = { email: 'ana@nmh.no', emailVerified: true, now: NOW, isMember: false, invites: [], rules: [] };
const invite = (o = {}) => ({ id: 'i1', spaceId: 's1', email: 'ana@nmh.no', role: 'supervisor',
  expiresAt: '2026-10-10T00:00:00Z', acceptedAt: null, ...o });

test('unverified email is always rejected', () => {
  const d = decideSpaceAccess({ ...base, emailVerified: false, invites: [invite()] });
  assert.deepEqual(d, { allowed: false, reason: 'unverified' });
});

test('valid invite grants its role', () => {
  const d = decideSpaceAccess({ ...base, invites: [invite()] });
  assert.equal(d.allowed, true);
  assert.deepEqual(d.grants, [{ spaceId: 's1', role: 'supervisor', via: 'invite', inviteId: 'i1' }]);
});

test('expired or accepted invites grant nothing', () => {
  assert.equal(decideSpaceAccess({ ...base, invites: [invite({ expiresAt: '2026-09-01T00:00:00Z' })] }).allowed, false);
  assert.equal(decideSpaceAccess({ ...base, invites: [invite({ acceptedAt: '2026-09-20T00:00:00Z' })] }).allowed, false);
});

test('invite for another email grants nothing', () => {
  assert.equal(decideSpaceAccess({ ...base, invites: [invite({ email: 'bob@nmh.no' })] }).allowed, false);
});

test('email rule and exact domain rule', () => {
  const email = decideSpaceAccess({ ...base, rules: [{ spaceId: 's1', kind: 'email', value: 'ana@nmh.no', role: 'reviewer' }] });
  assert.equal(email.grants[0].via, 'email-rule');
  const domain = decideSpaceAccess({ ...base, rules: [{ spaceId: 's1', kind: 'domain', value: 'nmh.no', role: 'guest' }] });
  assert.equal(domain.grants[0].via, 'domain-rule');
});

test('look-alike domains and subdomains do not match', () => {
  const rules = [{ spaceId: 's1', kind: 'domain', value: 'nmh.no', role: 'guest' }];
  for (const email of ['x@nmh.no.evil.com', 'x@a.nmh.no', 'x@evilnmh.no']) {
    assert.equal(decideSpaceAccess({ ...base, email, rules }).allowed, false, email);
  }
});

test('invite beats rules for the same space; one grant per space', () => {
  const d = decideSpaceAccess({ ...base, invites: [invite()],
    rules: [{ spaceId: 's1', kind: 'domain', value: 'nmh.no', role: 'guest' }] });
  assert.equal(d.grants.length, 1);
  assert.equal(d.grants[0].role, 'supervisor');
});

test('existing member is allowed without new grants', () => {
  assert.deepEqual(decideSpaceAccess({ ...base, isMember: true }), { allowed: true, grants: [] });
});

test('author is never granted by rows', () => {
  const d = decideSpaceAccess({ ...base, rules: [{ spaceId: 's1', kind: 'email', value: 'ana@nmh.no', role: 'author' }] });
  assert.equal(d.allowed, false);
});

test('rule and invite input validation', () => {
  assert.deepEqual(validateAccessRuleInput({ kind: 'domain', value: ' NMH.no ', role: 'guest' }),
    { ok: true, kind: 'domain', value: 'nmh.no', role: 'guest' });
  assert.equal(validateAccessRuleInput({ kind: 'domain', value: '@nmh.no', role: 'guest' }).ok, false);
  assert.equal(validateAccessRuleInput({ kind: 'email', value: 'not-an-email', role: 'guest' }).ok, false);
  assert.equal(validateAccessRuleInput({ kind: 'email', value: 'a@b.no', role: 'author' }).ok, false);
  assert.equal(validateInviteInput({ email: 'A@B.no', role: 'supervisor' }).email, 'a@b.no');
  assert.equal(emailDomain('a@b.no'), 'b.no');
});
