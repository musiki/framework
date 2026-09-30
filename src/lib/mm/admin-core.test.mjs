import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin, setMemberRole, removeMember, setOpenJoin, revokeInvite, openJoinOf, setStanceRevealDays, settingsPatch } from './admin-core.ts';
import { stanceRevealDays } from './stances-core.ts';
import { validateInviteInput, validateAccessRuleInput } from '../tenant/space-roles.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPACE = id(1);
const ADMIN = id(2);
const OTHER = id(3);

function fakeQ(handlers) {
  const calls = [];
  const q = async (text, params = []) => {
    calls.push({ text, params });
    for (const [re, fn] of handlers) if (re.test(text)) return fn(text, params);
    return { data: [], error: null };
  };
  return { q, calls };
}
const roleOf = (role) => [/FROM "SpaceMember" m\s+JOIN "Space" s/, () => ({ data: role ? [{ role }] : [], error: null })];

test('requireAdmin: 401 anonymous, 403 for non-admins, passes admins', async () => {
  await assert.rejects(requireAdmin(fakeQ([]).q, SPACE, null), (e) => e.status === 401);
  for (const role of [null, 'guest', 'member', 'curator']) {
    await assert.rejects(requireAdmin(fakeQ([roleOf(role)]).q, SPACE, ADMIN), (e) => e.status === 403);
  }
  assert.equal(await requireAdmin(fakeQ([roleOf('admin')]).q, SPACE, ADMIN), 'admin');
});

test('invites/rules for commons never grant admin', () => {
  assert.equal(validateInviteInput({ email: 'a@b.no', role: 'admin' }, 'commons').ok, false);
  assert.equal(validateInviteInput({ email: 'a@b.no', role: 'curator' }, 'commons').ok, true);
  assert.equal(validateInviteInput({ email: 'a@b.no', role: 'author' }, 'commons').ok, false);
  assert.equal(validateAccessRuleInput({ kind: 'domain', value: 'uio.no', role: 'admin' }, 'commons').ok, false);
  assert.equal(validateAccessRuleInput({ kind: 'domain', value: 'uio.no', role: 'member' }, 'commons').ok, true);
});

const admins = (...ids) => [/role = 'admin' ORDER BY "userId" FOR UPDATE/, () => ({ data: ids.map((userId) => ({ userId })), error: null })];

test('setMemberRole: commons roles only, not yourself, 404 for non-members, in a transaction', async () => {
  const { q, calls } = fakeQ([
    admins(ADMIN),
    [/UPDATE "SpaceMember"/, (_t, p) => ({ data: p[2] === OTHER ? [{ role: p[0] }] : [], error: null })],
  ]);
  assert.deepEqual(await setMemberRole(q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: OTHER, role: 'curator' }), { userId: OTHER, role: 'curator' });
  assert.equal(calls[0].text, 'BEGIN');
  assert.match(calls[1].text, /FOR UPDATE/);
  assert.equal(calls.at(-1).text, 'COMMIT');
  await assert.rejects(setMemberRole(q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: OTHER, role: 'author' }), (e) => e.status === 400);
  await assert.rejects(setMemberRole(q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: 'x', role: 'guest' }), (e) => e.status === 400);
  await assert.rejects(setMemberRole(q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: ADMIN, role: 'guest' }), (e) => e.status === 409);
  await assert.rejects(setMemberRole(q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: id(9), role: 'guest' }), (e) => e.status === 404);
});

test('admin lockout guard: actor must still be admin; never zero admins', async () => {
  // Actor was demoted concurrently: the locked admin set no longer contains them.
  const gone = fakeQ([admins(OTHER)]);
  await assert.rejects(setMemberRole(gone.q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: OTHER, role: 'guest' }), (e) => e.status === 403);
  assert.ok(gone.calls.some((c) => c.text === 'ROLLBACK'));
  assert.ok(!gone.calls.some((c) => /UPDATE "SpaceMember"/.test(c.text)));
  // Demoting/removing the other admin while two exist is fine; the count check uses the locked rows.
  const two = fakeQ([admins(ADMIN, OTHER), [/UPDATE "SpaceMember"/, () => ({ data: [{ role: 'member' }], error: null })],
    [/DELETE FROM "SpaceMember"/, () => ({ data: [{ userId: OTHER }], error: null })]]);
  assert.equal((await setMemberRole(two.q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: OTHER, role: 'member' })).role, 'member');
  assert.deepEqual(await removeMember(two.q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: OTHER }), { removed: true });
  // Promoting to admin never trips the guard.
  const one = fakeQ([admins(ADMIN), [/UPDATE "SpaceMember"/, () => ({ data: [{ role: 'admin' }], error: null })]]);
  assert.equal((await setMemberRole(one.q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: OTHER, role: 'admin' })).role, 'admin');
});

test('removeMember locks admins, deletes the membership and inserts a SpaceMemberBlock row in one transaction', async () => {
  const { q, calls } = fakeQ([admins(ADMIN), [/DELETE FROM "SpaceMember"/, () => ({ data: [{ userId: OTHER }], error: null })]]);
  assert.deepEqual(await removeMember(q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: OTHER }), { removed: true });
  assert.equal(calls[0].text, 'BEGIN');
  assert.match(calls[1].text, /FOR UPDATE/);
  assert.match(calls[2].text, /DELETE FROM "SpaceMember"/);
  assert.match(calls[3].text, /INSERT INTO "SpaceMemberBlock" \("spaceId", "userId"\)/);
  assert.deepEqual(calls[3].params, [SPACE, OTHER]);
  assert.equal(calls.at(-1).text, 'COMMIT');
});

test('removeMember: non-member → 404 and rollback, never blocks', async () => {
  const { q, calls } = fakeQ([admins(ADMIN)]);
  await assert.rejects(removeMember(q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: OTHER }), (e) => e.status === 404);
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'));
  assert.ok(!calls.some((c) => /SpaceMemberBlock/.test(c.text)));
  await assert.rejects(removeMember(q, { spaceId: SPACE, actorUserId: ADMIN, targetUserId: ADMIN }), (e) => e.status === 409);
});

test('setOpenJoin writes a JSON boolean; rejects non-booleans', async () => {
  const { q, calls } = fakeQ([[/UPDATE "Space"/, (_t, p) => ({ data: [{ openJoin: p[0] }], error: null })]]);
  assert.deepEqual(await setOpenJoin(q, SPACE, true), { openJoin: true });
  assert.match(calls[0].text, /to_jsonb\(\$1::boolean\)/);
  for (const bad of ['true', 1, null, undefined]) await assert.rejects(setOpenJoin(q, SPACE, bad), (e) => e.status === 400);
  assert.equal(openJoinOf({ openJoin: true }), true);
  assert.equal(openJoinOf({ openJoin: 'true' }), false);
  assert.equal(openJoinOf({}), false);
});

test('setStanceRevealDays writes a JSON integer 1-90; strings and others are 400 before any write', async () => {
  const { q, calls } = fakeQ([[/UPDATE "Space"/, (_t, p) => ({ data: [{ stanceRevealDays: p[0] }], error: null })]]);
  assert.deepEqual(await setStanceRevealDays(q, SPACE, 7), { stanceRevealDays: 7 });
  assert.deepEqual(await setStanceRevealDays(q, SPACE, 1), { stanceRevealDays: 1 });
  assert.deepEqual(await setStanceRevealDays(q, SPACE, 90), { stanceRevealDays: 90 });
  assert.match(calls[0].text, /to_jsonb\(\$1::int\)/);
  assert.match(calls[0].text, /kind = 'commons'/);
  const before = calls.length;
  for (const bad of ['14', '7', 0, 91, -1, 1.5, NaN, Infinity, null, undefined, true, [14], { d: 14 }]) {
    await assert.rejects(setStanceRevealDays(q, SPACE, bad), (e) => e.status === 400, String(bad));
  }
  assert.equal(calls.length, before, 'no write for a rejected value');
  // What is stored is what the reveal-date reader understands.
  assert.equal(stanceRevealDays({ stanceRevealDays: 7 }), 7);
});

test('settingsPatch: openJoin and/or stanceRevealDays, validated together, nothing else', () => {
  assert.deepEqual(settingsPatch({ openJoin: true }), { openJoin: true });
  assert.deepEqual(settingsPatch({ stanceRevealDays: 30 }), { stanceRevealDays: 30 });
  assert.deepEqual(settingsPatch({ openJoin: false, stanceRevealDays: 3 }), { openJoin: false, stanceRevealDays: 3 });
  for (const bad of [{}, { other: 1 }, { openJoin: 'true' }, { stanceRevealDays: '14' }, { openJoin: true, stanceRevealDays: 0 }]) {
    assert.throws(() => settingsPatch(bad), (e) => e.status === 400, JSON.stringify(bad));
  }
});

test('revokeInvite validates the id and scopes to the space', async () => {
  const { q, calls } = fakeQ([[/DELETE FROM "SpaceInvite"/, () => ({ data: [{ id: id(5) }], error: null })]]);
  await revokeInvite(q, SPACE, id(5));
  assert.deepEqual(calls[0].params, [id(5), SPACE]);
  await assert.rejects(revokeInvite(q, SPACE, 'nope'), (e) => e.status === 400);
});
