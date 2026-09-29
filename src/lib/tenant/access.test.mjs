import test from 'node:test';
import assert from 'node:assert/strict';
import { decideSpaceAccess } from './access.ts';
import { validateAccessRuleInput, validateInviteInput, emailDomain, isUuid } from './space-roles.ts';

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

test('isUuid accepts canonical v4-shaped uuids, rejects malformed/missing input', () => {
  assert.equal(isUuid('3fa85f64-5717-4562-b3fc-2c963f66afa6'), true);
  assert.equal(isUuid('3FA85F64-5717-4562-B3FC-2C963F66AFA6'), true);
  for (const bad of ['', 'x', 'not-a-uuid', '3fa85f64-5717-4562-b3fc-2c963f66afa', '3fa85f64571745 62b3fc2c963f66afa6', 'a'.repeat(36)]) {
    assert.equal(isUuid(bad), false, bad);
  }
});

test('musiki sign-in rejects only users provisioned solely by a foreign tenant', async () => {
  const { shouldRejectMusikiSignIn } = await import('./access.ts');
  const base = { hasEnrollment: false, globalRole: 'student', hasForeignMembership: true };
  assert.equal(shouldRejectMusikiSignIn(base), true);
  assert.equal(shouldRejectMusikiSignIn({ ...base, hasEnrollment: true }), false);
  assert.equal(shouldRejectMusikiSignIn({ ...base, globalRole: 'teacher' }), false);
  assert.equal(shouldRejectMusikiSignIn({ ...base, globalRole: 'ADMIN' }), false);
  assert.equal(shouldRejectMusikiSignIn({ ...base, hasForeignMembership: false }), false);
  assert.equal(shouldRejectMusikiSignIn({ ...base, globalRole: null }), true);
});

// --- roles per space kind + open-join ---
import { ROLES_BY_KIND, GRANTABLE_BY_KIND, isRoleForKind, isGrantableForKind } from './space-roles.ts';

const commons = (o = {}) => ({ id: 's1', kind: 'commons', openJoin: false, ...o });

test('roles per kind: dissertation unchanged, commons union', () => {
  assert.deepEqual([...ROLES_BY_KIND.dissertation], ['author', 'supervisor', 'coordinator', 'reviewer', 'guest']);
  assert.deepEqual([...ROLES_BY_KIND.commons], ['admin', 'curator', 'member', 'guest']);
  assert.equal(isRoleForKind('commons', 'curator'), true);
  assert.equal(isRoleForKind('dissertation', 'curator'), false);
  assert.equal(isRoleForKind('commons', 'author'), false);
});

test('admin and author are never grantable', () => {
  assert.equal(GRANTABLE_BY_KIND.commons.includes('admin'), false);
  assert.equal(GRANTABLE_BY_KIND.dissertation.includes('author'), false);
  assert.equal(isGrantableForKind('commons', 'admin'), false);
  assert.equal(isGrantableForKind('commons', 'curator'), true);
  assert.equal(isGrantableForKind('dissertation', 'member'), false);
});

test('validators by kind', () => {
  assert.equal(validateInviteInput({ email: 'a@b.no', role: 'curator' }, 'commons').ok, true);
  assert.equal(validateInviteInput({ email: 'a@b.no', role: 'admin' }, 'commons').ok, false);
  assert.equal(validateInviteInput({ email: 'a@b.no', role: 'curator' }).ok, false);
  assert.equal(validateAccessRuleInput({ kind: 'domain', value: 'b.no', role: 'member' }, 'commons').ok, true);
  assert.equal(validateAccessRuleInput({ kind: 'domain', value: 'b.no', role: 'admin' }, 'commons').ok, false);
  assert.equal(validateAccessRuleInput({ kind: 'domain', value: 'b.no', role: 'member' }).ok, false);
});

test('commons invite grants curator; dissertation-only role is dropped in commons', () => {
  const ok = decideSpaceAccess({ ...base, spaces: [commons()], invites: [invite({ role: 'curator' })] });
  assert.equal(ok.grants[0].role, 'curator');
  const bad = decideSpaceAccess({ ...base, spaces: [commons()], invites: [invite({ role: 'supervisor' })] });
  assert.equal(bad.allowed, false);
  const admin = decideSpaceAccess({ ...base, spaces: [commons()], invites: [invite({ role: 'admin' })] });
  assert.equal(admin.allowed, false);
});

test('open-join off: no grant', () => {
  assert.deepEqual(decideSpaceAccess({ ...base, spaces: [commons()] }), { allowed: false, reason: 'no-grant' });
});

test('open-join on + verified: member grant', () => {
  const d = decideSpaceAccess({ ...base, spaces: [commons({ openJoin: true })] });
  assert.deepEqual(d.grants, [{ spaceId: 's1', role: 'member', via: 'open-join' }]);
});

test('open-join never overrides unverified', () => {
  const d = decideSpaceAccess({ ...base, emailVerified: false, spaces: [commons({ openJoin: true })] });
  assert.deepEqual(d, { allowed: false, reason: 'unverified' });
});

test('open-join yields to invites/rules and existing membership', () => {
  const inv = decideSpaceAccess({ ...base, spaces: [commons({ openJoin: true })], invites: [invite({ role: 'curator' })] });
  assert.deepEqual(inv.grants.map((g) => g.via), ['invite']);
  const rule = decideSpaceAccess({ ...base, spaces: [commons({ openJoin: true })],
    rules: [{ spaceId: 's1', kind: 'domain', value: 'nmh.no', role: 'guest' }] });
  assert.equal(rule.grants[0].role, 'guest');
  const member = decideSpaceAccess({ ...base, isMember: true, memberSpaceIds: ['s1'], spaces: [commons({ openJoin: true })] });
  assert.deepEqual(member, { allowed: true, grants: [] });
});

test('open-join never applies to dissertation spaces or unknown spaces', () => {
  const d = decideSpaceAccess({ ...base, spaces: [{ id: 's1', kind: 'dissertation', openJoin: true }] });
  assert.equal(d.allowed, false);
});

import { loadSpaceAccessContext, SPACES_SQL } from './access-context.ts';

test('open-join skips blocked spaces but invites still work', () => {
  const d = decideSpaceAccess({ ...base, spaces: [commons({ openJoin: true })], blockedSpaceIds: ['s1'] });
  assert.deepEqual(d, { allowed: false, reason: 'no-grant' });
  const i = decideSpaceAccess({ ...base, spaces: [commons({ openJoin: true })], blockedSpaceIds: ['s1'], invites: [invite({ role: 'member' })] });
  assert.equal(i.grants[0].via, 'invite');
});

test('openJoin SQL only accepts a JSON boolean true', () => {
  assert.match(SPACES_SQL, /'openJoin' = 'true'::jsonb/);
  assert.doesNotMatch(SPACES_SQL, /::boolean/);
});

test('context loader maps rows and blocks', async () => {
  const q = async (text) => text.includes('SpaceMemberBlock')
    ? { data: [{ spaceId: 's1' }], error: null }
    : { data: [{ id: 's1', kind: 'commons', openJoin: true }, { id: 's2', kind: 'course', openJoin: true }], error: null };
  const c = await loadSpaceAccessContext(q, 't', 'u1');
  assert.deepEqual(c, { spaces: [{ id: 's1', kind: 'commons', openJoin: true }, { id: 's2', kind: 'dissertation', openJoin: true }], blockedSpaceIds: ['s1'] });
});

test('context loader falls back on undefined column/table, rethrows others', async () => {
  for (const code of ['42703', '42P01']) {
    const q = async () => ({ data: null, error: { code } });
    assert.deepEqual(await loadSpaceAccessContext(q, 't', 'u1'), { spaces: [], blockedSpaceIds: [] });
  }
  const bad = async () => ({ data: null, error: { code: '22P02' } });
  await assert.rejects(() => loadSpaceAccessContext(bad, 't', 'u1'));
});

test('removal sticks against email/domain rules in commons spaces; an invite still re-admits', () => {
  const rules = [
    { spaceId: 's1', kind: 'email', value: 'ana@nmh.no', role: 'member' },
    { spaceId: 's1', kind: 'domain', value: 'nmh.no', role: 'guest' },
  ];
  const d = decideSpaceAccess({ ...base, spaces: [commons({ openJoin: true })], blockedSpaceIds: ['s1'], rules });
  assert.deepEqual(d, { allowed: false, reason: 'no-grant' });
  const i = decideSpaceAccess({ ...base, spaces: [commons()], blockedSpaceIds: ['s1'], rules, invites: [invite({ role: 'member' })] });
  assert.deepEqual(i.grants.map((g) => g.via), ['invite']);
  // Blocks only apply to commons spaces; dissertation rules are unaffected.
  const diss = decideSpaceAccess({ ...base, blockedSpaceIds: ['s1'], rules: [{ spaceId: 's1', kind: 'domain', value: 'nmh.no', role: 'guest' }] });
  assert.equal(diss.grants[0].via, 'domain-rule');
});

import { unblockOnInvite } from './access-unblock.ts';

const fakeClient = (failDelete) => {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
      if (text.includes('SpaceMemberBlock') && failDelete) throw failDelete;
      return { rows: [] };
    },
  };
};
const commonsSpaces = [{ id: 's1', kind: 'commons' }];

test('unblockOnInvite: only invite grants into commons spaces delete the block', async () => {
  for (const grant of [
    { spaceId: 's1', role: 'member', via: 'email-rule' },
    { spaceId: 's1', role: 'member', via: 'open-join' },
  ]) {
    const c = fakeClient();
    assert.equal(await unblockOnInvite(c, grant, 'u1', commonsSpaces), false);
    assert.deepEqual(c.calls, []);
  }
  const diss = fakeClient();
  assert.equal(await unblockOnInvite(diss, { spaceId: 's2', role: 'guest', via: 'invite', inviteId: 'i1' }, 'u1', [{ id: 's2', kind: 'dissertation' }]), false);
  assert.deepEqual(diss.calls, []);
  const c = fakeClient();
  assert.equal(await unblockOnInvite(c, { spaceId: 's1', role: 'member', via: 'invite', inviteId: 'i1' }, 'u1', commonsSpaces), true);
  assert.deepEqual(c.calls, ['SAVEPOINT unblock', 'DELETE FROM "SpaceMemberBlock"', 'RELEASE SAVEPOINT unblock']);
});

test('unblockOnInvite tolerates a missing block table (42P01) via savepoint; rethrows other errors', async () => {
  const grant = { spaceId: 's1', role: 'member', via: 'invite', inviteId: 'i1' };
  const missing = fakeClient(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
  assert.equal(await unblockOnInvite(missing, grant, 'u1', commonsSpaces), false);
  assert.deepEqual(missing.calls, ['SAVEPOINT unblock', 'DELETE FROM "SpaceMemberBlock"', 'ROLLBACK TO SAVEPOINT']);
  const other = fakeClient(Object.assign(new Error('deadlock'), { code: '40P01' }));
  await assert.rejects(unblockOnInvite(other, grant, 'u1', commonsSpaces), /deadlock/);
});
