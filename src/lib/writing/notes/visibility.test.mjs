import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveVisibility } from './visibility.ts';
import { resolveSpaceAccess, canManageSpace } from './space-access.ts';

const folders = new Map([
  ['gtx', { id: 'gtx', parentId: null, visibility: 'supervision' }],
  ['ch1', { id: 'ch1', parentId: 'gtx', visibility: null }],
  ['out', { id: 'out', parentId: null, visibility: 'committee' }],
  ['loop', { id: 'loop', parentId: 'loop', visibility: null }],
]);

test('note override wins', () => {
  assert.equal(effectiveVisibility({ visibility: 'private', folderId: 'gtx' }, folders), 'private');
});
test('inherits nearest ancestor', () => {
  assert.equal(effectiveVisibility({ visibility: null, folderId: 'ch1' }, folders), 'supervision');
  assert.equal(effectiveVisibility({ folderId: 'out' }, folders), 'committee');
});
test('root and unknown default to private; cycles terminate', () => {
  assert.equal(effectiveVisibility({ folderId: null }, folders), 'private');
  assert.equal(effectiveVisibility({ folderId: 'missing' }, folders), 'private');
  assert.equal(effectiveVisibility({ folderId: 'loop' }, folders), 'private');
});

const M = {
  author:      { private: 'edit', supervision: 'edit',    committee: 'edit', public: 'edit' },
  supervisor:  { private: null,   supervision: 'comment', committee: 'view', public: 'view' },
  coordinator: { private: null,   supervision: null,      committee: 'view', public: 'view' },
  reviewer:    { private: null,   supervision: null,      committee: 'view', public: 'view' },
  guest:       { private: null,   supervision: null,      committee: null,   public: 'view' },
};
test('full matrix', () => {
  for (const [role, row] of Object.entries(M)) for (const [vis, access] of Object.entries(row)) {
    assert.equal(resolveSpaceAccess(role, vis).access, access, `${role}/${vis}`);
  }
});
test('reviewer is versions-only on committee', () => {
  assert.equal(resolveSpaceAccess('reviewer', 'committee').versionsOnly, true);
  assert.equal(resolveSpaceAccess('reviewer', 'public').versionsOnly, false);
  assert.equal(resolveSpaceAccess('supervisor', 'committee').versionsOnly, false);
});
test('only author manages', () => {
  assert.equal(canManageSpace('author'), true);
  for (const r of ['supervisor', 'coordinator', 'reviewer', 'guest']) assert.equal(canManageSpace(r), false);
});
