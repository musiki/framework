import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeQuery } from './fake-query.test-helper.mjs';
import { courseAccess, createNoteAccessResolver, createNoteAccessDetail } from './access-core.ts';

// ---------------------------------------------------------------------------
// Step 1: characterization of the course branch, moved verbatim from the
// former src/pages/api/live/notes/annotations.ts getNoteAccess.
// note shape used throughout: { id, userId: 'owner', courseId: 'c1', spaceId: null }
// ---------------------------------------------------------------------------

const baseNote = { id: 'n1', userId: 'owner', courseId: 'c1', spaceId: null };

test('course: owner always gets edit, no queries needed', async () => {
  const { q, calls } = fakeQuery([]);
  const access = await courseAccess(q, baseNote, 'owner');
  assert.equal(access, 'edit');
  assert.equal(calls.length, 0);
});

test('course: teacher enrolled in the course gets edit', async () => {
  const { q } = fakeQuery([
    ['"Enrollment"', ([userId]) => (userId === 'teacher1' ? [{ roleInCourse: 'teacher' }] : [])],
  ]);
  const access = await courseAccess(q, baseNote, 'teacher1');
  assert.equal(access, 'edit');
});

test('course: student enrollment alone (not a share target) yields null', async () => {
  const { q } = fakeQuery([
    ['"Enrollment"', ([userId]) => (userId === 'student1' ? [{ roleInCourse: 'student' }] : [])],
    ['"LiveClassNoteShare"', () => []],
  ]);
  const access = await courseAccess(q, baseNote, 'student1');
  assert.equal(access, null);
});

test('course: share targetType "user" grants its accessLevel', async () => {
  const { q } = fakeQuery([
    ['"Enrollment"', () => []],
    ['"LiveClassNoteShare"', () => [{ targetType: 'user', targetId: 'stranger', accessLevel: 'comment' }]],
  ]);
  const access = await courseAccess(q, baseNote, 'stranger');
  assert.equal(access, 'comment');
});

test('course: share targetType "teachers" grants access only to enrolled teachers', async () => {
  const { q } = fakeQuery([
    ['"Enrollment"', ([userId]) => (userId === 'teacher1' ? [{ roleInCourse: 'teacher' }] : [])],
    ['"LiveClassNoteShare"', () => [{ targetType: 'teachers', targetId: null, accessLevel: 'edit' }]],
  ]);
  assert.equal(await courseAccess(q, baseNote, 'teacher1'), 'edit');
  assert.equal(await courseAccess(q, baseNote, 'other'), null);
});

test('course: share targetType "students" grants access only to enrolled students', async () => {
  const { q } = fakeQuery([
    ['"Enrollment"', ([userId]) => (userId === 'student1' ? [{ roleInCourse: 'student' }] : [])],
    ['"LiveClassNoteShare"', () => [{ targetType: 'students', targetId: null, accessLevel: 'view' }]],
  ]);
  assert.equal(await courseAccess(q, baseNote, 'student1'), 'view');
  assert.equal(await courseAccess(q, baseNote, 'other'), null);
});

test('course: share targetType "class" matches via ResourceSession classroom ids', async () => {
  const { q } = fakeQuery([
    ['"Enrollment"', () => []],
    ['"LiveClassNoteShare"', () => [{ targetType: 'class', targetId: 'clase-9', accessLevel: 'comment' }]],
    ['"ResourceSession"', () => [{ claseId: 'clase-9' }]],
    ['"Submission"', () => []],
  ]);
  const access = await courseAccess(q, baseNote, 'classmate');
  assert.equal(access, 'comment');
});

test('course: share targetType "class" matches via Submission.payload.grupo (group id and courseId/grupo)', async () => {
  const { q } = fakeQuery([
    ['"Enrollment"', () => []],
    ['"LiveClassNoteShare"', () => [{ targetType: 'class', targetId: 'c1/g2', accessLevel: 'edit' }]],
    ['"ResourceSession"', () => []],
    ['"Submission"', () => [{ grupo: 'g2' }]],
  ]);
  const access = await courseAccess(q, baseNote, 'grouped-user');
  assert.equal(access, 'edit');
});

test('course: best access across multiple matching shares wins', async () => {
  const { q } = fakeQuery([
    ['"Enrollment"', () => []],
    ['"LiveClassNoteShare"', () => [
      { targetType: 'user', targetId: 'multi', accessLevel: 'view' },
      { targetType: 'class', targetId: 'clase-9', accessLevel: 'edit' },
    ]],
    ['"ResourceSession"', () => [{ claseId: 'clase-9' }]],
    ['"Submission"', () => []],
  ]);
  const access = await courseAccess(q, baseNote, 'multi');
  assert.equal(access, 'edit');
});

test('course: stranger with no matching shares gets null', async () => {
  const { q } = fakeQuery([
    ['"Enrollment"', () => []],
    ['"LiveClassNoteShare"', () => [{ targetType: 'user', targetId: 'someone-else', accessLevel: 'edit' }]],
  ]);
  const access = await courseAccess(q, baseNote, 'stranger');
  assert.equal(access, null);
});

test('course: no shares at all gets null', async () => {
  const { q } = fakeQuery([
    ['"Enrollment"', () => []],
    ['"LiveClassNoteShare"', () => []],
  ]);
  const access = await courseAccess(q, baseNote, 'stranger');
  assert.equal(access, null);
});

test('missing note (via resolver) returns null', async () => {
  const { q } = fakeQuery([
    ['"LiveClassNote"', () => []],
  ]);
  const getNoteAccess = createNoteAccessResolver(q);
  const access = await getNoteAccess('missing-id', 'anyone', { tenantId: 'musiki' });
  assert.equal(access, null);
});

// ---------------------------------------------------------------------------
// Step 2: tenant gating + space branch (role x effective visibility)
// ---------------------------------------------------------------------------

const spaceNote = { userId: 'author', courseId: null, spaceId: 's1', visibility: null, folderId: 'gtx' };

function spaceRoutes({ tenantId = 'so', role, membershipUserId = 'user' } = {}) {
  return [
    ['"LiveClassNote"', () => [spaceNote]],
    ['"Space"', () => [{ tenantId }]],
    ['"SpaceMember"', ([, userId]) => (userId === membershipUserId && role ? [{ role }] : [])],
    ['"LiveClassNoteFolder"', () => [
      { id: 'gtx', parentId: null, visibility: 'supervision' },
      { id: 'out', parentId: null, visibility: 'committee' },
    ]],
  ];
}

test('space: supervisor on a supervision-visibility folder gets comment', async () => {
  const { q } = fakeQuery(spaceRoutes({ role: 'supervisor' }));
  const getNoteAccess = createNoteAccessResolver(q);
  const access = await getNoteAccess('n1', 'user', { tenantId: 'so' });
  assert.equal(access, 'comment');
});

test('space: coordinator on the same folder gets null', async () => {
  const { q } = fakeQuery(spaceRoutes({ role: 'coordinator' }));
  const getNoteAccess = createNoteAccessResolver(q);
  const access = await getNoteAccess('n1', 'user', { tenantId: 'so' });
  assert.equal(access, null);
});

test('space: author gets edit', async () => {
  const { q } = fakeQuery(spaceRoutes({ role: 'author' }));
  const getNoteAccess = createNoteAccessResolver(q);
  const access = await getNoteAccess('n1', 'user', { tenantId: 'so' });
  assert.equal(access, 'edit');
});

test('space: non-member gets null', async () => {
  const { q } = fakeQuery(spaceRoutes({ role: undefined }));
  const getNoteAccess = createNoteAccessResolver(q);
  const access = await getNoteAccess('n1', 'user', { tenantId: 'so' });
  assert.equal(access, null);
});

test('space: tenantId "musiki" on a space note is always null (musiki routes never open so notes)', async () => {
  const { q } = fakeQuery(spaceRoutes({ tenantId: 'so', role: 'author' }));
  const getNoteAccess = createNoteAccessResolver(q);
  const access = await getNoteAccess('n1', 'user', { tenantId: 'musiki' });
  assert.equal(access, null);
});

test('course: tenantId "so" on a course note (spaceId null) is always null (so routes never open musiki notes)', async () => {
  const { q } = fakeQuery([
    ['"LiveClassNote"', () => [{ userId: 'owner', courseId: 'c1', spaceId: null }]],
  ]);
  const getNoteAccess = createNoteAccessResolver(q);
  const access = await getNoteAccess('n1', 'owner', { tenantId: 'so' });
  assert.equal(access, null);
});

test('space: folderId pointing at another space\'s folder resolves as private (author edit; supervisor null)', async () => {
  // note.folderId is 'foreign-folder', but this space's LiveClassNoteFolder rows don't include it
  // (it belongs to a different space) — effectiveVisibility must fall through to 'private'.
  const foreignFolderNote = { userId: 'author', courseId: null, spaceId: 's1', visibility: null, folderId: 'foreign-folder' };
  const routes = [
    ['"LiveClassNote"', () => [foreignFolderNote]],
    ['"Space"', () => [{ tenantId: 'so' }]],
    ['"LiveClassNoteFolder"', () => [
      { id: 'gtx', parentId: null, visibility: 'supervision' },
      { id: 'out', parentId: null, visibility: 'committee' },
    ]],
  ];

  {
    const { q } = fakeQuery([
      ...routes,
      ['"SpaceMember"', () => [{ role: 'author' }]],
    ]);
    const getNoteAccess = createNoteAccessResolver(q);
    assert.equal(await getNoteAccess('n1', 'author', { tenantId: 'so' }), 'edit');
  }
  {
    const { q } = fakeQuery([
      ...routes,
      ['"SpaceMember"', () => [{ role: 'supervisor' }]],
    ]);
    const getNoteAccess = createNoteAccessResolver(q);
    assert.equal(await getNoteAccess('n1', 'super1', { tenantId: 'so' }), null);
  }
});

test('space: getNoteAccessDetail reports reviewer on committee as view + versionsOnly', async () => {
  const committeeNote = { userId: 'author', courseId: null, spaceId: 's1', visibility: 'committee', folderId: null };
  const { q } = fakeQuery([
    ['"LiveClassNote"', () => [committeeNote]],
    ['"Space"', () => [{ tenantId: 'so' }]],
    ['"SpaceMember"', () => [{ role: 'reviewer' }]],
    ['"LiveClassNoteFolder"', () => []],
  ]);
  const getNoteAccessDetail = createNoteAccessDetail(q);
  const detail = await getNoteAccessDetail('n1', 'reviewer1', { tenantId: 'so' });
  assert.deepEqual(detail, { access: 'view', versionsOnly: true, spaceId: 's1' });
});

test('getNoteAccessDetail never reveals spaceId when access is denied', async () => {
  // wrong tenant
  {
    const { q } = fakeQuery(spaceRoutes({ tenantId: 'so', role: 'author' }));
    const getNoteAccessDetail = createNoteAccessDetail(q);
    const detail = await getNoteAccessDetail('n1', 'user', { tenantId: 'musiki' });
    assert.deepEqual(detail, { access: null, versionsOnly: false, spaceId: null });
  }
  // non-member
  {
    const { q } = fakeQuery(spaceRoutes({ role: undefined }));
    const getNoteAccessDetail = createNoteAccessDetail(q);
    const detail = await getNoteAccessDetail('n1', 'user', { tenantId: 'so' });
    assert.deepEqual(detail, { access: null, versionsOnly: false, spaceId: null });
  }
  // member but matrix resolves to null (coordinator on a supervision-visibility folder)
  {
    const { q } = fakeQuery(spaceRoutes({ role: 'coordinator' }));
    const getNoteAccessDetail = createNoteAccessDetail(q);
    const detail = await getNoteAccessDetail('n1', 'user', { tenantId: 'so' });
    assert.deepEqual(detail, { access: null, versionsOnly: false, spaceId: null });
  }
});

test('space: LiveClassNoteShare rows are ignored for space notes', async () => {
  const { q, calls } = fakeQuery([
    ['"LiveClassNote"', () => [spaceNote]],
    ['"Space"', () => [{ tenantId: 'so' }]],
    ['"SpaceMember"', () => []], // stranger, not a member
    ['"LiveClassNoteFolder"', () => [{ id: 'gtx', parentId: null, visibility: 'supervision' }]],
    ['"LiveClassNoteShare"', () => [{ targetType: 'user', targetId: 'stranger', accessLevel: 'edit' }]],
  ]);
  const getNoteAccess = createNoteAccessResolver(q);
  const access = await getNoteAccess('n1', 'stranger', { tenantId: 'so' });
  assert.equal(access, null);
  assert.ok(!calls.some((c) => c.text.includes('"LiveClassNoteShare"')), 'share table must never be queried for space notes');
});
