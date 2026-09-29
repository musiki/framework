import test from 'node:test';
import assert from 'node:assert/strict';
import { can } from './policy.ts';

const roles = ['guest', 'member', 'curator', 'admin', null];
// columns: guest, member, curator, admin, anonymous
const T = true, F = false;
const matrix = {
  read: [T, T, T, T, T],
  vote: [T, T, T, T, F],
  post: [F, T, T, T, F],
  proposeConcept: [F, T, T, T, F],
  editDefinition: [F, F, T, T, F], // member: only with isAuthor (see ctx tests)
  adoptPost: [F, F, T, T, F],
  changeStatus: [F, F, T, T, F],
  moderate: [F, F, T, T, F],
  createRelation: [F, T, T, T, F],
  deleteRelation: [F, F, T, T, F], // member: only with isOwnRelation
  manageForums: [F, F, T, T, F],
  manageAccess: [F, F, F, T, F],
};

for (const [action, row] of Object.entries(matrix)) {
  roles.forEach((role, i) => {
    test(`${action} × ${role ?? 'anonymous'} = ${row[i]}`, () => {
      assert.equal(can(role, action), row[i]);
      // ctx flags must not widen anything for non-members / defaults
      assert.equal(can(role, action, {}), row[i]);
    });
  });
}

test('editDefinition: member only when author', () => {
  assert.equal(can('member', 'editDefinition', { isAuthor: true }), true);
  assert.equal(can('member', 'editDefinition', { isAuthor: false }), false);
  assert.equal(can('curator', 'editDefinition', { isAuthor: false }), true);
  assert.equal(can('guest', 'editDefinition', { isAuthor: true }), false);
  assert.equal(can(null, 'editDefinition', { isAuthor: true }), false);
});

test('deleteRelation: member only own relation', () => {
  assert.equal(can('member', 'deleteRelation', { isOwnRelation: true }), true);
  assert.equal(can('member', 'deleteRelation', { isOwnRelation: false }), false);
  assert.equal(can('curator', 'deleteRelation'), true);
  assert.equal(can('admin', 'deleteRelation'), true);
  assert.equal(can('guest', 'deleteRelation', { isOwnRelation: true }), false);
  assert.equal(can(null, 'deleteRelation', { isOwnRelation: true }), false);
});

test('ctx flags do not grant unrelated actions', () => {
  assert.equal(can('member', 'adoptPost', { isAuthor: true, isOwnRelation: true }), false);
  assert.equal(can('member', 'manageForums', { isAuthor: true }), false);
});

test('unknown role/action denied', () => {
  assert.equal(can('bogus', 'vote'), false);
  assert.equal(can('admin', 'nope'), false);
});
