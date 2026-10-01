import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ForumError,
  POST_MOVES,
  cleanMove,
  cleanSettingsPatch,
  forumSlug,
  publicSettings,
  listForums,
  getForum,
  listForumsAdmin,
  createForum,
  updateForum,
  listThreads,
  createThread,
  listPosts,
  createPost,
  vote,
  moderatePost,
  editPost,
  patchPost,
  deleteOwnPost,
  isEdited,
  authorizeOwnerLibraries,
  getForumByPath,
  getForumRef,
  effectiveSettings,
  isReservedChannelSlug,
  reorderChannels,
  compareChannels,
} from './forum-core.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPACE = id(1);
const FORUM = id(10);
const THREAD = id(30);
const POST = id(40);
const POST2 = id(41);
const U = { admin: id(100), curator: id(101), member: id(102), guest: id(104), stranger: id(106) };
const ROLES = { [U.admin]: 'admin', [U.curator]: 'curator', [U.member]: 'member', [U.guest]: 'guest' };

function fakeQuery(routes) {
  const calls = [];
  const q = async (text, params = []) => {
    calls.push({ text, params });
    for (const [match, handler] of routes) {
      const hit = typeof match === 'string' ? text.includes(match) : match.test(text);
      if (hit) {
        const out = handler(params, text);
        if (out && !Array.isArray(out) && 'error' in out) return { data: null, error: out.error };
        return { data: out ?? [], error: null };
      }
    }
    return { data: [], error: null };
  };
  const texts = () => calls.map((c) => c.text.trim().split(/\s+/).slice(0, 3).join(' '));
  return { q, calls, texts };
}

const memberRoute = ['"SpaceMember"', ([, userId]) => (ROLES[userId] ? [{ role: ROLES[userId] }] : [])];
const forumRow = (over = {}) => ({
  id: FORUM, slug: 'technics', title: 'Technics', description: 'd', isArchived: false,
  settings: { seshatLibraryId: 'lib-1', zoteroCollection: 'https://www.zotero.org/groups/1/c', ownerEmail: 'owner@uni.no' },
  ...over,
});
const forumByIdRoute = (row = forumRow()) => [
  /FROM "ForumBoard" b LEFT JOIN "ForumBoard" pb ON pb\.id = b\."parentId"\s+WHERE b\.id = \$1::uuid AND b\."spaceId" = \$2::uuid/,
  ([fid, sid]) => (row && fid === row.id && sid === SPACE ? [row] : []),
];
const threadByIdRoute = (row = { id: THREAD, isLocked: false, archivedAt: null, forumArchived: false }) => [
  /FROM "ForumThread" t LEFT JOIN "ForumBoard" b ON b\.id = t\."boardId" LEFT JOIN "ForumBoard" pb ON pb\.id = b\."parentId"\s+WHERE t\.id = \$1::uuid AND t\."spaceId" = \$2::uuid/,
  ([tid, sid]) => (row && tid === row.id && sid === SPACE ? [row] : []),
];
const postByIdRoute = (rows = { [POST]: { id: POST, threadId: THREAD, status: 'published' } }) => [
  /SELECT p\.id, p\."threadId", p\.status, t\."archivedAt" AS "threadArchived"/,
  ([pid, sid]) => (rows[pid] && sid === SPACE ? [rows[pid]] : []),
];

async function rejectsStatus(promise, status) {
  await assert.rejects(promise, (err) => err instanceof ForumError && err.status === status);
}

const noEmail = (value) => assert.ok(!JSON.stringify(value).includes('@'), `leaked an email: ${JSON.stringify(value)}`);

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

test('cleanMove accepts the CHECK list or null, rejects anything else', () => {
  assert.deepEqual([...POST_MOVES], ['comment', 'proposes', 'contrasts', 'combines', 'exemplifies', 'problematises', 'synthesises']);
  for (const m of POST_MOVES) assert.equal(cleanMove(m), m);
  assert.equal(cleanMove(undefined), null);
  assert.equal(cleanMove(null), null);
  assert.equal(cleanMove(''), null);
  for (const bad of ['Proposes', 'derives', 1, {}]) assert.throws(() => cleanMove(bad), (e) => e.status === 400);
});

test('forumSlug: explicit slug validated, otherwise slugified title', () => {
  assert.equal(forumSlug(undefined, 'Technics & Time'), 'technics-time');
  assert.equal(forumSlug('', 'Pharmakón'), 'pharmakon');
  assert.equal(forumSlug('my-forum', 'x'), 'my-forum');
  assert.equal(forumSlug(undefined, '???'), 'forum');
  assert.ok(forumSlug(undefined, 'a'.repeat(100)).length <= 48);
  assert.throws(() => forumSlug('Bad Slug', 'x'), (e) => e.status === 400);
  assert.throws(() => forumSlug('-x', 'x'), (e) => e.status === 400);
});

test('cleanSettingsPatch: known keys only, validated, null/"" clears', () => {
  assert.deepEqual(cleanSettingsPatch(undefined), {});
  assert.deepEqual(
    cleanSettingsPatch({ seshatLibraryId: ' lib_1:a ', zoteroCollection: 'https://www.zotero.org/groups/1', ownerEmail: ' Owner@Uni.NO ' }),
    { seshatLibraryId: 'lib_1:a', zoteroCollection: 'https://www.zotero.org/groups/1', ownerEmail: 'owner@uni.no' },
  );
  assert.deepEqual(cleanSettingsPatch({ ownerEmail: null, zoteroCollection: '' }), { ownerEmail: null, zoteroCollection: null });
  assert.deepEqual(cleanSettingsPatch({ zoteroCollection: 'ABCD1234' }), { zoteroCollection: 'ABCD1234' });
  // collection names may contain spaces; URLs must be https without whitespace
  assert.deepEqual(cleanSettingsPatch({ zoteroCollection: ' Stiegler reading group ' }), { zoteroCollection: 'Stiegler reading group' });
  for (const bad of ['https://x.org/a b', 'ftp://x.org/c', 'data:text/html,x', 'a<b', 'line\nbreak']) {
    assert.throws(() => cleanSettingsPatch({ zoteroCollection: bad }), (e) => e.status === 400, bad);
  }
  for (const bad of [
    { other: 'x' }, { ownerEmail: 'nope' }, { seshatLibraryId: 'has space' }, { zoteroCollection: 'javascript:alert(1)' },
    { zoteroCollection: 'http://insecure' }, { seshatLibraryId: 5 }, [], 'x',
  ]) {
    assert.throws(() => cleanSettingsPatch(bad), (e) => e.status === 400, JSON.stringify(bad));
  }
});

test('publicSettings never exposes ownerEmail or the library id', () => {
  const pub = publicSettings(forumRow().settings);
  assert.deepEqual(pub, { zoteroCollection: 'https://www.zotero.org/groups/1/c', hasBibliography: true });
  assert.deepEqual(publicSettings('{"seshatLibraryId":"x"}'), { zoteroCollection: null, hasBibliography: false });
  assert.deepEqual(publicSettings(null), { zoteroCollection: null, hasBibliography: false });
  noEmail(pub);
});

// ---------------------------------------------------------------------------
// Forums
// ---------------------------------------------------------------------------

const summaryRow = (over = {}) => ({
  ...forumRow(), createdAt: '2026-09-01', updatedAt: '2026-09-02', threadCount: 3, conceptCount: 2,
  lastActivityAt: '2026-09-03', ...over,
});

test('listForums: space-scoped, active only, public settings only', async () => {
  const { q, calls } = fakeQuery([['FROM "ForumBoard" b', () => [summaryRow()]]]);
  const forums = await listForums(q, { spaceId: SPACE });
  assert.equal(forums.length, 1);
  assert.equal(forums[0].slug, 'technics');
  assert.equal(forums[0].threadCount, 3);
  assert.equal(forums[0].conceptCount, 2);
  assert.deepEqual(forums[0].settings, { zoteroCollection: 'https://www.zotero.org/groups/1/c', hasBibliography: true });
  noEmail(forums);
  assert.match(calls[0].text, /b\."spaceId" = \$1::uuid AND b\."isArchived" = false/);
  assert.deepEqual(calls[0].params, [SPACE]);
  assert.deepEqual(await listForums(q, { spaceId: 'nope' }), []);
});

test('getForum: by slug in the space, null when missing or slug invalid', async () => {
  const { q, calls } = fakeQuery([['FROM "ForumBoard" b', ([, slug]) => (slug === 'technics' ? [summaryRow()] : [])]]);
  const f = await getForum(q, { spaceId: SPACE, slug: 'technics' });
  assert.equal(f.id, FORUM);
  noEmail(f);
  assert.match(calls[0].text, /b\."spaceId" = \$1::uuid AND b\."isArchived" = false/);
  assert.match(calls[0].text, /\(b\."parentId" IS NULL AND b\.slug = \$2\)/);
  assert.equal(await getForum(q, { spaceId: SPACE, slug: 'other' }), null);
  assert.equal(await getForum(q, { spaceId: SPACE, slug: "x' OR 1=1" }), null);
});

test('listForumsAdmin: curator sees full settings incl. ownerEmail; member denied', async () => {
  const { q } = fakeQuery([memberRoute, ['FROM "ForumBoard"', () => [forumRow(), forumRow({ id: id(11), slug: 'old', isArchived: true })]]]);
  const rows = await listForumsAdmin(q, { spaceId: SPACE, actorUserId: U.curator });
  assert.equal(rows[0].settings.ownerEmail, 'owner@uni.no');
  assert.equal(rows[1].isArchived, true);
  await rejectsStatus(listForumsAdmin(q, { spaceId: SPACE, actorUserId: U.member }), 403);
  await rejectsStatus(listForumsAdmin(q, { spaceId: SPACE, actorUserId: null }), 401);
});

const ownEmailsRoute = (emails = { [U.curator]: ['owner@uni.no'] }) => [
  'FROM "UserEmail"',
  ([userId]) => (emails[userId] ?? []).map((email) => ({ email })),
];

test('createForum: curator creates a space forum (no course), settings stored', async () => {
  const { q, calls } = fakeQuery([
    memberRoute,
    ownEmailsRoute(),
    ['SELECT id FROM "ForumBoard"', () => []],
    ['INSERT INTO "ForumBoard"', (p) => [{ id: FORUM, slug: p[1], title: p[2], description: p[3], isArchived: false, settings: JSON.parse(p[5]) }]],
  ]);
  const f = await createForum(q, {
    spaceId: SPACE, actorUserId: U.curator, title: 'Technics and Time', description: ' About ',
    settings: { seshatLibraryId: 'lib-1', ownerEmail: 'Owner@Uni.no', zoteroCollection: null },
  });
  assert.equal(f.slug, 'technics-and-time');
  assert.equal(f.description, 'About');
  assert.deepEqual(f.settings, { seshatLibraryId: 'lib-1', ownerEmail: 'owner@uni.no' });
  const ins = calls.find((c) => c.text.includes('INSERT INTO "ForumBoard"'));
  assert.ok(!ins.text.includes('"courseId"'));
  assert.deepEqual(ins.params.slice(0, 5), [SPACE, 'technics-and-time', 'Technics and Time', 'About', U.curator]);
});

test('createForum: permission, validation, slug conflicts', async () => {
  const taken = fakeQuery([memberRoute, ['SELECT id FROM "ForumBoard"', () => [{ id: FORUM }]]]);
  await rejectsStatus(createForum(taken.q, { spaceId: SPACE, actorUserId: U.curator, title: 'Technics' }), 409);

  const race = fakeQuery([
    memberRoute,
    ['SELECT id FROM "ForumBoard"', () => []],
    ['INSERT INTO "ForumBoard"', () => ({ error: Object.assign(new Error('dup'), { code: '23505' }) })],
  ]);
  await rejectsStatus(createForum(race.q, { spaceId: SPACE, actorUserId: U.admin, title: 'Technics' }), 409);

  const { q } = fakeQuery([memberRoute]);
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.member, title: 'Technics' }), 403);
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.stranger, title: 'Technics' }), 403);
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: null, title: 'Technics' }), 401);
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'ab' }), 400);
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Technics', settings: { ownerEmail: 'x' } }), 400);
});

test('updateForum: partial update, settings merged with jsonb (null clears), space-pinned', async () => {
  const { q, calls } = fakeQuery([
    memberRoute,
    forumByIdRoute(),
    ['UPDATE "ForumBoard"', () => [forumRow({ title: 'New', settings: { seshatLibraryId: 'lib-2' } })]],
  ]);
  const f = await updateForum(q, {
    spaceId: SPACE, forumId: FORUM, actorUserId: U.curator, title: 'New',
    settings: { seshatLibraryId: 'lib-2', ownerEmail: null },
  });
  assert.equal(f.title, 'New');
  const up = calls.find((c) => c.text.includes('UPDATE "ForumBoard"'));
  assert.match(up.text, /title = \$1/);
  assert.match(up.text, /settings = jsonb_strip_nulls\(COALESCE\(settings, '\{\}'::jsonb\) \|\| \$2::jsonb\)/);
  assert.match(up.text, /WHERE id = \$3::uuid AND "spaceId" = \$4::uuid/);
  assert.deepEqual(up.params, ['New', JSON.stringify({ seshatLibraryId: 'lib-2', ownerEmail: null }), FORUM, SPACE]);
});

test('updateForum: archive flag, nothing to update, other space forum 404, member 403', async () => {
  const { q, calls } = fakeQuery([memberRoute, forumByIdRoute(), ['UPDATE "ForumBoard"', () => [forumRow({ isArchived: true })]]]);
  const f = await updateForum(q, { spaceId: SPACE, forumId: FORUM, actorUserId: U.admin, isArchived: true });
  assert.equal(f.isArchived, true);
  assert.deepEqual(calls.at(-1).params, [true, FORUM, SPACE]);
  await rejectsStatus(updateForum(q, { spaceId: SPACE, forumId: FORUM, actorUserId: U.admin }), 400);
  await rejectsStatus(updateForum(q, { spaceId: SPACE, forumId: FORUM, actorUserId: U.admin, isArchived: 'yes' }), 400);
  await rejectsStatus(updateForum(q, { spaceId: SPACE, forumId: id(99), actorUserId: U.admin, title: 'New' }), 404);
  await rejectsStatus(updateForum(q, { spaceId: SPACE, forumId: 'not-a-uuid', actorUserId: U.admin, title: 'New' }), 404);
  await rejectsStatus(updateForum(q, { spaceId: SPACE, forumId: FORUM, actorUserId: U.member, title: 'New' }), 403);
});

test('forum bibliography owner: admins set any; curators only their own email', async () => {
  const insert = ['INSERT INTO "ForumBoard"', (p) => [{ id: FORUM, slug: p[1], title: p[2], description: p[3], isArchived: false, settings: JSON.parse(p[5]) }]];
  const base = [memberRoute, ownEmailsRoute({ [U.curator]: ['me@uni.no'] }), ['SELECT id FROM "ForumBoard"', () => []], insert];
  const { q } = fakeQuery(base);
  const other = { seshatLibraryId: 'lib-1', ownerEmail: 'someone@else.org' };
  // admin: anyone's email
  const a = await createForum(q, { spaceId: SPACE, actorUserId: U.admin, title: 'Admin forum', settings: other });
  assert.equal(a.settings.ownerEmail, 'someone@else.org');
  // curator: someone else's email refused, own (any case) accepted
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Curator forum', settings: other }), 403);
  const c = await createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Curator forum', settings: { seshatLibraryId: 'lib-1', ownerEmail: 'Me@Uni.no' } });
  assert.equal(c.settings.ownerEmail, 'me@uni.no');
  // curator without owner fields: no email lookup needed
  await createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Plain forum', settings: { zoteroCollection: 'ABCD' } });

  // update: curator cannot point an admin-owned forum at another library, nor take it over with a foreign owner
  const upd = (row) => fakeQuery([
    memberRoute, ownEmailsRoute({ [U.curator]: ['me@uni.no'] }), forumByIdRoute(row),
    ['UPDATE "ForumBoard"', () => [row]],
  ]).q;
  const adminOwned = forumRow(); // ownerEmail owner@uni.no (not the curator's)
  await rejectsStatus(updateForum(upd(adminOwned), { spaceId: SPACE, forumId: FORUM, actorUserId: U.curator, settings: { seshatLibraryId: 'lib-9' } }), 403);
  await rejectsStatus(updateForum(upd(adminOwned), { spaceId: SPACE, forumId: FORUM, actorUserId: U.curator, settings: { ownerEmail: 'x@y.org' } }), 403);
  // ...but may switch it to their own email, clear the link, or edit other fields
  await updateForum(upd(adminOwned), { spaceId: SPACE, forumId: FORUM, actorUserId: U.curator, settings: { ownerEmail: 'me@uni.no', seshatLibraryId: 'lib-9' } });
  await updateForum(upd(adminOwned), { spaceId: SPACE, forumId: FORUM, actorUserId: U.curator, settings: { ownerEmail: null } });
  await updateForum(upd(adminOwned), { spaceId: SPACE, forumId: FORUM, actorUserId: U.curator, settings: { zoteroCollection: 'ABCD' } });
  const mine = forumRow({ settings: { seshatLibraryId: 'lib-1', ownerEmail: 'me@uni.no' } });
  await updateForum(upd(mine), { spaceId: SPACE, forumId: FORUM, actorUserId: U.curator, settings: { seshatLibraryId: 'lib-2' } });
  await updateForum(upd(adminOwned), { spaceId: SPACE, forumId: FORUM, actorUserId: U.admin, settings: { seshatLibraryId: 'lib-2', ownerEmail: 'any@one.org' } });
});

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

test('listThreads: forum of the space, display names only, concept marker, own flag', async () => {
  const { q, calls } = fakeQuery([
    forumByIdRoute(),
    ['FROM "ForumThread" t', () => [
      { id: THREAD, title: 'Pharmakon', isPinned: true, isLocked: false, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
        createdByUserId: U.member, createdByName: 'Ada', conceptSlug: 'pharmakon', conceptLabel: 'Pharmakon', postCount: 4,
        lastPostAt: '2026-09-05T00:00:00Z' },
      { id: id(31), title: 'Open question', isPinned: false, isLocked: true, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-03T00:00:00Z',
        createdByUserId: U.curator, createdByName: null, conceptSlug: null, conceptLabel: null, postCount: 0, lastPostAt: null },
    ]],
  ]);
  const threads = await listThreads(q, { spaceId: SPACE, forumId: FORUM, viewerUserId: U.member });
  assert.equal(threads.length, 2);
  assert.deepEqual(threads[0].createdBy, { name: 'Ada', deleted: false });
  assert.equal(threads[0].own, true);
  assert.equal(threads[1].own, false);
  assert.deepEqual(threads[0].concept, { slug: 'pharmakon', label: 'Pharmakon' });
  assert.equal(threads[0].kind, 'concept');
  assert.equal(threads[1].kind, 'post');
  assert.equal(threads[1].relationType, null);
  assert.equal(threads[0].lastActivityAt, '2026-09-05T00:00:00Z');
  assert.equal(threads[1].lastActivityAt, '2026-09-03T00:00:00Z');
  assert.ok(!JSON.stringify(threads).includes(U.member), 'no user ids');
  const list = calls.find((c) => c.text.includes('FROM "ForumThread" t'));
  assert.match(list.text, /t\."spaceId" = \$1::uuid AND t\."boardId" = \$2::uuid AND t\."archivedAt" IS NULL/);
  await rejectsStatus(listThreads(q, { spaceId: SPACE, forumId: id(99) }), 404);
});

test('listThreads: relation-type threads and threads that ground a relation are of kind relation', async () => {
  const base = { isPinned: false, isLocked: false, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
    createdByUserId: U.member, createdByName: 'Ada', conceptSlug: null, conceptLabel: null, postCount: 1, lastPostAt: null };
  const { q, calls } = fakeQuery([
    forumByIdRoute(),
    ['FROM "ForumThread" t', () => [
      { ...base, id: id(41), title: 'Contains', relationTypeSlug: 'contains', relationTypeLabel: 'contains', groundsRelation: false },
      { ...base, id: id(42), title: 'Why A derives from B', relationTypeSlug: null, relationTypeLabel: null, groundsRelation: true },
      { ...base, id: id(43), title: 'Pharmakon', conceptSlug: 'pharmakon', conceptLabel: 'Pharmakon', relationTypeSlug: null, groundsRelation: true },
    ]],
  ]);
  const threads = await listThreads(q, { spaceId: SPACE, forumId: FORUM });
  assert.deepEqual(threads.map((t) => t.kind), ['relation', 'relation', 'concept']);
  assert.deepEqual(threads[0].relationType, { slug: 'contains', label: 'contains' });
  assert.equal(threads[1].relationType, null);
  const list = calls.find((c) => c.text.includes('FROM "ForumThread" t'));
  assert.match(list.text, /rc\.kind = 'relation-type'/);
  assert.match(list.text, /fp\."threadId" = t\.id AND fp\.status = 'published'/);
});

test('listThreads: archived forum is not found', async () => {
  const { q } = fakeQuery([forumByIdRoute(forumRow({ isArchived: true }))]);
  await rejectsStatus(listThreads(q, { spaceId: SPACE, forumId: FORUM }), 404);
});

test('createThread: member creates thread (spaceId + boardId, no course) and first post with move, in a transaction', async () => {
  const { q, calls, texts } = fakeQuery([
    memberRoute,
    forumByIdRoute(),
    ['INSERT INTO "ForumThread"', () => [{ id: THREAD }]],
    ['INSERT INTO "ForumPost"', () => [{ id: POST }]],
  ]);
  const out = await createThread(q, { spaceId: SPACE, forumId: FORUM, actorUserId: U.member, title: 'Pharmakon?', body: 'Is it?', move: 'problematises' });
  assert.deepEqual(out, { threadId: THREAD, postId: POST });
  const t = texts();
  assert.ok(t.indexOf('BEGIN') < t.indexOf('INSERT INTO "ForumThread"'));
  assert.equal(t.at(-1), 'COMMIT');
  const th = calls.find((c) => c.text.includes('INSERT INTO "ForumThread"'));
  assert.ok(!th.text.includes('"courseId"') && !th.text.includes('"lessonSlug"'));
  assert.deepEqual(th.params, [SPACE, FORUM, 'Pharmakon?', U.member]);
  const po = calls.find((c) => c.text.includes('INSERT INTO "ForumPost"'));
  assert.deepEqual(po.params, [THREAD, U.member, 'Is it?', 'problematises']);
});

test('createThread: rollback when the first post fails; guest/anon denied; bad move 400', async () => {
  const failing = fakeQuery([
    memberRoute,
    forumByIdRoute(),
    ['INSERT INTO "ForumThread"', () => [{ id: THREAD }]],
    ['INSERT INTO "ForumPost"', () => ({ error: new Error('boom') })],
  ]);
  await assert.rejects(createThread(failing.q, { spaceId: SPACE, forumId: FORUM, actorUserId: U.member, title: 'Title', body: 'b' }));
  assert.equal(failing.texts().at(-1), 'ROLLBACK');

  const { q } = fakeQuery([memberRoute, forumByIdRoute()]);
  await rejectsStatus(createThread(q, { spaceId: SPACE, forumId: FORUM, actorUserId: U.guest, title: 'Title', body: 'b' }), 403);
  await rejectsStatus(createThread(q, { spaceId: SPACE, forumId: FORUM, actorUserId: null, title: 'Title', body: 'b' }), 401);
  await rejectsStatus(createThread(q, { spaceId: SPACE, forumId: FORUM, actorUserId: U.member, title: 'Title', body: 'b', move: 'rants' }), 400);
  await rejectsStatus(createThread(q, { spaceId: SPACE, forumId: FORUM, actorUserId: U.member, title: 'Title', body: '  ' }), 400);
  await rejectsStatus(createThread(q, { spaceId: SPACE, forumId: id(99), actorUserId: U.member, title: 'Title', body: 'b' }), 404);
});

// ---------------------------------------------------------------------------
// listPosts
// ---------------------------------------------------------------------------

const threadRow = (over = {}) => ({
  id: THREAD, title: 'Pharmakon', isPinned: false, isLocked: false, createdAt: 't0', updatedAt: 't1', archivedAt: null,
  createdByUserId: U.member, createdByName: 'Ada', forumId: FORUM, forumSlug: 'technics', forumTitle: 'Technics',
  conceptSlug: 'pharmakon', conceptLabel: 'Pharmakon', ...over,
});
const postRows = () => [
  { id: POST, parentPostId: null, authorUserId: U.member, body: 'First $x$', status: 'published', move: 'proposes',
    adoptedAsVersionId: id(60), adoptedLang: 'en', adoptedConceptSlug: 'pharmakon', createdAt: 't2', updatedAt: 't2', authorName: 'Ada' },
  { id: POST2, parentPostId: POST, authorUserId: U.curator, body: 'Hidden reply', status: 'hidden', move: null,
    adoptedAsVersionId: null, createdAt: 't3', updatedAt: 't3', authorName: 'Bo' },
  { id: id(42), parentPostId: null, authorUserId: null, body: '', status: 'deleted', move: 'bogus',
    adoptedAsVersionId: null, createdAt: 't4', updatedAt: 't4', authorName: null },
];
const postsDb = (over = {}) => fakeQuery([
  memberRoute,
  [/FROM "ForumThread" t\s+LEFT JOIN "User"/, ([tid, sid]) => (tid === THREAD && sid === SPACE ? [threadRow(over)] : [])],
  ['FROM "ForumPost" p\n     LEFT JOIN "User"', () => postRows()],
  ['FROM "ForumPostVote" v', ([, viewer]) => [
    { postId: POST, value: 1, n: 2, mine: viewer === U.member },
    { postId: POST, value: 3, n: 1, mine: false },
    { postId: POST, value: 9, n: 5, mine: false },
  ]],
]);

test('listPosts: rendered bodies, moves, votes, adopted marker, display names only', async () => {
  const { q, calls } = postsDb();
  const rendered = [];
  const render = async (md) => {
    rendered.push(md);
    return `<p>${md}</p>`;
  };
  const view = await listPosts(q, { spaceId: SPACE, threadId: THREAD, viewerUserId: U.member, render });
  assert.equal(view.thread.title, 'Pharmakon');
  assert.deepEqual(view.thread.forum, { id: FORUM, slug: 'technics', title: 'Technics', parent: null });
  assert.deepEqual(view.thread.concept, { slug: 'pharmakon', label: 'Pharmakon' });
  assert.deepEqual(view.viewer, { role: 'member', canPost: true, canVote: true, canModerate: false, canAdopt: false });

  const [p1, p2, p3] = view.posts;
  assert.equal(p1.bodyHtml, '<p>First $x$</p>');
  assert.equal(p1.move, 'proposes');
  assert.deepEqual(p1.votes, { useful: 2, clarifies: 0, reference: 1, total: 3 });
  assert.equal(p1.myVote, 1);
  assert.deepEqual(p1.adopted, { versionId: id(60), lang: 'en', conceptSlug: 'pharmakon' });
  assert.deepEqual(p1.author, { name: 'Ada', deleted: false });
  assert.equal(p1.own, true);

  // hidden: body withheld from non-moderators; deleted: never shown; unknown move dropped
  assert.equal(p2.status, 'hidden');
  assert.equal(p2.body, null);
  assert.equal(p2.bodyHtml, '');
  assert.equal(p2.parentPostId, POST);
  assert.equal(p3.status, 'deleted');
  assert.equal(p3.body, null);
  assert.equal(p3.move, null);
  assert.deepEqual(p3.author, { name: null, deleted: true });
  assert.deepEqual(rendered, ['First $x$']);

  const json = JSON.stringify(view);
  noEmail(view);
  for (const uid of [U.member, U.curator]) assert.ok(!json.includes(uid), 'no user ids in the view');
  const sel = calls.find((c) => c.text.includes('u.name AS "authorName"'));
  assert.ok(!/u\.email/.test(sel.text), 'never selects User.email');
});

test('listPosts: moderators see hidden bodies; anonymous gets read-only view', async () => {
  const mod = await listPosts(postsDb().q, { spaceId: SPACE, threadId: THREAD, viewerUserId: U.curator });
  assert.equal(mod.posts[1].body, 'Hidden reply');
  assert.ok(mod.posts[1].bodyHtml.includes('Hidden reply'));
  assert.equal(mod.viewer.canModerate, true);
  assert.equal(mod.viewer.canAdopt, true);

  const anon = await listPosts(postsDb().q, { spaceId: SPACE, threadId: THREAD });
  assert.deepEqual(anon.viewer, { role: null, canPost: false, canVote: false, canModerate: false, canAdopt: false });
  assert.equal(anon.posts[0].myVote, 0);
  assert.equal(anon.posts[0].own, false);
});

test('listPosts: default renderer escapes HTML; render errors fall back to escaped text', async () => {
  const view = await listPosts(postsDb().q, { spaceId: SPACE, threadId: THREAD });
  assert.equal(view.posts[0].bodyHtml, '<p>First $x$</p>');
  const failing = await listPosts(postsDb().q, {
    spaceId: SPACE, threadId: THREAD, render: async () => { throw new Error('katex'); },
  });
  assert.equal(failing.posts[0].bodyHtml, '<p>First $x$</p>');
});

test('listPosts: locked thread blocks posting for members but not moderators', async () => {
  const member = await listPosts(postsDb({ isLocked: true }).q, { spaceId: SPACE, threadId: THREAD, viewerUserId: U.member });
  assert.equal(member.viewer.canPost, false);
  const cur = await listPosts(postsDb({ isLocked: true }).q, { spaceId: SPACE, threadId: THREAD, viewerUserId: U.curator });
  assert.equal(cur.viewer.canPost, true);
});

test('listPosts: null for other-space/course threads, archived threads and bad ids', async () => {
  const { q, calls } = postsDb();
  assert.equal(await listPosts(q, { spaceId: SPACE, threadId: id(77) }), null);
  assert.match(calls[0].text, /t\.id = \$1::uuid AND t\."spaceId" = \$2::uuid/);
  assert.equal(await listPosts(postsDb({ archivedAt: 't9' }).q, { spaceId: SPACE, threadId: THREAD }), null);
  assert.equal(await listPosts(q, { spaceId: SPACE, threadId: 'x' }), null);
});

// ---------------------------------------------------------------------------
// createPost
// ---------------------------------------------------------------------------

const createPostDb = (thread, parent = [{ id: POST }]) => fakeQuery([
  memberRoute,
  threadByIdRoute(thread),
  [/SELECT id FROM "ForumPost" WHERE id = \$1::uuid AND "threadId" = \$2::uuid/, () => parent],
  ['INSERT INTO "ForumPost"', () => [{ id: POST2, createdAt: 't5' }]],
]);

test('createPost: reply with move in the same thread; thread activity touched in the transaction', async () => {
  const { q, calls, texts } = createPostDb();
  const out = await createPost(q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.member, body: ' Yes ', move: 'contrasts', parentPostId: POST });
  assert.deepEqual(out, { id: POST2, threadId: THREAD, parentPostId: POST, move: 'contrasts', createdAt: 't5' });
  const ins = calls.find((c) => c.text.includes('INSERT INTO "ForumPost"'));
  assert.deepEqual(ins.params, [THREAD, U.member, POST, 'Yes', 'contrasts']);
  const parent = calls.find((c) => c.text.includes('"threadId" = $2::uuid'));
  assert.deepEqual(parent.params, [POST, THREAD]);
  const t = texts();
  assert.ok(t.indexOf('BEGIN') < t.indexOf('INSERT INTO "ForumPost"'));
  assert.ok(t.includes('UPDATE "ForumThread" SET'));
  assert.equal(t.at(-1), 'COMMIT');
});

test('createPost: plain post (no move, no parent)', async () => {
  const { q, calls } = createPostDb();
  const out = await createPost(q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.admin, body: 'Hi' });
  assert.equal(out.move, null);
  assert.equal(out.parentPostId, null);
  assert.ok(!calls.some((c) => c.text.includes('"threadId" = $2::uuid')), 'no parent lookup');
});

test('createPost: parent must be in the same thread; invalid move 400', async () => {
  const other = createPostDb(undefined, []);
  await rejectsStatus(createPost(other.q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.member, body: 'x', parentPostId: id(55) }), 400);
  await rejectsStatus(createPost(other.q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.member, body: 'x', parentPostId: 'nope' }), 400);
  const { q } = createPostDb();
  await rejectsStatus(createPost(q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.member, body: 'x', move: 'derives' }), 400);
});

test('createPost: permissions, unknown/archived thread, locked thread', async () => {
  const { q } = createPostDb();
  await rejectsStatus(createPost(q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.guest, body: 'x' }), 403);
  await rejectsStatus(createPost(q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.stranger, body: 'x' }), 403);
  await rejectsStatus(createPost(q, { spaceId: SPACE, threadId: THREAD, actorUserId: null, body: 'x' }), 401);
  await rejectsStatus(createPost(q, { spaceId: SPACE, threadId: id(77), actorUserId: U.member, body: 'x' }), 404);

  const archived = createPostDb({ id: THREAD, isLocked: false, archivedAt: 't', forumArchived: false });
  await rejectsStatus(createPost(archived.q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.member, body: 'x' }), 404);

  const archivedForum = createPostDb({ id: THREAD, isLocked: false, archivedAt: null, forumArchived: true });
  await rejectsStatus(createPost(archivedForum.q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.member, body: 'x' }), 404);

  const locked = createPostDb({ id: THREAD, isLocked: true, archivedAt: null, forumArchived: false });
  await rejectsStatus(createPost(locked.q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.member, body: 'x' }), 403);
  const ok = await createPost(locked.q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.curator, body: 'x' });
  assert.equal(ok.id, POST2);
});

// ---------------------------------------------------------------------------
// vote
// ---------------------------------------------------------------------------

test('vote: one per user (upsert on post+user), guests may vote, snapshot returned', async () => {
  const { q, calls } = fakeQuery([
    memberRoute,
    postByIdRoute(),
    ['INSERT INTO "ForumPostVote"', () => [{ value: 2 }]],
    ['SELECT "userId", value FROM "ForumPostVote"', () => [{ userId: U.guest, value: 2 }, { userId: U.member, value: 1 }]],
  ]);
  const out = await vote(q, { spaceId: SPACE, postId: POST, actorUserId: U.guest, value: 2 });
  assert.deepEqual(out, { postId: POST, votes: { useful: 1, clarifies: 1, reference: 0, total: 2 }, myVote: 2 });
  const up = calls.find((c) => c.text.includes('INSERT INTO "ForumPostVote"'));
  assert.match(up.text, /ON CONFLICT \("postId", "userId"\) DO UPDATE SET value = EXCLUDED\.value/);
  assert.deepEqual(up.params, [POST, U.guest, 2, SPACE]);
  assert.match(up.text, /SELECT \$1::uuid, \$2::uuid, \$3::smallint\s+WHERE EXISTS/);
  assert.match(up.text, /op\.status = 'published' AND ot\."spaceId" = \$4::uuid\s+AND ot\."archivedAt" IS NULL AND ob\."isArchived" IS NOT TRUE/);
  assert.ok(!JSON.stringify(out).includes(U.member));
});

test('vote: 0 removes my vote', async () => {
  const { q, calls } = fakeQuery([memberRoute, postByIdRoute(), ['SELECT "userId", value', () => []]]);
  const out = await vote(q, { spaceId: SPACE, postId: POST, actorUserId: U.member, value: 0 });
  assert.equal(out.myVote, 0);
  const del = calls.find((c) => c.text.includes('DELETE FROM "ForumPostVote"'));
  assert.deepEqual(del.params, [POST, U.member, SPACE]);
  assert.match(del.text, /ot\."spaceId" = \$3::uuid/);
});

test('vote: anonymous 401, non-member 403, bad value 400, other-space post 404, hidden post 409', async () => {
  const { q } = fakeQuery([memberRoute, postByIdRoute({
    [POST]: { id: POST, threadId: THREAD, status: 'published' },
    [POST2]: { id: POST2, threadId: THREAD, status: 'hidden' },
  })]);
  await rejectsStatus(vote(q, { spaceId: SPACE, postId: POST, actorUserId: null, value: 1 }), 401);
  await rejectsStatus(vote(q, { spaceId: SPACE, postId: POST, actorUserId: U.stranger, value: 1 }), 403);
  for (const value of [4, -1, '1', 1.5, null]) {
    await rejectsStatus(vote(q, { spaceId: SPACE, postId: POST, actorUserId: U.member, value }), 400);
  }
  await rejectsStatus(vote(q, { spaceId: SPACE, postId: id(77), actorUserId: U.member, value: 1 }), 404);
  await rejectsStatus(vote(q, { spaceId: SPACE, postId: POST2, actorUserId: U.member, value: 1 }), 409);
});

// ---------------------------------------------------------------------------
// moderatePost
// ---------------------------------------------------------------------------

const modDb = (status = 'published') => fakeQuery([
  memberRoute,
  postByIdRoute({ [POST]: { id: POST, threadId: THREAD, status } }),
  ['UPDATE "ForumPost"', (p) => [{ status: p[0] }]],
]);

test('moderatePost: hide / unhide / soft delete by curators', async () => {
  const hide = modDb('published');
  assert.deepEqual(await moderatePost(hide.q, { spaceId: SPACE, postId: POST, actorUserId: U.curator, action: 'hide' }), { postId: POST, status: 'hidden' });
  assert.deepEqual(hide.calls.at(-1).params, ['hidden', POST, 'published', SPACE]);
  assert.match(hide.calls.at(-1).text, /WHERE p\.id = \$2::uuid AND p\.status = \$3\s+AND EXISTS \(SELECT 1 FROM "ForumThread" t WHERE t\.id = p\."threadId" AND t\."spaceId" = \$4::uuid\)/);

  const unhide = modDb('hidden');
  assert.deepEqual(await moderatePost(unhide.q, { spaceId: SPACE, postId: POST, actorUserId: U.admin, action: 'unhide' }), { postId: POST, status: 'published' });

  const del = modDb('hidden');
  assert.deepEqual(await moderatePost(del.q, { spaceId: SPACE, postId: POST, actorUserId: U.curator, action: 'delete' }), { postId: POST, status: 'deleted' });
  assert.match(del.calls.at(-1).text, /body = CASE WHEN \$1 = 'deleted' THEN '' ELSE p\.body END/);
  assert.deepEqual(del.calls.at(-1).params, ['deleted', POST, 'hidden', SPACE]);
});

test('moderatePost: members 403, invalid transitions 409, bad action 400, unknown post 404', async () => {
  await rejectsStatus(moderatePost(modDb().q, { spaceId: SPACE, postId: POST, actorUserId: U.member, action: 'hide' }), 403);
  await rejectsStatus(moderatePost(modDb().q, { spaceId: SPACE, postId: POST, actorUserId: null, action: 'hide' }), 401);
  await rejectsStatus(moderatePost(modDb().q, { spaceId: SPACE, postId: POST, actorUserId: U.curator, action: 'ban' }), 400);
  await rejectsStatus(moderatePost(modDb('hidden').q, { spaceId: SPACE, postId: POST, actorUserId: U.curator, action: 'hide' }), 409);
  await rejectsStatus(moderatePost(modDb('published').q, { spaceId: SPACE, postId: POST, actorUserId: U.curator, action: 'unhide' }), 409);
  await rejectsStatus(moderatePost(modDb('deleted').q, { spaceId: SPACE, postId: POST, actorUserId: U.curator, action: 'delete' }), 409);
  await rejectsStatus(moderatePost(modDb().q, { spaceId: SPACE, postId: id(77), actorUserId: U.curator, action: 'hide' }), 404);
});

// ---------------------------------------------------------------------------
// Scope: every forum-core statement on forum tables is pinned to the space
// ---------------------------------------------------------------------------

test('all thread/post/forum reads and writes filter by the space (never course rows)', async () => {
  const all = [];
  const collect = async (db, fn) => {
    try {
      await fn(db.q);
    } catch {
      /* permission/validation paths are fine; we only inspect SQL */
    }
    all.push(...db.calls);
  };
  await collect(postsDb(), (q) => listPosts(q, { spaceId: SPACE, threadId: THREAD, viewerUserId: U.member }));
  await collect(createPostDb(), (q) => createPost(q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.member, body: 'x', parentPostId: POST }));
  await collect(modDb(), (q) => moderatePost(q, { spaceId: SPACE, postId: POST, actorUserId: U.curator, action: 'hide' }));
  await collect(fakeQuery([memberRoute, postByIdRoute()]), (q) => vote(q, { spaceId: SPACE, postId: POST, actorUserId: U.member, value: 1 }));
  await collect(fakeQuery([forumByIdRoute()]), (q) => listThreads(q, { spaceId: SPACE, forumId: FORUM }));
  // Entry points into a thread/post/forum by id must carry the space predicate.
  const entry = all.filter((c) => /WHERE (p\.|t\.|b\.)?id = \$1::uuid/.test(c.text) && /"(ForumThread|ForumBoard)"/.test(c.text) && !c.text.startsWith('UPDATE "ForumPost"'));
  assert.ok(entry.length >= 4);
  for (const c of entry) assert.ok(/"spaceId" = \$2::uuid/.test(c.text), c.text);
});

// ---------------------------------------------------------------------------
// Fix round 1: archive guards, pinned writes, concept join
// ---------------------------------------------------------------------------

test('listPosts: thread in an archived forum is not found', async () => {
  assert.equal(await listPosts(postsDb({ forumArchived: true }).q, { spaceId: SPACE, threadId: THREAD }), null);
});

test('vote: post in an archived thread or forum is not found', async () => {
  const { q } = fakeQuery([memberRoute, postByIdRoute({
    [POST]: { id: POST, threadId: THREAD, status: 'published', threadArchived: null, forumArchived: true },
    [POST2]: { id: POST2, threadId: THREAD, status: 'published', threadArchived: 't', forumArchived: false },
  })]);
  await rejectsStatus(vote(q, { spaceId: SPACE, postId: POST, actorUserId: U.member, value: 1 }), 404);
  await rejectsStatus(vote(q, { spaceId: SPACE, postId: POST2, actorUserId: U.member, value: 1 }), 404);
});

test('vote: the pinned upsert writing nothing (hidden/archived meanwhile) is a 409', async () => {
  const { q } = fakeQuery([memberRoute, postByIdRoute(), ['INSERT INTO "ForumPostVote"', () => []]]);
  await rejectsStatus(vote(q, { spaceId: SPACE, postId: POST, actorUserId: U.member, value: 1 }), 409);
});

test('moderatePost: pinned update matching nothing (status changed meanwhile) is a 409', async () => {
  const { q } = fakeQuery([memberRoute, postByIdRoute(), ['UPDATE "ForumPost"', () => []]]);
  await rejectsStatus(moderatePost(q, { spaceId: SPACE, postId: POST, actorUserId: U.curator, action: 'hide' }), 409);
});

test('thread reads take at most one concept per thread (LATERAL … LIMIT 1)', async () => {
  const list = fakeQuery([forumByIdRoute(), ['FROM "ForumThread" t', () => []]]);
  await listThreads(list.q, { spaceId: SPACE, forumId: FORUM });
  const posts = postsDb();
  await listPosts(posts.q, { spaceId: SPACE, threadId: THREAD });
  for (const c of [...list.calls, ...posts.calls].filter((c) => c.text.includes('"Concept" c'))) {
    assert.match(c.text, /LEFT JOIN LATERAL \(\s+SELECT c\.slug, c\.label FROM "Concept" c[\s\S]*LIMIT 1\s+\) c ON true/);
    assert.match(c.text, /c\.kind = 'concept'/);
  }
});

test('listPosts passes the post identity to the renderer (render cache key)', async () => {
  const seen = [];
  await listPosts(postsDb().q, {
    spaceId: SPACE, threadId: THREAD, render: async (md, post) => { seen.push(post); return md; },
  });
  assert.deepEqual(seen, [{ id: POST, updatedAt: 't2', forumId: FORUM, forumBibliography: '|' }]);
});

test('user names that look like e-mails never leave the core', async () => {
  const { q } = fakeQuery([
    memberRoute,
    [/FROM "ForumThread" t\s+LEFT JOIN "User" u/, () => [{
      id: THREAD, title: 'T', isPinned: false, isLocked: false, createdAt: 't', updatedAt: 't', archivedAt: null,
      createdByUserId: U.member, createdByName: 'me@uni.no', forumId: FORUM, forumSlug: 'technics', forumTitle: 'Technics', forumArchived: false,
    }]],
    [/FROM "ForumPost" p\s+LEFT JOIN "User" u/, () => [{ id: POST, authorUserId: U.member, authorName: 'Me <me@uni.no>', body: 'x', status: 'published', createdAt: 't', updatedAt: 't' }]],
  ]);
  const view = await listPosts(q, { spaceId: SPACE, threadId: THREAD });
  assert.deepEqual(view.thread.createdBy, { name: null, deleted: false });
  assert.deepEqual(view.posts[0].author, { name: null, deleted: false });
  noEmail({ t: view.thread.createdBy, p: view.posts[0].author });
});

test('listPosts passes the forum bibliography link to the renderer (cache invalidation)', async () => {
  const { q } = fakeQuery([
    memberRoute,
    [/FROM "ForumThread" t\s+LEFT JOIN "User" u/, () => [{
      id: THREAD, title: 'T', isPinned: false, isLocked: false, createdAt: 't', updatedAt: 't', archivedAt: null,
      createdByUserId: U.member, createdByName: 'A', forumId: FORUM, forumSlug: 'technics', forumTitle: 'Technics', forumArchived: false,
      forumSettings: { seshatLibraryId: 'lib-1', ownerEmail: 'Owner@Uni.no' },
    }]],
    [/FROM "ForumPost" p\s+LEFT JOIN "User" u/, () => [{ id: POST, authorUserId: U.member, authorName: 'A', body: 'x', status: 'published', createdAt: 't', updatedAt: 't' }]],
  ]);
  const seen = [];
  await listPosts(q, { spaceId: SPACE, threadId: THREAD, render: async (md, post) => { seen.push(post); return md; } });
  assert.equal(seen[0].forumBibliography, 'lib-1|owner@uni.no');
});

test('authorizeOwnerLibraries: curators only for their own emails, admins any owner', async () => {
  const { q } = fakeQuery([memberRoute, ownEmailsRoute()]);
  const args = (actorUserId, ownerEmail) => ({ spaceId: SPACE, actorUserId, ownerEmail });
  assert.equal(await authorizeOwnerLibraries(q, args(U.curator, ' Owner@Uni.no ')), 'owner@uni.no');
  await rejectsStatus(authorizeOwnerLibraries(q, args(U.curator, 'someone@else.org')), 403);
  assert.equal(await authorizeOwnerLibraries(q, args(U.admin, 'someone@else.org')), 'someone@else.org');
  await rejectsStatus(authorizeOwnerLibraries(q, args(U.member, 'owner@uni.no')), 403);
  await rejectsStatus(authorizeOwnerLibraries(q, args(null, 'owner@uni.no')), 401);
  await rejectsStatus(authorizeOwnerLibraries(q, args(U.admin, 'not-an-email')), 400);
  await rejectsStatus(authorizeOwnerLibraries(q, args(U.admin, undefined)), 400);
});

// ---------------------------------------------------------------------------
// Channels (one level under a group; spec 2026-09-29)
// ---------------------------------------------------------------------------

const GROUP = FORUM;
const CH_WELCOME = id(12);
const CH_TT = id(13);
const groupSummary = (over = {}) => summaryRow({ slug: 'stiegler', title: 'Stiegler', parentId: null, ...over });
const channelSummary = (cid, slug, title, over = {}) => summaryRow({
  id: cid, slug, title, parentId: GROUP, parentSlug: 'stiegler', parentTitle: 'Stiegler',
  settings: {}, parentSettings: forumRow().settings, threadCount: 1, conceptCount: 0, ...over,
});

test('effectiveSettings: library+owner inherited as a pair, zotero on its own', () => {
  const group = { seshatLibraryId: 'g', ownerEmail: 'o@x.org', zoteroCollection: 'GZ' };
  // own library without owner: the channel's pair (no owner), never the group's owner
  assert.deepEqual(effectiveSettings({ seshatLibraryId: 'ch' }, group), { seshatLibraryId: 'ch', zoteroCollection: 'GZ' });
  assert.deepEqual(effectiveSettings({ ownerEmail: 'me@x.org' }, group), { ownerEmail: 'me@x.org', zoteroCollection: 'GZ' });
  assert.deepEqual(effectiveSettings({ seshatLibraryId: 'ch', ownerEmail: 'me@x.org' }, group), { seshatLibraryId: 'ch', ownerEmail: 'me@x.org', zoteroCollection: 'GZ' });
  assert.deepEqual(effectiveSettings({ zoteroCollection: 'Mine' }, group), { seshatLibraryId: 'g', ownerEmail: 'o@x.org', zoteroCollection: 'Mine' });
  assert.deepEqual(effectiveSettings({}, group), group);
  assert.deepEqual(effectiveSettings({ zoteroCollection: 'Z' }, null), { zoteroCollection: 'Z' });
  assert.deepEqual(effectiveSettings('{}', '{"zoteroCollection":"G"}'), { zoteroCollection: 'G' });
});

test('listForums: groups with nested channels; channels inherit the public bibliography view', async () => {
  const { q, calls } = fakeQuery([['FROM "ForumBoard" b', () => [
    groupSummary(), channelSummary(CH_TT, 'technics-and-time', 'Technics and Time'),
    channelSummary(CH_WELCOME, 'welcome', 'Welcome', { settings: { zoteroCollection: 'OWN' } }),
    // orphan (its group is archived or elsewhere): dropped
    channelSummary(id(14), 'orphan', 'Orphan', { parentId: id(99) }),
  ]]]);
  const forums = await listForums(q, { spaceId: SPACE });
  assert.equal(forums.length, 1);
  assert.equal(forums[0].slug, 'stiegler');
  assert.equal(forums[0].parent, null);
  // same creation time: ties broken by id (channel order, never alphabetical)
  assert.deepEqual(forums[0].channels.map((c) => c.slug), ['welcome', 'technics-and-time']);
  const [welcome, tt] = forums[0].channels;
  assert.deepEqual(tt.parent, { id: GROUP, slug: 'stiegler', title: 'Stiegler' });
  assert.deepEqual(tt.settings, { zoteroCollection: 'https://www.zotero.org/groups/1/c', hasBibliography: true });
  assert.equal(tt.overridesBibliography, false);
  assert.deepEqual(welcome.settings, { zoteroCollection: 'OWN', hasBibliography: true });
  assert.equal(welcome.overridesBibliography, false, 'a Zotero collection alone does not replace the Seshat link');
  noEmail(forums);
  // archived groups hide their channels; group counts include active channels
  assert.match(calls[0].text, /\(pb\.id IS NULL OR pb\."isArchived" = false\)/);
  assert.match(calls[0].text, /ch\."parentId" = b\.id AND ch\."isArchived" = false/);
});

test('getForumByPath: group, group/channel, and mismatches (channel of another group, reserved t) are null', async () => {
  const rows = [groupSummary(), channelSummary(CH_WELCOME, 'welcome', 'Welcome')];
  const { q, calls } = fakeQuery([['FROM "ForumBoard" b', ([, g]) => (g === 'stiegler' ? rows : [])]]);
  const g = await getForumByPath(q, { spaceId: SPACE, group: 'stiegler' });
  assert.equal(g.group.id, GROUP);
  assert.equal(g.channel, null);
  assert.equal(g.group.channels.length, 1);
  const c = await getForumByPath(q, { spaceId: SPACE, group: 'stiegler', channel: 'welcome' });
  assert.equal(c.channel.id, CH_WELCOME);
  assert.equal(c.group.slug, 'stiegler');
  assert.equal(await getForumByPath(q, { spaceId: SPACE, group: 'stiegler', channel: 'nope' }), null);
  assert.equal(await getForumByPath(q, { spaceId: SPACE, group: 'other', channel: 'welcome' }), null);
  const before = calls.length;
  assert.equal(await getForumByPath(q, { spaceId: SPACE, group: 'stiegler', channel: 't' }), null);
  assert.equal(await getForumByPath(q, { spaceId: SPACE, group: '../x' }), null);
  assert.equal(calls.length, before, 'invalid/reserved paths never reach the database');
  // a channel slug alone never resolves as a group
  const onlyChannel = fakeQuery([['FROM "ForumBoard" b', () => [channelSummary(CH_WELCOME, 'welcome', 'Welcome')]]]);
  assert.equal(await getForumByPath(onlyChannel.q, { spaceId: SPACE, group: 'welcome' }), null);
  assert.match(calls[0].text, /\(b\."parentId" IS NULL AND b\.slug = \$2\) OR \(pb\."parentId" IS NULL AND pb\.slug = \$2\)/);
  assert.equal(isReservedChannelSlug('t'), true);
});

test('getForumRef: a group slug or any forum id', async () => {
  const rows = [groupSummary(), channelSummary(CH_WELCOME, 'welcome', 'Welcome')];
  const { q, calls } = fakeQuery([['FROM "ForumBoard" b', ([, ref]) =>
    ref === 'stiegler' || ref === GROUP ? rows : ref === CH_WELCOME ? [rows[1]] : []]]);
  assert.equal((await getForumRef(q, { spaceId: SPACE, ref: 'stiegler' })).channels.length, 1);
  const ch = await getForumRef(q, { spaceId: SPACE, ref: CH_WELCOME });
  assert.equal(ch.slug, 'welcome');
  assert.equal(ch.parent.slug, 'stiegler');
  assert.equal((await getForumRef(q, { spaceId: SPACE, ref: GROUP })).channels[0].id, CH_WELCOME);
  assert.equal(await getForumRef(q, { spaceId: SPACE, ref: id(98) }), null);
  assert.equal(await getForumRef(q, { spaceId: SPACE, ref: '' }), null);
  assert.match(calls.find((c) => c.params[1] === CH_WELCOME).text, /b\.id = \$2::uuid OR b\."parentId" = \$2::uuid/);
});

const boardRoute = (rows) => [
  /FROM "ForumBoard" b LEFT JOIN "ForumBoard" pb ON pb\.id = b\."parentId"\s+WHERE b\.id = \$1::uuid AND b\."spaceId" = \$2::uuid/,
  ([fid, sid]) => (sid === SPACE && rows[fid] ? [rows[fid]] : []),
];
const BOARDS = {
  [GROUP]: forumRow({ slug: 'stiegler', parentId: null }),
  [CH_WELCOME]: forumRow({ id: CH_WELCOME, slug: 'welcome', parentId: GROUP, settings: {}, parentSettings: forumRow().settings, parentArchived: false }),
};
const insertBoard = ['INSERT INTO "ForumBoard"', (p) => [{
  id: id(20), slug: p[1], title: p[2], description: p[3], isArchived: false, settings: JSON.parse(p[5]), parentId: p[6],
}]];

test('createForum with parentId: a channel of an active group; sibling slug check; reserved t; one level only', async () => {
  const { q, calls } = fakeQuery([memberRoute, boardRoute(BOARDS), ['SELECT id FROM "ForumBoard"', () => []], insertBoard]);
  const ch = await createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Technics and Time', parentId: GROUP });
  assert.equal(ch.parentId, GROUP);
  assert.equal(ch.slug, 'technics-and-time');
  const taken = calls.find((c) => c.text.startsWith('SELECT id FROM "ForumBoard"'));
  assert.match(taken.text, /"parentId" IS NOT DISTINCT FROM \$3::uuid/);
  assert.deepEqual(taken.params, [SPACE, 'technics-and-time', GROUP]);
  const ins = calls.find((c) => c.text.includes('INSERT INTO "ForumBoard"'));
  assert.match(ins.text, /"parentId"\)\s+VALUES \(.*\$7::uuid\)/s);
  assert.equal(ins.params[6], GROUP);

  // top-level: parent null, sibling check among groups
  const top = fakeQuery([memberRoute, ['SELECT id FROM "ForumBoard"', () => []], insertBoard]);
  const g = await createForum(top.q, { spaceId: SPACE, actorUserId: U.curator, title: 'Simondon' });
  assert.equal(g.parentId, null);
  assert.deepEqual(top.calls.find((c) => c.text.startsWith('SELECT id FROM "ForumBoard"')).params, [SPACE, 'simondon', null]);

  // same slug under the same group: 409 (other groups may reuse it)
  const dup = fakeQuery([memberRoute, boardRoute(BOARDS), ['SELECT id FROM "ForumBoard"', () => [{ id: CH_WELCOME }]]]);
  await rejectsStatus(createForum(dup.q, { spaceId: SPACE, actorUserId: U.curator, title: 'Welcome', parentId: GROUP }), 409);

  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Threads', slug: 't', parentId: GROUP }), 400);
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Nested', parentId: CH_WELCOME }), 400);
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Lost', parentId: id(97) }), 404);
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Bad', parentId: 'x' }), 400);
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.member, title: 'Welcome', parentId: GROUP }), 403);
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Uuid', slug: id(5) }), 400);

  // archived group: no new channels
  const archived = fakeQuery([memberRoute, boardRoute({ [GROUP]: forumRow({ isArchived: true }) })]);
  await rejectsStatus(createForum(archived.q, { spaceId: SPACE, actorUserId: U.curator, title: 'Welcome', parentId: GROUP }), 404);
  // the database trigger's check_violation surfaces as 400
  const trig = fakeQuery([memberRoute, boardRoute(BOARDS), ['SELECT id FROM "ForumBoard"', () => []],
    ['INSERT INTO "ForumBoard"', () => ({ error: { message: 'forum channels cannot have channels', code: '23514' } })]]);
  await rejectsStatus(createForum(trig.q, { spaceId: SPACE, actorUserId: U.admin, title: 'Race', parentId: GROUP }), 400);
});

test('channel bibliography override: the library/owner pair is never split across channel and group (C1)', async () => {
  const GROUP_SETTINGS = forumRow().settings; // lib-1 owned by owner@uni.no (not the curator's)
  const base = [memberRoute, ownEmailsRoute({ [U.curator]: ['me@uni.no'] }), boardRoute(BOARDS), ['SELECT id FROM "ForumBoard"', () => []], insertBoard];
  const { q } = fakeQuery(base);
  const eff = (own) => effectiveSettings(own, GROUP_SETTINGS);

  // Exploit path 1 (single request): own library + ownerEmail:null must not pair with the group owner.
  const one = await createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Welcome', parentId: GROUP, settings: { seshatLibraryId: 'lib-9', ownerEmail: null } });
  assert.deepEqual(eff(one.settings), { seshatLibraryId: 'lib-9', zoteroCollection: GROUP_SETTINGS.zoteroCollection });
  assert.equal(publicSettings(eff(one.settings)).hasBibliography, false);
  // same with the library id alone
  const alone = await createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Welcome', parentId: GROUP, settings: { seshatLibraryId: 'lib-9' } });
  assert.equal(eff(alone.settings).ownerEmail, undefined);

  // Exploit path 2 (two steps): own pair with the curator's email, then PATCH ownerEmail:null.
  const mineRow = forumRow({ id: CH_WELCOME, slug: 'welcome', parentId: GROUP, settings: { seshatLibraryId: 'lib-9', ownerEmail: 'me@uni.no' }, parentSettings: GROUP_SETTINGS, parentArchived: false });
  const upd = (row) => fakeQuery([...base.slice(0, 2), boardRoute({ [CH_WELCOME]: row }), ['UPDATE "ForumBoard"', () => [row]]]).q;
  await updateForum(upd(mineRow), { spaceId: SPACE, forumId: CH_WELCOME, actorUserId: U.curator, settings: { ownerEmail: null } });
  assert.deepEqual(eff({ seshatLibraryId: 'lib-9' }), { seshatLibraryId: 'lib-9', zoteroCollection: GROUP_SETTINGS.zoteroCollection },
    'after step 2 the channel has a library without owner: no bibliography, never the group owner');

  // A foreign owner on the channel is refused for curators, allowed for admins.
  await rejectsStatus(createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Welcome', parentId: GROUP, settings: { seshatLibraryId: 'lib-9', ownerEmail: 'owner@uni.no' } }), 403);
  await createForum(q, { spaceId: SPACE, actorUserId: U.admin, title: 'Welcome', parentId: GROUP, settings: { seshatLibraryId: 'lib-9', ownerEmail: 'x@y.org' } });
  await createForum(q, { spaceId: SPACE, actorUserId: U.curator, title: 'Welcome', parentId: GROUP, settings: { seshatLibraryId: 'lib-9', ownerEmail: 'me@uni.no' } });

  // Curator on a channel whose own pair is someone else's: changing the library keeps that owner → 403.
  const foreignRow = { ...mineRow, settings: { seshatLibraryId: 'lib-9', ownerEmail: 'owner@uni.no' } };
  await rejectsStatus(updateForum(upd(foreignRow), { spaceId: SPACE, forumId: CH_WELCOME, actorUserId: U.curator, settings: { seshatLibraryId: 'lib-x' } }), 403);
  // ...their own pair may change its library; clearing the override falls back to exactly the group's pair.
  await updateForum(upd(mineRow), { spaceId: SPACE, forumId: CH_WELCOME, actorUserId: U.curator, settings: { seshatLibraryId: 'lib-x' } });
  await updateForum(upd(foreignRow), { spaceId: SPACE, forumId: CH_WELCOME, actorUserId: U.curator, settings: { seshatLibraryId: null, ownerEmail: null } });
  // other fields never need the check
  await updateForum(upd(foreignRow), { spaceId: SPACE, forumId: CH_WELCOME, actorUserId: U.curator, title: 'Welcome!', isArchived: true });
});

test('a channel of an archived group is closed (threads, posts, votes)', async () => {
  const closed = { [CH_WELCOME]: { ...BOARDS[CH_WELCOME], parentArchived: true } };
  await rejectsStatus(listThreads(fakeQuery([boardRoute(closed)]).q, { spaceId: SPACE, forumId: CH_WELCOME }), 404);
  await rejectsStatus(createThread(fakeQuery([memberRoute, boardRoute(closed)]).q, {
    spaceId: SPACE, forumId: CH_WELCOME, actorUserId: U.member, title: 'Session 1', body: 'x',
  }), 404);
  // curators can still reach it for un-archiving
  const upd = fakeQuery([memberRoute, boardRoute(closed), ['UPDATE "ForumBoard"', () => [closed[CH_WELCOME]]]]);
  await updateForum(upd.q, { spaceId: SPACE, forumId: CH_WELCOME, actorUserId: U.admin, isArchived: false });
  // thread/post entry points compute the effective archive flag in SQL
  const texts = [];
  const spy = fakeQuery([memberRoute]);
  await createPost(spy.q, { spaceId: SPACE, threadId: THREAD, actorUserId: U.member, body: 'x' }).catch(() => {});
  await vote(spy.q, { spaceId: SPACE, postId: POST, actorUserId: U.member, value: 1 }).catch(() => {});
  texts.push(...spy.calls.map((c) => c.text));
  const archiveExprs = texts.filter((t) => t.includes('COALESCE(pb."isArchived", false)'));
  assert.equal(archiveExprs.length, 2);
});

test('createThread in a channel: boardId is the channel', async () => {
  const { q, calls } = fakeQuery([memberRoute, boardRoute(BOARDS),
    ['INSERT INTO "ForumThread"', () => [{ id: THREAD }]], ['INSERT INTO "ForumPost"', () => [{ id: POST }]]]);
  await createThread(q, { spaceId: SPACE, forumId: CH_WELCOME, actorUserId: U.member, title: 'Session 1', body: 'Hello' });
  assert.equal(calls.find((c) => c.text.includes('INSERT INTO "ForumThread"')).params[1], CH_WELCOME);
});

test('listPosts in a channel: forum carries its group; citations use the inherited bibliography', async () => {
  const { q, calls } = fakeQuery([
    memberRoute,
    [/FROM "ForumThread" t\s+LEFT JOIN "User" u/, () => [{
      id: THREAD, title: 'Session 1', isPinned: false, isLocked: false, createdAt: 't', updatedAt: 't', archivedAt: null,
      createdByUserId: U.member, createdByName: 'A', forumId: CH_TT, forumSlug: 'technics-and-time', forumTitle: 'Technics and Time',
      forumArchived: false, forumSettings: {}, parentId: GROUP, parentSlug: 'stiegler', parentTitle: 'Stiegler',
      parentSettings: { seshatLibraryId: 'lib-1', ownerEmail: 'Owner@Uni.no' },
    }]],
    [/FROM "ForumPost" p\s+LEFT JOIN "User" u/, () => [{ id: POST, authorUserId: U.member, authorName: 'A', body: 'see k', status: 'published', createdAt: 't', updatedAt: 't' }]],
  ]);
  const seen = [];
  const view = await listPosts(q, { spaceId: SPACE, threadId: THREAD, render: async (md, post) => { seen.push(post); return md; } });
  assert.deepEqual(view.thread.forum, {
    id: CH_TT, slug: 'technics-and-time', title: 'Technics and Time', parent: { id: GROUP, slug: 'stiegler', title: 'Stiegler' },
  });
  assert.deepEqual(seen[0], { id: POST, updatedAt: 't', forumId: CH_TT, forumBibliography: 'lib-1|owner@uni.no' });
  assert.match(calls.find((c) => /FROM "ForumThread" t\s+LEFT JOIN "User"/.test(c.text)).text, /LEFT JOIN "ForumBoard" pb ON pb\.id = b\."parentId"/);
  noEmail(view);
});

test('listForumsAdmin returns parentId so the admin can group channels', async () => {
  const { q, calls } = fakeQuery([memberRoute, ['FROM "ForumBoard"', () => [BOARDS[GROUP], BOARDS[CH_WELCOME]]]]);
  const rows = await listForumsAdmin(q, { spaceId: SPACE, actorUserId: U.curator });
  assert.deepEqual(rows.map((r) => r.parentId), [null, GROUP]);
  assert.deepEqual(rows[1].settings, {}, 'own settings only (the admin shows inheritance)');
  assert.match(calls.at(-1).text, /"parentId"/);
});

test('channel order: manual position first, then order of creation (not alphabetical)', async () => {
  const rows = [
    groupSummary(),
    channelSummary(CH_WELCOME, 'welcome', 'Welcome', { position: null, createdAt: '2026-09-02' }),
    channelSummary(CH_TT, 'technics-and-time', 'Technics and Time', { position: null, createdAt: '2026-09-03' }),
    channelSummary(id(14), 'concepts', 'Concepts', { position: null, createdAt: '2026-09-04' }),
  ];
  const [g] = await listForums(fakeQuery([['FROM "ForumBoard" b', () => rows]]).q, { spaceId: SPACE });
  assert.deepEqual(g.channels.map((c) => c.slug), ['welcome', 'technics-and-time', 'concepts'], 'creation order by default');
  rows[3].position = 1;
  rows[1].position = 2;
  const [g2] = await listForums(fakeQuery([['FROM "ForumBoard" b', () => rows]]).q, { spaceId: SPACE });
  assert.deepEqual(g2.channels.map((c) => c.slug), ['concepts', 'welcome', 'technics-and-time'], 'positioned first, then unpositioned by creation');
  assert.equal(compareChannels({ id: 'a', position: 3 }, { id: 'b', position: null }), -1);
});

test('reorderChannels: curators set positions 1..n for every channel of the group, in one pinned statement', async () => {
  const channelIds = [CH_WELCOME, CH_TT];
  const db = () => fakeQuery([
    memberRoute, boardRoute(BOARDS),
    [/SELECT id FROM "ForumBoard" WHERE "parentId" = \$1::uuid AND "spaceId" = \$2::uuid/, () => channelIds.map((cid) => ({ id: cid }))],
    ['UPDATE "ForumBoard" b SET position', ([order]) => order.map((cid, i) => ({ id: cid, slug: cid, title: cid, isArchived: false, settings: {}, parentId: GROUP, position: i + 1, createdAt: 't' }))],
  ]);
  const { q, calls } = db();
  const out = await reorderChannels(q, { spaceId: SPACE, groupId: GROUP, actorUserId: U.curator, order: [CH_TT, CH_WELCOME] });
  assert.deepEqual(out.map((c) => [c.id, c.position]), [[CH_TT, 1], [CH_WELCOME, 2]]);
  const up = calls.find((c) => c.text.startsWith('UPDATE "ForumBoard" b SET position'));
  assert.match(up.text, /unnest\(\$1::uuid\[\]\) WITH ORDINALITY/);
  assert.match(up.text, /b\."parentId" = \$2::uuid AND b\."spaceId" = \$3::uuid/);
  assert.deepEqual(up.params, [[CH_TT, CH_WELCOME], GROUP, SPACE]);

  await rejectsStatus(reorderChannels(db().q, { spaceId: SPACE, groupId: GROUP, actorUserId: U.curator, order: [CH_TT] }), 409);
  await rejectsStatus(reorderChannels(db().q, { spaceId: SPACE, groupId: GROUP, actorUserId: U.curator, order: [CH_TT, CH_TT] }), 409);
  await rejectsStatus(reorderChannels(db().q, { spaceId: SPACE, groupId: GROUP, actorUserId: U.curator, order: [CH_TT, id(77)] }), 409);
  await rejectsStatus(reorderChannels(db().q, { spaceId: SPACE, groupId: GROUP, actorUserId: U.curator, order: 'x' }), 400);
  await rejectsStatus(reorderChannels(db().q, { spaceId: SPACE, groupId: CH_WELCOME, actorUserId: U.curator, order: [] }), 400);
  await rejectsStatus(reorderChannels(db().q, { spaceId: SPACE, groupId: GROUP, actorUserId: U.member, order: channelIds }), 403);
});

// ---------------------------------------------------------------------------
// Author edit / delete
// ---------------------------------------------------------------------------

const ownPost = (over = {}) => ({
  id: POST, threadId: THREAD, status: 'published', threadArchived: null, forumArchived: false,
  authorUserId: U.member, adoptedAsVersionId: null, isLocked: false, ...over,
});
const editDb = (over = {}, updated = true) => fakeQuery([
  memberRoute,
  postByIdRoute({ [POST]: ownPost(over) }),
  ['UPDATE "ForumPost"', (p, text) => (!updated ? [] : text.includes("status = 'deleted'")
    ? [{ id: POST }]
    : [{ id: POST, body: p[0], move: p[1] ? 'proposes' : p[2], updatedAt: 't9', editedAt: 't9' }])],
]);
const edit = (db, over = {}) => editPost(db.q, { spaceId: SPACE, postId: POST, actorUserId: U.member, body: ' New text ', ...over });
const del = (db, over = {}) => deleteOwnPost(db.q, { spaceId: SPACE, postId: POST, actorUserId: U.member, ...over });

test('editPost: the author edits the body; move kept when omitted; stamps editedAt + updatedAt', async () => {
  const db = editDb();
  assert.deepEqual(await edit(db), { postId: POST, body: 'New text', move: 'proposes', updatedAt: 't9', editedAt: 't9' });
  const upd = db.calls.at(-1);
  assert.deepEqual(upd.params, ['New text', true, null, POST, U.member, SPACE]);
  assert.match(upd.text, /"editedAt" = now\(\), "updatedAt" = now\(\)/);
  assert.match(upd.text, /p\."authorUserId" = \$5::uuid AND p\.status = 'published'/);
  assert.match(upd.text, /et\."spaceId" = \$6::uuid AND et\."isLocked" IS NOT TRUE/);
  assert.match(upd.text, /et\."archivedAt" IS NULL AND eb\."isArchived" IS NOT TRUE AND epb\."isArchived" IS NOT TRUE/);
});

test('editPost: move validated against the CHECK list; null/"" clears it', async () => {
  const db = editDb();
  assert.equal((await edit(db, { move: 'contrasts' })).move, 'contrasts');
  assert.deepEqual(db.calls.at(-1).params.slice(0, 3), ['New text', false, 'contrasts']);
  for (const m of POST_MOVES) assert.equal((await edit(editDb(), { move: m })).move, m);
  assert.equal((await edit(editDb(), { move: null })).move, null);
  assert.equal((await edit(editDb(), { move: '' })).move, null);
  const bad = editDb();
  await rejectsStatus(edit(bad, { move: 'agrees' }), 400);
  await rejectsStatus(edit(bad, { move: 7 }), 400);
  assert.ok(!bad.calls.some((c) => c.text.includes('UPDATE')));
});

test('editPost: body limits as createPost', async () => {
  const db = editDb();
  await rejectsStatus(edit(db, { body: '   ' }), 400);
  await rejectsStatus(edit(db, { body: 5 }), 400);
  await rejectsStatus(edit(db, { body: 'x'.repeat(20001) }), 400);
  assert.ok(!db.calls.some((c) => c.text.includes('UPDATE')));
  assert.equal((await edit(editDb(), { body: 'x'.repeat(20000) })).body.length, 20000);
});

test('editPost: author only — other members, curators and admins 403; anonymous 401; guests/removed members 403', async () => {
  for (const actor of [U.curator, U.admin]) {
    const db = editDb();
    await rejectsStatus(edit(db, { actorUserId: actor }), 403);
    assert.ok(!db.calls.some((c) => c.text.includes('UPDATE')));
  }
  await rejectsStatus(edit(editDb({ authorUserId: U.curator })), 403); // another member's post
  await rejectsStatus(edit(editDb(), { actorUserId: null }), 401);
  // the author lost membership (removed/blocked: no role) or is only a guest now: role checked per request
  await rejectsStatus(edit(editDb({ authorUserId: U.stranger }), { actorUserId: U.stranger }), 403);
  await rejectsStatus(edit(editDb({ authorUserId: U.guest }), { actorUserId: U.guest }), 403);
  await rejectsStatus(del(editDb({ authorUserId: U.stranger }), { actorUserId: U.stranger }), 403);
  // a curator may edit a post they wrote themselves
  assert.equal((await edit(editDb({ authorUserId: U.curator }), { actorUserId: U.curator })).postId, POST);
});

test('curators cannot edit but moderation of the same post still works', async () => {
  const db = editDb();
  await rejectsStatus(edit(db, { actorUserId: U.curator }), 403);
  await rejectsStatus(del(db, { actorUserId: U.curator }), 403);
  assert.deepEqual(
    await moderatePost(modDb().q, { spaceId: SPACE, postId: POST, actorUserId: U.curator, action: 'hide' }),
    { postId: POST, status: 'hidden' },
  );
});

test('editPost / deleteOwnPost: locked thread, archived thread or forum → 409; other space 404', async () => {
  for (const over of [{ isLocked: true }, { threadArchived: 't8' }, { forumArchived: true }]) {
    const db = editDb(over);
    await rejectsStatus(edit(db), 409);
    await rejectsStatus(del(db), 409);
    assert.ok(!db.calls.some((c) => c.text.includes('UPDATE')), JSON.stringify(over));
  }
  await rejectsStatus(edit(editDb(), { postId: id(77) }), 404);
  await rejectsStatus(edit(editDb(), { postId: 'nope' }), 404);
  await rejectsStatus(del(editDb(), { postId: id(77) }), 404);
});

test('editPost: hidden/deleted posts 409; a concurrent change 409', async () => {
  await rejectsStatus(edit(editDb({ status: 'hidden' })), 409);
  await rejectsStatus(edit(editDb({ status: 'deleted' })), 409);
  await rejectsStatus(edit(editDb({}, false)), 409);
});

test('deleteOwnPost: soft delete marked as by the author; hidden ok; deleted 409', async () => {
  const db = editDb();
  assert.deepEqual(await del(db), { postId: POST, status: 'deleted', deletedByAuthor: true });
  const upd = db.calls.at(-1);
  assert.match(upd.text, /SET status = 'deleted', body = '', "deletedByAuthor" = true, "updatedAt" = now\(\)/);
  assert.match(upd.text, /p\."authorUserId" = \$2::uuid AND p\.status IN \('published', 'hidden'\)/);
  assert.deepEqual(upd.params, [POST, U.member, SPACE]);
  assert.ok(!db.calls.some((c) => /DELETE FROM/.test(c.text)), 'never a hard delete: replies keep their parent');
  assert.equal((await del(editDb({ status: 'hidden' }))).status, 'deleted');
  await rejectsStatus(del(editDb({ status: 'deleted' })), 409);
  await rejectsStatus(del(editDb({}, false)), 409);
  await rejectsStatus(del(editDb(), { actorUserId: null }), 401);
});

test('adopted post: edit and delete never touch ConceptVersion / Concept', async () => {
  for (const fn of [edit, del]) {
    const db = editDb({ adoptedAsVersionId: id(60) });
    await fn(db);
    const writes = db.calls.filter((c) => /^\s*(UPDATE|INSERT|DELETE)/.test(c.text));
    assert.equal(writes.length, 1);
    assert.match(writes[0].text, /^\s*UPDATE "ForumPost" p SET/);
    for (const c of db.calls) assert.ok(!/"ConceptVersion"|"Concept"/.test(c.text), c.text);
    assert.ok(!/adoptedAsVersionId/.test(writes[0].text), 'the adoption marker is kept');
  }
});

test('isEdited: only after the 60s grace window', () => {
  const t0 = '2026-09-30T10:00:00.000Z';
  assert.equal(isEdited(t0, null), false);
  assert.equal(isEdited(t0, undefined), false);
  assert.equal(isEdited(t0, '2026-09-30T10:00:59.000Z'), false);
  assert.equal(isEdited(t0, '2026-09-30T10:01:00.000Z'), false);
  assert.equal(isEdited(t0, '2026-09-30T10:01:01.000Z'), true);
  assert.equal(isEdited(new Date(t0), new Date('2026-09-30T11:00:00Z')), true);
  assert.equal(isEdited(t0, 'garbage'), false);
});

test('listPosts: edited marker, author tombstone, per-post canEdit/canDelete', async () => {
  const rows = [
    { id: POST, parentPostId: null, authorUserId: U.member, body: 'Mine', status: 'published', move: null, adoptedAsVersionId: null,
      createdAt: '2026-09-30T10:00:00Z', updatedAt: '2026-09-30T12:00:00Z', editedAt: '2026-09-30T12:00:00Z', deletedByAuthor: false, authorName: 'Ada' },
    { id: POST2, parentPostId: POST, authorUserId: U.curator, body: '', status: 'deleted', move: null, adoptedAsVersionId: null,
      createdAt: '2026-09-30T10:05:00Z', updatedAt: '2026-09-30T12:00:00Z', editedAt: '2026-09-30T11:00:00Z', deletedByAuthor: true, authorName: 'Bo' },
    { id: id(42), parentPostId: POST2, authorUserId: U.member, body: '', status: 'deleted', move: null, adoptedAsVersionId: null,
      createdAt: '2026-09-30T10:06:00Z', updatedAt: '2026-09-30T12:00:00Z', editedAt: null, deletedByAuthor: false, authorName: 'Ada' },
    { id: id(43), parentPostId: null, authorUserId: U.member, body: 'Hid', status: 'hidden', move: null, adoptedAsVersionId: null,
      // moderation bumps updatedAt only: not "edited"
      createdAt: '2026-09-30T10:07:00Z', updatedAt: '2026-09-30T12:00:00Z', editedAt: null, deletedByAuthor: false, authorName: 'Ada' },
  ];
  const db = (over = {}) => fakeQuery([
    memberRoute,
    [/FROM "ForumThread" t\s+LEFT JOIN "User"/, () => [threadRow(over)]],
    ['FROM "ForumPost" p\n     LEFT JOIN "User"', () => rows],
  ]);
  const flags = (v) => v.posts.map((p) => [p.edited, p.deletedByAuthor, p.canEdit, p.canDelete]);
  const mine = await listPosts(db().q, { spaceId: SPACE, threadId: THREAD, viewerUserId: U.member });
  assert.deepEqual(flags(mine), [
    [true, false, true, true],
    [false, true, false, false],   // tombstone by the author; reply structure kept
    [false, false, false, false],  // moderator tombstone
    [false, false, false, true],   // own hidden post: delete only
  ]);
  assert.equal(mine.posts[1].body, null);
  assert.equal(mine.posts[2].parentPostId, POST2);
  // curators get no edit rights on others' posts; locked threads freeze own posts; anonymous nothing
  const cur = await listPosts(db().q, { spaceId: SPACE, threadId: THREAD, viewerUserId: U.curator });
  assert.deepEqual(cur.posts.map((p) => p.canEdit || p.canDelete), [false, false, false, false]);
  const locked = await listPosts(db({ isLocked: true }).q, { spaceId: SPACE, threadId: THREAD, viewerUserId: U.member });
  assert.deepEqual(locked.posts.map((p) => p.canEdit || p.canDelete), [false, false, false, false]);
  const anon = await listPosts(db().q, { spaceId: SPACE, threadId: THREAD });
  assert.deepEqual(anon.posts.map((p) => p.canEdit || p.canDelete), [false, false, false, false]);
  assert.equal(anon.posts[0].edited, true);
});

// ---------------------------------------------------------------------------
// patchPost (PATCH /api/mm/posts/<id>)
// ---------------------------------------------------------------------------

const patch = (db, actorUserId, body, postId = POST) => patchPost(db.q, { spaceId: SPACE, postId, actorUserId, patch: body });

test('patchPost: edit → author edit; curators 403; invalid action 400', async () => {
  const db = editDb();
  assert.equal((await patch(db, U.member, { action: 'edit', body: 'Hi', move: 'combines' })).move, 'combines');
  await rejectsStatus(patch(editDb(), U.curator, { action: 'edit', body: 'Hi' }), 403);
  await rejectsStatus(patch(editDb(), U.member, { action: 'edit' }), 400);
  await rejectsStatus(patch(editDb(), U.member, { action: 'edit', body: 'Hi', move: 'nope' }), 400);
  await rejectsStatus(patch(editDb(), null, { action: 'edit', body: 'Hi' }), 401);
  for (const bad of [{}, { action: 'ban' }, { action: 5 }, { action: 'EDIT' }]) await rejectsStatus(patch(editDb(), U.member, bad), 400);
});

test('patchPost: delete → author tombstone for the author, moderation delete for curators, 403 for other members', async () => {
  const own = editDb();
  assert.deepEqual(await patch(own, U.member, { action: 'delete' }), { postId: POST, status: 'deleted', deletedByAuthor: true });
  assert.match(own.calls.at(-1).text, /"deletedByAuthor" = true/);

  const mod = modDb();
  assert.deepEqual(await patch(mod, U.curator, { action: 'delete' }), { postId: POST, status: 'deleted' });
  assert.ok(!/deletedByAuthor/.test(mod.calls.at(-1).text), 'moderation delete keeps its own wording');

  await rejectsStatus(patch(editDb({ authorUserId: U.curator }), U.member, { action: 'delete' }), 403);
  await rejectsStatus(patch(editDb(), null, { action: 'delete' }), 401);
  await rejectsStatus(patch(editDb(), U.stranger, { action: 'delete' }), 403);
  await rejectsStatus(patch(editDb({ isLocked: true }), U.member, { action: 'delete' }), 409);
  // a curator's own post in a locked thread goes through moderation
  const locked = fakeQuery([memberRoute, postByIdRoute({ [POST]: ownPost({ authorUserId: U.curator, isLocked: true }) }), ['UPDATE "ForumPost"', (p) => [{ status: p[0] }]]]);
  assert.deepEqual(await patch(locked, U.curator, { action: 'delete' }), { postId: POST, status: 'deleted' });
});

test('patchPost: hide / unhide stay curator-only moderation', async () => {
  assert.deepEqual(await patch(modDb(), U.curator, { action: 'hide' }), { postId: POST, status: 'hidden' });
  assert.deepEqual(await patch(modDb('hidden'), U.admin, { action: 'unhide' }), { postId: POST, status: 'published' });
  await rejectsStatus(patch(editDb(), U.member, { action: 'hide' }), 403); // even on their own post
});

test('musiki course forum is unaffected: additive migration, course queries ignore the new columns', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../../../postgres-patches/migrations/20260930090000_mm_post_author_edit.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "editedAt" timestamptz NULL/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "deletedByAuthor" boolean NOT NULL DEFAULT false/);
  assert.doesNotMatch(sql, /DROP|ALTER COLUMN|UPDATE |DELETE /);
  const musiki = readFileSync(new URL('../forum-queries.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(musiki, /editedAt|deletedByAuthor/);
  // author writes are pinned to the space, so course posts (spaceId NULL) can never match
  for (const db of [editDb(), editDb()]) {
    await (db === undefined ? null : edit(db));
    assert.match(db.calls.at(-1).text, /et\."spaceId" = \$6::uuid/);
  }
});
