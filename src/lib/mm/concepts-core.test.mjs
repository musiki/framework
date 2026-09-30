import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConceptError,
  conceptBaseSlug,
  uniqueSlug,
  currentByLang,
  cleanSources,
  createConcept,
  getConcept,
  editDefinition,
  adoptPost,
  setStatus,
  listConcepts,
  setLabels,
  getCommonsRole,
  shouldDestroyClient,
  forumBibliographyKey,
} from './concepts-core.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPACE = id(1);
const OTHER_SPACE = id(2);
const FORUM = id(10);
const CHANNEL = id(11);
const C1 = id(20);
const C2 = id(21);
const C3 = id(22);
const THREAD = id(30);
const POST = id(40);
const REL = id(50);
const U = { admin: id(100), curator: id(101), member: id(102), author: id(103), guest: id(104), poster: id(105), stranger: id(106) };
const ROLES = { [U.admin]: 'admin', [U.curator]: 'curator', [U.member]: 'member', [U.author]: 'member', [U.guest]: 'guest', [U.poster]: 'member' };

/**
 * Fake q: routes are [substring|RegExp, handler(params, text)]; a handler may
 * return `{ error }` to simulate a failed statement, or throw.
 */
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

const DISS_SPACE = id(3);
const SPACE_KIND = { [SPACE]: 'commons', [OTHER_SPACE]: 'commons', [DISS_SPACE]: 'dissertation' };
// Simulates the DB: a membership only counts when the query joins Space and
// filters kind = 'commons', and the space really is a commons space.
const memberRoute = ['"SpaceMember"', ([spaceId, userId], text) =>
  /JOIN "Space" s ON s\.id = m\."spaceId" AND s\.kind = 'commons'/.test(text) && SPACE_KIND[spaceId] === 'commons' && ROLES[userId]
    ? [{ role: ROLES[userId] }]
    : []];
const conceptRow = (over = {}) => ({
  id: C1, spaceId: SPACE, forumId: FORUM, slug: 'pharmakon', label: 'Pharmakon', labelNb: null,
  status: 'neologism', threadId: THREAD, createdBy: U.author, ...over,
});
const conceptByIdRoute = (rows = { [C1]: conceptRow(), [C2]: conceptRow({ id: C2, slug: 'tertiary-retention', label: 'Tertiary retention' }) }) =>
  [/FROM "Concept" WHERE id = \$1/, ([cid]) => (rows[cid] ? [rows[cid]] : [])];

async function rejectsStatus(promise, status) {
  await assert.rejects(promise, (err) => err instanceof ConceptError && err.status === status);
}

// ---------------------------------------------------------------------------
// Slugs / helpers
// ---------------------------------------------------------------------------

test('conceptBaseSlug uses slugify and never the page fallback', () => {
  assert.equal(conceptBaseSlug('Tertiary Retention'), 'tertiary-retention');
  assert.equal(conceptBaseSlug('Pharmakón!'), 'pharmakon');
  assert.equal(conceptBaseSlug('???'), 'concept');
  assert.equal(conceptBaseSlug('Page'), 'page');
});

test('uniqueSlug appends -2, -3', () => {
  assert.equal(uniqueSlug('x', []), 'x');
  assert.equal(uniqueSlug('x', ['x']), 'x-2');
  assert.equal(uniqueSlug('x', ['x', 'x-2', 'x-3']), 'x-4');
  assert.equal(uniqueSlug('x', ['x-2']), 'x');
});

test('currentByLang picks the latest per language and never fills missing ones', () => {
  const v = (vid, lang, createdAt) => ({ id: vid, lang, createdAt });
  const cur = currentByLang([
    v('a', 'en', '2026-01-01T00:00:00Z'),
    v('b', 'en', '2026-03-01T00:00:00Z'),
    v('c', 'nb', '2026-02-01T00:00:00Z'),
    v('d', 'en', '2026-02-01T00:00:00Z'),
  ]);
  assert.equal(cur.en.id, 'b');
  assert.equal(cur.nb.id, 'c');
  assert.equal('nn' in cur, false);
});

test('cleanSources keeps known string fields only', () => {
  assert.deepEqual(cleanSources([{ citekey: ' stiegler1998 ', evil: 1 }, { note: '' }]), [{ citekey: 'stiegler1998' }]);
  assert.throws(() => cleanSources('nope'), ConceptError);
});

// ---------------------------------------------------------------------------
// createConcept
// ---------------------------------------------------------------------------

function createFixture({ taken = [], failOn = null } = {}) {
  return fakeQuery([
    memberRoute,
    [/FROM "ForumBoard" b LEFT JOIN "ForumBoard" pb[\s\S]*WHERE b\.id = \$1::uuid AND b\."spaceId" = \$2::uuid/, ([fid, sid]) =>
      sid !== SPACE ? [] : fid === FORUM ? [{ id: FORUM, parentId: null }] : fid === CHANNEL ? [{ id: CHANNEL, parentId: FORUM }] : []],
    ['SELECT slug FROM "Concept"', () => taken.map((slug) => ({ slug }))],
    ['INSERT INTO "ForumThread"', () => (failOn === 'thread' ? { error: new Error('boom') } : [{ id: THREAD }])],
    [/INSERT INTO "Concept" \(/, () => (failOn === 'concept' ? { error: { message: 'dup', code: '23505' } } : [{ id: C1 }])],
    ['INSERT INTO "ConceptVersion"', (params) =>
      failOn === 'version' ? { error: new Error('version failed') } : [{ id: params[1] === 'nb' ? id(61) : id(60), createdAt: 'now' }]],
  ]);
}

test('createConcept: member proposes → thread in forum (space+board), concept, v1 en credited to author', async () => {
  const fx = createFixture({ taken: ['pharmakon', 'pharmakon-2'] });
  const out = await createConcept(fx.q, {
    spaceId: SPACE, forumId: FORUM, actorUserId: U.member, label: 'Pharmakon', definition: ' Both poison and cure. ',
    sources: [{ citekey: 'stiegler2010' }],
  });
  assert.deepEqual(out, { id: C1, slug: 'pharmakon-3', threadId: THREAD, versionId: id(60) });

  const thread = fx.calls.find((c) => c.text.includes('INSERT INTO "ForumThread"'));
  assert.match(thread.text, /"spaceId", "boardId", title, "createdByUserId"/);
  assert.doesNotMatch(thread.text, /courseId|lessonSlug/);
  assert.deepEqual(thread.params, [SPACE, FORUM, 'Pharmakon', U.member]);

  const concept = fx.calls.find((c) => c.text.includes('INSERT INTO "Concept"'));
  assert.deepEqual(concept.params, [SPACE, FORUM, 'pharmakon-3', 'Pharmakon', null, THREAD, U.member]);

  const versions = fx.calls.filter((c) => c.text.includes('INSERT INTO "ConceptVersion"'));
  assert.equal(versions.length, 1, 'no nb version without a hand-written nb definition');
  assert.deepEqual(versions[0].params, [C1, 'en', 'Both poison and cure.', JSON.stringify([{ citekey: 'stiegler2010' }]), U.member, U.member, null]);

  const texts = fx.calls.map((c) => c.text);
  assert.ok(texts.indexOf('BEGIN') < texts.findIndex((t) => t.includes('INSERT INTO "ForumThread"')));
  assert.equal(texts.at(-1), 'COMMIT');
  assert.ok(texts.some((t) => t.includes('pg_advisory_xact_lock')));
});

test('createConcept from a channel: thread in the channel, concept belongs to the group', async () => {
  const fx = createFixture();
  await createConcept(fx.q, { spaceId: SPACE, forumId: CHANNEL, actorUserId: U.member, label: 'Epiphylogenesis', definition: 'D' });
  const lookup = fx.calls.find((c) => c.text.includes('FROM "ForumBoard" b'));
  assert.match(lookup.text, /pb\."isArchived" IS NOT TRUE/, 'a channel of an archived group is closed');
  const thread = fx.calls.find((c) => c.text.includes('INSERT INTO "ForumThread"'));
  assert.equal(thread.params[1], CHANNEL);
  const concept = fx.calls.find((c) => c.text.includes('INSERT INTO "Concept"'));
  assert.equal(concept.params[1], FORUM);
});

test('createConcept: optional hand-written nb definition becomes nb v1', async () => {
  const fx = createFixture();
  await createConcept(fx.q, {
    spaceId: SPACE, forumId: FORUM, actorUserId: U.curator, label: 'Pharmakon', labelNb: 'Farmakon',
    definition: 'EN', definitionNb: 'NB',
  });
  const versions = fx.calls.filter((c) => c.text.includes('INSERT INTO "ConceptVersion"'));
  assert.deepEqual(versions.map((v) => [v.params[1], v.params[2]]), [['en', 'EN'], ['nb', 'NB']]);
});

test('createConcept: English definition required; guest/anonymous/stranger denied; foreign forum 404', async () => {
  const base = { spaceId: SPACE, forumId: FORUM, label: 'X', definition: 'D' };
  await rejectsStatus(createConcept(createFixture().q, { ...base, actorUserId: U.member, definition: '  ' }), 400);
  await rejectsStatus(createConcept(createFixture().q, { ...base, actorUserId: U.member, label: '' }), 400);
  await rejectsStatus(createConcept(createFixture().q, { ...base, actorUserId: U.guest }), 403);
  await rejectsStatus(createConcept(createFixture().q, { ...base, actorUserId: U.stranger }), 403);
  await rejectsStatus(createConcept(createFixture().q, { ...base, actorUserId: null }), 401);
  await rejectsStatus(createConcept(createFixture().q, { ...base, actorUserId: U.member, forumId: id(999) }), 404);
});

test('createConcept: failure mid-transaction rolls back and does not commit', async () => {
  for (const failOn of ['thread', 'version']) {
    const fx = createFixture({ failOn });
    await assert.rejects(createConcept(fx.q, { spaceId: SPACE, forumId: FORUM, actorUserId: U.member, label: 'X', definition: 'D' }));
    const texts = fx.calls.map((c) => c.text);
    assert.ok(texts.includes('BEGIN'));
    assert.equal(texts.at(-1), 'ROLLBACK', failOn);
    assert.ok(!texts.includes('COMMIT'), failOn);
  }
});

test('createConcept: unique violation surfaces as 409 after rollback', async () => {
  const fx = createFixture({ failOn: 'concept' });
  await rejectsStatus(createConcept(fx.q, { spaceId: SPACE, forumId: FORUM, actorUserId: U.member, label: 'X', definition: 'D' }), 409);
  assert.equal(fx.calls.at(-1).text, 'ROLLBACK');
});

// ---------------------------------------------------------------------------
// getConcept
// ---------------------------------------------------------------------------

function getFixture() {
  return fakeQuery([
    ['WHERE c."spaceId" = $1::uuid AND c.slug = $2', ([, slug]) =>
      slug === 'pharmakon'
        ? [{ ...conceptRow(), createdBy: null, createdByName: null, createdAt: 't0', updatedAt: 't3',
            forumId: FORUM, forumSlug: 'stiegler', forumTitle: 'Stiegler' }]
        : []],
    ['FROM "ConceptVersion" v', () => [
      { id: 'v3', lang: 'en', definition: 'en v2', sources: '[{"citekey":"k"}]', editedBy: U.curator, creditedUserId: U.poster,
        fromPostId: POST, createdAt: '2026-03-01T00:00:00Z', editedByName: 'Cura', creditedName: 'Poster' },
      { id: 'v2', lang: 'nb', definition: 'nb v1', sources: [], editedBy: null, creditedUserId: null,
        fromPostId: null, createdAt: '2026-02-01T00:00:00Z', editedByName: null, creditedName: null },
      { id: 'v1', lang: 'en', definition: 'en v1', sources: [], editedBy: U.author, creditedUserId: U.author,
        fromPostId: null, createdAt: '2026-01-01T00:00:00Z', editedByName: 'Author', creditedName: 'Author' },
    ]],
    ['FROM "ConceptRelation" r', () => [
      { id: 'r1', type: 'derives', sourceId: C1, targetId: C2, createdBy: U.member, createdByName: 'Mem', agree: 2, disagree: 1, settled: true,
        otherId: C2, otherSlug: 'tertiary-retention', otherLabel: 'Tertiary retention', otherLabelNb: null },
      { id: 'r2', type: 'contrasts', sourceId: C3, targetId: C1, createdBy: null, createdByName: null,
        otherId: C3, otherSlug: 'grammatization', otherLabel: 'Grammatization', otherLabelNb: 'Grammatisering' },
    ]],
  ]);
}

test('getConcept: current per lang, history, both relation directions, forum, thread; NULL users = deleted', async () => {
  const fx = getFixture();
  const c = await getConcept(fx.q, { spaceId: SPACE, slug: 'pharmakon', viewerUserId: U.member });
  assert.equal(c.current.en.id, 'v3');
  assert.equal(c.current.en.credited.name, 'Poster');
  assert.equal(c.current.en.fromPostId, POST);
  assert.deepEqual(c.current.en.sources, [{ citekey: 'k' }]);
  assert.equal(c.current.nb.id, 'v2');
  assert.deepEqual(c.current.nb.credited, { name: null, deleted: true });
  assert.equal(c.current.nn, undefined, 'nn is not filled from nb in the core');
  assert.deepEqual(c.history.map((v) => v.id), ['v3', 'v2', 'v1']);
  assert.deepEqual(c.createdBy, { name: null, deleted: true });
  assert.deepEqual(c.forum, { id: FORUM, slug: 'stiegler', title: 'Stiegler' });
  assert.equal(c.threadId, THREAD);
  assert.deepEqual(c.relations.map((r) => [r.id, r.direction, r.other.slug, r.own]), [
    ['r1', 'out', 'tertiary-retention', true],
    ['r2', 'in', 'grammatization', false],
  ]);
  assert.deepEqual(c.relations[1].createdBy, { name: null, deleted: true });
  // Type slug through the FK; agreement as totals only (no stance holders).
  assert.deepEqual([c.relations[0].type, c.relations[0].agree, c.relations[0].disagree, c.relations[0].settled], ['derives', 2, 1, true]);
  assert.deepEqual([c.relations[1].agree, c.relations[1].disagree, c.relations[1].settled], [0, 0, false]);
  const relSql = fx.calls.find((x) => x.text.includes('FROM "ConceptRelation" r')).text;
  assert.match(relSql, /t\.slug AS type/);
  assert.match(relSql, /JOIN "RelationType" t ON t\.id = r\."typeId"/);
  assert.doesNotMatch(relSql, /r\.type\b|s\."userId"/);
  const json = JSON.stringify(c);
  assert.ok(!json.includes(U.poster) && !json.includes(U.curator), 'no user ids in the view');
});

test('getConcept: origin points at the discussion thread\'s channel (concept belongs to the group)', async () => {
  const fx = fakeQuery([
    ['WHERE c."spaceId" = $1::uuid AND c.slug = $2', () => [{
      ...conceptRow(), createdAt: 't0', updatedAt: 't3', forumId: FORUM, forumSlug: 'stiegler', forumTitle: 'Stiegler',
      threadBoardSlug: 'technics-and-time', threadBoardTitle: 'Technics and Time', threadGroupSlug: 'stiegler',
    }]],
  ]);
  const c = await getConcept(fx.q, { spaceId: SPACE, slug: 'pharmakon' });
  assert.deepEqual(c.forum, { id: FORUM, slug: 'stiegler', title: 'Stiegler' });
  assert.deepEqual(c.origin, { groupSlug: 'stiegler', channel: { slug: 'technics-and-time', title: 'Technics and Time' } });
  assert.equal(c.originArchived, false);
  assert.match(fx.calls[0].text, /\(tb\."isArchived" OR COALESCE\(tpb\."isArchived", false\)\) AS "threadBoardArchived"/);
  assert.match(fx.calls[0].text, /LEFT JOIN "ForumThread" ct ON ct\.id = c\."threadId" AND ct\."spaceId" = c\."spaceId"/);

  const group = fakeQuery([['WHERE c."spaceId" = $1::uuid AND c.slug = $2', () => [{
    ...conceptRow(), forumId: FORUM, forumSlug: 'stiegler', forumTitle: 'Stiegler', threadBoardSlug: 'stiegler', threadGroupSlug: null,
  }]]]);
  assert.deepEqual((await getConcept(group.q, { spaceId: SPACE, slug: 'pharmakon' })).origin, { groupSlug: 'stiegler', channel: null });
  const archived = fakeQuery([['WHERE c."spaceId" = $1::uuid AND c.slug = $2', () => [{
    ...conceptRow(), forumId: FORUM, forumSlug: 'stiegler', forumTitle: 'Stiegler', threadBoardSlug: 'welcome', threadGroupSlug: 'stiegler',
    threadBoardTitle: 'Welcome', threadBoardArchived: true,
  }]]]);
  assert.equal((await getConcept(archived.q, { spaceId: SPACE, slug: 'pharmakon' })).originArchived, true);
});

test('getConcept: definitionHtml defaults to escaped text; raw definition kept', async () => {
  const fx = fakeQuery([
    ['WHERE c."spaceId" = $1::uuid AND c.slug = $2', () => [{ ...conceptRow(), forumId: null }]],
    ['FROM "ConceptVersion" v', () => [
      { id: 'v1', lang: 'en', definition: 'a <script>x</script>\n$W$', sources: [], editedBy: null, creditedUserId: null,
        fromPostId: null, createdAt: '2026-01-01T00:00:00Z' },
    ]],
  ]);
  const c = await getConcept(fx.q, { spaceId: SPACE, slug: 'pharmakon' });
  assert.equal(c.current.en.definition, 'a <script>x</script>\n$W$');
  assert.equal(c.current.en.definitionHtml, '<p class="mm-pre-line">a &lt;script&gt;x&lt;/script&gt;\n$W$</p>');
});

test('getConcept: every version is rendered with its version ref and the forum bibliography key; failures fall back to text', async () => {
  const fx = fakeQuery([
    ['WHERE c."spaceId" = $1::uuid AND c.slug = $2', () => [{
      ...conceptRow(), forumId: FORUM, forumSlug: 'stiegler', forumTitle: 'Stiegler',
      forumSettings: { seshatLibraryId: ' lib1 ', ownerEmail: 'Owner@X.org', zoteroCollection: 'z' },
    }]],
    ['FROM "ConceptVersion" v', () => [
      { id: 'v2', lang: 'nb', definition: 'boom', sources: [], editedBy: null, creditedUserId: null,
        fromPostId: null, createdAt: new Date('2026-02-01T00:00:00Z') },
      { id: 'v1', lang: 'en', definition: 'en *v1*', sources: [], editedBy: null, creditedUserId: null,
        fromPostId: null, createdAt: '2026-01-01T00:00:00Z' },
    ]],
  ]);
  const seen = [];
  const render = async (md, ref) => {
    seen.push([md, ref]);
    if (md === 'boom') throw new Error('render failed');
    return `<p>R:${md}</p>`;
  };
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a);
  let c;
  try {
    c = await getConcept(fx.q, { spaceId: SPACE, slug: 'pharmakon', render });
  } finally {
    console.error = origError;
  }
  assert.deepEqual(seen.map(([md, ref]) => [md, ref]).sort((a, b) => a[1].id.localeCompare(b[1].id)), [
    ['en *v1*', { id: 'concept-version:v1', updatedAt: '2026-01-01T00:00:00Z', forumId: FORUM, forumBibliography: 'lib1|owner@x.org' }],
    ['boom', { id: 'concept-version:v2', updatedAt: '2026-02-01T00:00:00.000Z', forumId: FORUM, forumBibliography: 'lib1|owner@x.org' }],
  ]);
  assert.equal(c.current.en.definitionHtml, '<p>R:en *v1*</p>');
  assert.equal(c.current.nb.definitionHtml, '<p class="mm-pre-line">boom</p>');
  assert.equal(c.history[1].definition, 'en *v1*');
  assert.equal(errors.length, 1);
  const json = JSON.stringify(c);
  assert.ok(!/owner@x\.org|lib1|forumSettings/i.test(json), 'forum bibliography settings never leave the core');
});

test('forumBibliographyKey: library + normalized owner; tolerant of JSON strings and junk', () => {
  assert.equal(forumBibliographyKey({ seshatLibraryId: ' L ', ownerEmail: ' A@B.C ' }), 'L|a@b.c');
  assert.equal(forumBibliographyKey('{"seshatLibraryId":"L"}'), 'L|');
  assert.equal(forumBibliographyKey('not json'), '|');
  assert.equal(forumBibliographyKey(null), '|');
  assert.equal(forumBibliographyKey([1]), '|');
});

test('getConcept: unknown slug or bad space → null', async () => {
  assert.equal(await getConcept(getFixture().q, { spaceId: SPACE, slug: 'nope' }), null);
  assert.equal(await getConcept(getFixture().q, { spaceId: 'x', slug: 'pharmakon' }), null);
});

// ---------------------------------------------------------------------------
// editDefinition
// ---------------------------------------------------------------------------

function editFixture({ failTouch = false, createdBy = U.author } = {}) {
  return fakeQuery([
    memberRoute,
    conceptByIdRoute({ [C1]: conceptRow({ createdBy }) }),
    ['INSERT INTO "ConceptVersion"', () => [{ id: id(70), createdAt: 'now' }]],
    ['UPDATE "Concept" SET "updatedAt"', () => (failTouch ? { error: new Error('touch failed') } : [])],
  ]);
}

test('editDefinition: author (member) and curator/admin may edit; other member/guest/anonymous denied', async () => {
  for (const actor of [U.author, U.curator, U.admin]) {
    const fx = editFixture();
    const out = await editDefinition(fx.q, { conceptId: C1, actorUserId: actor, lang: 'nb', definition: 'Bokmål tekst' });
    assert.equal(out.versionId, id(70));
    const ins = fx.calls.find((c) => c.text.includes('INSERT INTO "ConceptVersion"'));
    assert.deepEqual(ins.params, [C1, 'nb', 'Bokmål tekst', '[]', actor, actor, null]);
  }
  await rejectsStatus(editDefinition(editFixture().q, { conceptId: C1, actorUserId: U.member, lang: 'en', definition: 'x' }), 403);
  await rejectsStatus(editDefinition(editFixture().q, { conceptId: C1, actorUserId: U.guest, lang: 'en', definition: 'x' }), 403);
  await rejectsStatus(editDefinition(editFixture().q, { conceptId: C1, actorUserId: null, lang: 'en', definition: 'x' }), 401);
});

test('editDefinition: deleted author (createdBy NULL) never matches a member', async () => {
  await rejectsStatus(editDefinition(editFixture({ createdBy: null }).q, { conceptId: C1, actorUserId: U.member, lang: 'en', definition: 'x' }), 403);
});

test('editDefinition: invalid lang / empty definition / unknown concept', async () => {
  await rejectsStatus(editDefinition(editFixture().q, { conceptId: C1, actorUserId: U.curator, lang: 'de', definition: 'x' }), 400);
  await rejectsStatus(editDefinition(editFixture().q, { conceptId: C1, actorUserId: U.curator, lang: 'en', definition: '' }), 400);
  await rejectsStatus(editDefinition(editFixture().q, { conceptId: C3, actorUserId: U.curator, lang: 'en', definition: 'x' }), 404);
  await rejectsStatus(editDefinition(editFixture().q, { conceptId: 'not-a-uuid', actorUserId: U.curator, lang: 'en', definition: 'x' }), 404);
});

test('editDefinition: failure after insert rolls back', async () => {
  const fx = editFixture({ failTouch: true });
  await assert.rejects(editDefinition(fx.q, { conceptId: C1, actorUserId: U.curator, lang: 'en', definition: 'x' }));
  assert.equal(fx.calls.at(-1).text, 'ROLLBACK');
  assert.ok(!fx.calls.some((c) => c.text === 'COMMIT'));
});

// ---------------------------------------------------------------------------
// adoptPost
// ---------------------------------------------------------------------------

function adoptFixture({ post = {}, failUpdate = false } = {}) {
  const postRow = {
    id: POST, authorUserId: U.poster, authorName: 'Poster', body: '  The post body as definition. ', status: 'published',
    adoptedAsVersionId: null, spaceId: SPACE, isLocked: false, archivedAt: null, ...post,
  };
  return fakeQuery([
    memberRoute,
    conceptByIdRoute(),
    [/FROM "ForumPost" p\s+JOIN "ForumThread" t/, ([pid]) => (pid === POST ? [postRow] : [])],
    ['INSERT INTO "ConceptVersion"', () => [{ id: id(80), createdAt: 'now' }]],
    ['UPDATE "ForumPost" SET "adoptedAsVersionId"', () => (failUpdate ? { error: new Error('update failed') } : [{ id: POST }])],
  ]);
}

test('adoptPost: curator adopts → version credited to post author, editedBy curator, fromPostId, post.adoptedAsVersionId', async () => {
  const fx = adoptFixture();
  const out = await adoptPost(fx.q, { conceptId: C1, postId: POST, actorUserId: U.curator, lang: 'en' });
  assert.deepEqual(out, { versionId: id(80), credited: { name: 'Poster', deleted: false } });
  assert.ok(!JSON.stringify(out).includes(U.poster), 'no raw user id returned');
  const ins = fx.calls.find((c) => c.text.includes('INSERT INTO "ConceptVersion"'));
  assert.deepEqual(ins.params, [C1, 'en', 'The post body as definition.', '[]', U.curator, U.poster, POST]);
  const upd = fx.calls.find((c) => c.text.includes('UPDATE "ForumPost"'));
  assert.deepEqual(upd.params, [id(80), POST]);
  const texts = fx.calls.map((c) => c.text);
  assert.ok(texts.indexOf('BEGIN') < texts.indexOf(ins.text));
  const conceptLock = texts.findIndex((t) => /FROM "Concept" WHERE id = \$1::uuid LIMIT 1 FOR UPDATE/.test(t));
  const postLock = texts.findIndex((t) => t.includes('FOR UPDATE OF p'));
  assert.ok(conceptLock > texts.indexOf('BEGIN'), 'concept row locked inside the transaction');
  assert.ok(postLock > conceptLock, 'concept locked before post');
  assert.equal(texts.at(-1), 'COMMIT');
});

test('adoptPost: curator-edited text and nb lang', async () => {
  const fx = adoptFixture();
  await adoptPost(fx.q, { conceptId: C1, postId: POST, actorUserId: U.admin, lang: 'nb', definition: 'Redigert' });
  const ins = fx.calls.find((c) => c.text.includes('INSERT INTO "ConceptVersion"'));
  assert.deepEqual(ins.params.slice(1, 3), ['nb', 'Redigert']);
  assert.equal(ins.params[5], U.poster);
});

test('adoptPost: deleted post author → credit NULL (deleted user), still recorded', async () => {
  const fx = adoptFixture({ post: { authorUserId: null } });
  const out = await adoptPost(fx.q, { conceptId: C1, postId: POST, actorUserId: U.curator, lang: 'en' });
  assert.deepEqual(out.credited, { name: null, deleted: true });
  const ins = fx.calls.find((c) => c.text.includes('INSERT INTO "ConceptVersion"'));
  assert.equal(ins.params[5], null);
});

test('adoptPost: members (even the concept author), guests, anonymous denied', async () => {
  for (const actor of [U.author, U.member, U.guest]) {
    const fx = adoptFixture();
    await rejectsStatus(adoptPost(fx.q, { conceptId: C1, postId: POST, actorUserId: actor, lang: 'en' }), 403);
    assert.ok(!fx.calls.some((c) => c.text === 'BEGIN'));
  }
  await rejectsStatus(adoptPost(adoptFixture().q, { conceptId: C1, postId: POST, actorUserId: null, lang: 'en' }), 401);
});

test('adoptPost: post in another space 404; already adopted / not published 409 (rolled back)', async () => {
  for (const [post, status] of [
    [{ spaceId: OTHER_SPACE }, 404], [{ adoptedAsVersionId: id(81) }, 409], [{ status: 'hidden' }, 409],
    [{ isLocked: true }, 409], [{ archivedAt: '2026-01-01T00:00:00Z' }, 409],
  ]) {
    const fx = adoptFixture({ post });
    await rejectsStatus(adoptPost(fx.q, { conceptId: C1, postId: POST, actorUserId: U.curator, lang: 'en' }), status);
    assert.equal(fx.calls.at(-1).text, 'ROLLBACK');
  }
});

test('adoptPost: failing post update rolls back the new version', async () => {
  const fx = adoptFixture({ failUpdate: true });
  await assert.rejects(adoptPost(fx.q, { conceptId: C1, postId: POST, actorUserId: U.curator, lang: 'en' }));
  const texts = fx.calls.map((c) => c.text);
  assert.ok(texts.some((t) => t.includes('INSERT INTO "ConceptVersion"')));
  assert.equal(texts.at(-1), 'ROLLBACK');
  assert.ok(!texts.includes('COMMIT'));
});

// ---------------------------------------------------------------------------
// setStatus
// ---------------------------------------------------------------------------

test('setStatus: curator/admin only; invalid status 400', async () => {
  const mk = () => fakeQuery([memberRoute, conceptByIdRoute(), ['UPDATE "Concept" SET status', ([s]) => [{ status: s }]]]);
  assert.deepEqual(await setStatus(mk().q, { conceptId: C1, actorUserId: U.curator, status: 'assimilated' }), { status: 'assimilated' });
  await rejectsStatus(setStatus(mk().q, { conceptId: C1, actorUserId: U.author, status: 'assimilated' }), 403);
  await rejectsStatus(setStatus(mk().q, { conceptId: C1, actorUserId: U.admin, status: 'dead' }), 400);
});

// ---------------------------------------------------------------------------
// listConcepts
// ---------------------------------------------------------------------------

const listRows = [
  { id: C1, slug: 'pharmakon', label: 'Pharmakon', labelNb: 'Farmakon', status: 'discussion', createdAt: 't0', updatedAt: 't',
    forumId: FORUM, forumSlug: 'stiegler', forumTitle: 'Stiegler', langs: ['nb', 'en'] },
  { id: C2, slug: 'b', label: 'B', labelNb: null, status: 'neologism', updatedAt: 't',
    forumId: null, forumSlug: null, forumTitle: null, langs: ['en'] },
];

test('listConcepts: passes filters and maps rows', async () => {
  const fx = fakeQuery([['FROM "Concept" c', () => listRows]]);
  const out = await listConcepts(fx.q, { spaceId: SPACE, forumId: FORUM, status: 'discussion' });
  assert.deepEqual(fx.calls[0].params, [SPACE, FORUM, 'discussion']);
  assert.deepEqual(out[0].langs, ['en', 'nb']);
  assert.equal(out[0].createdAt, 't0');
  assert.match(fx.calls[0].text, /c\."createdAt", c\."updatedAt"/);
  assert.deepEqual(out[0].forum, { id: FORUM, slug: 'stiegler', title: 'Stiegler' });
  assert.equal(out[1].forum, null);
  // A group filter includes its channels' concepts (they are stored with the group id);
  // a channel filter matches concepts whose discussion thread is in the channel.
  assert.match(fx.calls[0].text, /c\."forumId" = \$2::uuid OR EXISTS \(\s+SELECT 1 FROM "ForumThread" ct WHERE ct\.id = c\."threadId" AND ct\."boardId" = \$2::uuid\)/);
  await rejectsStatus(listConcepts(fx.q, { spaceId: SPACE, status: 'bogus' }), 400);
  assert.deepEqual(await listConcepts(fx.q, { spaceId: 'nope' }), []);
});

// ---------------------------------------------------------------------------
// Commons-only roles
// ---------------------------------------------------------------------------

test('getCommonsRole: a role in a non-commons space never authorizes mm actions', async () => {
  const fx = fakeQuery([memberRoute]);
  assert.equal(await getCommonsRole(fx.q, SPACE, U.curator), 'curator');
  assert.equal(await getCommonsRole(fx.q, DISS_SPACE, U.curator), null);
  assert.equal(await getCommonsRole(fx.q, SPACE, null), null);
});

test('mutations on a concept whose space is not commons are denied even for curators/admins', async () => {
  const fx = fakeQuery([
    memberRoute,
    conceptByIdRoute({ [C1]: conceptRow({ spaceId: DISS_SPACE, createdBy: U.admin }) }),
  ]);
  await rejectsStatus(editDefinition(fx.q, { conceptId: C1, actorUserId: U.admin, lang: 'en', definition: 'x' }), 403);
  await rejectsStatus(setStatus(fx.q, { conceptId: C1, actorUserId: U.curator, status: 'assimilated' }), 403);
  await rejectsStatus(adoptPost(fx.q, { conceptId: C1, postId: POST, actorUserId: U.curator, lang: 'en' }), 403);
  assert.ok(!fx.calls.some((c) => /INSERT|UPDATE/.test(c.text)));
});

// ---------------------------------------------------------------------------
// setLabels
// ---------------------------------------------------------------------------

function labelFixture({ failThread = false } = {}) {
  return fakeQuery([
    memberRoute,
    conceptByIdRoute(),
    ['UPDATE "ForumThread" SET title', () => (failThread ? { error: new Error('thread failed') } : [])],
  ]);
}

test('setLabels: English label change also retitles the concept thread, in one transaction', async () => {
  const fx = labelFixture();
  assert.deepEqual(await setLabels(fx.q, { conceptId: C1, actorUserId: U.author, label: 'Pharmakon (Stiegler)', labelNb: 'Farmakon' }),
    { label: 'Pharmakon (Stiegler)', labelNb: 'Farmakon' });
  const thread = fx.calls.find((c) => c.text.includes('UPDATE "ForumThread" SET title'));
  assert.deepEqual(thread.params, ['Pharmakon (Stiegler)', THREAD, SPACE]);
  assert.equal(fx.calls.at(-1).text, 'COMMIT');
});

test('setLabels: nb-only change leaves the thread title alone; non-author member denied; failure rolls back', async () => {
  let fx = labelFixture();
  await setLabels(fx.q, { conceptId: C1, actorUserId: U.curator, labelNb: 'Farmakon' });
  assert.ok(!fx.calls.some((c) => c.text.includes('"ForumThread"')));
  await rejectsStatus(setLabels(labelFixture().q, { conceptId: C1, actorUserId: U.member, label: 'Y' }), 403);
  fx = labelFixture({ failThread: true });
  await assert.rejects(setLabels(fx.q, { conceptId: C1, actorUserId: U.curator, label: 'Y' }));
  assert.equal(fx.calls.at(-1).text, 'ROLLBACK');
});

// ---------------------------------------------------------------------------
// Pooled client release decision
// ---------------------------------------------------------------------------

test('shouldDestroyClient: domain errors keep the connection, db errors / failed ROLLBACK destroy it', () => {
  for (const status of [400, 401, 403, 404, 409]) assert.equal(shouldDestroyClient(new ConceptError(status, 'x'), false), false);
  assert.equal(shouldDestroyClient(new ConceptError(500, 'x'), false), true);
  assert.equal(shouldDestroyClient(new Error('connection reset'), false), true);
  assert.equal(shouldDestroyClient(new ConceptError(409, 'x'), true), true);
});

// ---------------------------------------------------------------------------
// kind = 'relation-type' concepts (definition concepts of relation types)
// ---------------------------------------------------------------------------

const RT = id(23);
const relTypeConcept = () => conceptRow({ id: RT, slug: 'rel:derives', label: 'derives from', kind: 'relation-type', threadId: null, createdBy: null });

test('relation-type concepts are excluded from lists (hence graph nodes) and getConcept by default', async () => {
  const fx = fakeQuery([['FROM "Concept" c', () => listRows]]);
  await listConcepts(fx.q, { spaceId: SPACE });
  assert.match(fx.calls[0].text, /c\.kind = 'concept'/);

  const one = fakeQuery([]);
  assert.equal(await getConcept(one.q, { spaceId: SPACE, slug: 'rel:derives' }), null);
  assert.match(one.calls[0].text, /c\.slug = \$2 AND c\.kind = \$3/);
  assert.deepEqual(one.calls[0].params, [SPACE, 'rel:derives', 'concept']);
  const asType = fakeQuery([]);
  await getConcept(asType.q, { spaceId: SPACE, slug: 'rel:derives', kind: 'relation-type' });
  assert.deepEqual(asType.calls[0].params, [SPACE, 'rel:derives', 'relation-type']);
});

test('relation-type concepts: no status/labels; definition edits need manageRelationTypes', async () => {
  const mk = () => fakeQuery([
    memberRoute,
    conceptByIdRoute({ [C1]: conceptRow(), [RT]: relTypeConcept() }),
    ['INSERT INTO "ConceptVersion"', () => [{ id: 'v9', createdAt: 't' }]],
  ]);
  await rejectsStatus(setStatus(mk().q, { conceptId: RT, actorUserId: U.admin, status: 'assimilated' }), 404);
  await rejectsStatus(setLabels(mk().q, { conceptId: RT, actorUserId: U.admin, label: 'x' }), 404);
  await rejectsStatus(editDefinition(mk().q, { conceptId: RT, actorUserId: U.member, lang: 'en', definition: 'd' }), 403);
  assert.deepEqual(await editDefinition(mk().q, { conceptId: RT, actorUserId: U.curator, lang: 'nb', definition: 'd' }), { versionId: 'v9' });
});
