import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadVersions, canReadLiveDetails } from './read-policy.ts';
test('reviewers can read frozen versions without reading live annotations or traces', () => {
  const reviewer = { access: 'view', versionsOnly: true, spaceId: 'space' };
  assert.equal(canReadVersions(reviewer), true);
  assert.equal(canReadLiveDetails(reviewer), false);
});
test('course version policy stays editor-only and denied access stays denied', () => {
  for (const access of ['view', 'comment', null]) assert.equal(canReadVersions({ access, versionsOnly: false, spaceId: null }), false);
  assert.equal(canReadVersions({ access: 'edit', versionsOnly: false, spaceId: null }), true);
  assert.equal(canReadVersions({ access: null, versionsOnly: false, spaceId: 'space' }), false);
  assert.equal(canReadLiveDetails({ access: null, versionsOnly: false, spaceId: null }), false);
});
