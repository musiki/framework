import test from 'node:test';
import assert from 'node:assert/strict';
import { ConceptError } from './concepts-core.ts';
import {
  RELATION_COLORS, cleanRelationTypeFields, relationTypeSlug, relationTypeConceptSlug, relationsLockKey,
  listRelationTypes, listRelationsOfType, getRelationType, createRelationType, updateRelationType, archiveRelationType, reorderRelationTypes,
} from './relation-types-core.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPACE = id(1);
const DISS_SPACE = id(3);
const FORUM = id(10);
const CHANNEL = id(11);
const CONCEPT = id(20);
const THREAD = id(30);
const TYPE = id(60);
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
  const find = (s) => calls.find((c) => c.text.includes(s));
  return { q, calls, texts, find };
}

const memberRoute = ['"SpaceMember"', ([spaceId, userId], text) =>
  /s\.kind = 'commons'/.test(text) && spaceId === SPACE && ROLES[userId] ? [{ role: ROLES[userId] }] : []];

async function rejectsStatus(promise, status) {
  await assert.rejects(promise, (err) => err instanceof ConceptError && err.status === status, `expected ${status}`);
}

const typeRow = (over = {}) => ({
  id: TYPE, slug: 'derives', conceptId: CONCEPT, conceptSlug: 'rel:derives', label: 'derives from', labelNb: 'avledes fra',
  inverseLabel: 'gives rise to', inverseLabelNb: null, render: 'line', stroke: 'solid', arrow: true, color: 'purple',
  symmetric: false, transitive: true, hierarchical: false, skos: null, wikidata: null, position: 1, isBuiltin: true,
  isArchived: false, createdAt: '2026-09-30T00:00:00Z', relationCount: 3, threadId: THREAD,
  // Planted: must never reach a view.
  createdBy: U.curator, spaceId: SPACE,
  ...over,
});

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

test('cleanRelationTypeFields: defaults, trimming, palette/stroke/render enums', () => {
  assert.deepEqual(cleanRelationTypeFields({ label: '  contains ' }), {
    label: 'contains', labelNb: null, inverseLabel: null, inverseLabelNb: null, render: 'line', stroke: 'solid', arrow: true,
    color: 'ink', symmetric: false, transitive: false, hierarchical: false, skos: null, wikidata: null,
  });
  for (const color of RELATION_COLORS) assert.equal(cleanRelationTypeFields({ label: 'x', color }).color, color);
  for (const bad of [{ color: '#ff0000' }, { color: 'orange' }, { stroke: 'wavy' }, { render: 'blob' }, { arrow: 'yes' },
    { symmetric: 1 }, { label: '' }, { label: 'x'.repeat(201) }, { skos: 'not a curie' }, { wikidata: 'X12' }, { wikidata: 'P0' }]) {
    assert.throws(() => cleanRelationTypeFields({ label: 'x', ...bad }), (e) => e instanceof ConceptError && e.status === 400, JSON.stringify(bad));
  }
  assert.throws(() => cleanRelationTypeFields(null), ConceptError);
  assert.throws(() => cleanRelationTypeFields([]), ConceptError);
  const mapped = cleanRelationTypeFields({ label: 'contains', skos: ' skos:narrower ', wikidata: 'P527', inverseLabel: 'is contained in' });
  assert.deepEqual([mapped.skos, mapped.wikidata, mapped.inverseLabel], ['skos:narrower', 'P527', 'is contained in']);
});

test('cleanRelationTypeFields: area requires hierarchical; symmetric and hierarchical exclude each other', () => {
  assert.throws(() => cleanRelationTypeFields({ label: 'x', render: 'area' }), /hierarchical/);
  assert.equal(cleanRelationTypeFields({ label: 'x', render: 'area', hierarchical: true }).render, 'area');
  assert.throws(() => cleanRelationTypeFields({ label: 'x', symmetric: true, hierarchical: true }), /symmetric and hierarchical/);
});

test('cleanRelationTypeFields with a base: absent keys keep their value, the merged result is validated', () => {
  const base = cleanRelationTypeFields({ label: 'contains', render: 'area', hierarchical: true, transitive: true, color: 'green' });
  assert.deepEqual(cleanRelationTypeFields({ color: 'blue', labelNb: 'inneholder' }, base), { ...base, color: 'blue', labelNb: 'inneholder' });
  assert.equal(cleanRelationTypeFields({ labelNb: '' }, { ...base, labelNb: 'x' }).labelNb, null);
  // Dropping hierarchical while it renders as an area is refused; so is making it symmetric.
  assert.throws(() => cleanRelationTypeFields({ hierarchical: false }, base), /hierarchical/);
  assert.throws(() => cleanRelationTypeFields({ symmetric: true }, base), ConceptError);
  assert.throws(() => cleanRelationTypeFields({ label: ' ' }, base), /label required/);
});

test('relationTypeSlug: explicit slug validated, else from the label; concept slug is rel:<slug>', () => {
  assert.equal(relationTypeSlug(undefined, 'Is part of'), 'is-part-of');
  assert.equal(relationTypeSlug('contains', 'whatever'), 'contains');
  for (const bad of ['Has Space', 'rel:x', 'x'.repeat(49), '-x', 7]) {
    assert.throws(() => relationTypeSlug(bad, 'label'), (e) => e.status === 400, String(bad));
  }
  assert.throws(() => relationTypeSlug(undefined, '???'), (e) => e.status === 400);
  assert.equal(relationTypeConceptSlug('contains'), 'rel:contains');
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

test('listRelationTypes: legend order, archived hidden by default, no ids or user fields', async () => {
  const fx = fakeQuery([['FROM "RelationType" t', () => [typeRow(), typeRow({ id: id(61), slug: 'combines', symmetric: true, transitive: false, isBuiltin: true })]]]);
  const out = await listRelationTypes(fx.q, { spaceId: SPACE });
  assert.equal(fx.calls.length, 1, 'no seeding when the space has types');
  assert.deepEqual(fx.calls[0].params, [SPACE, false]);
  assert.match(fx.calls[0].text, /\$2::boolean OR t\."isArchived" = false/);
  assert.match(fx.calls[0].text, /ORDER BY t\."position" ASC/);
  assert.match(fx.calls[0].text, /t\."symmetric"/, '"symmetric" is quoted (reserved word)');
  assert.deepEqual(out[0], {
    slug: 'derives', label: 'derives from', labelNb: 'avledes fra', inverseLabel: 'gives rise to', inverseLabelNb: null,
    render: 'line', stroke: 'solid', arrow: true, color: 'purple', symmetric: false, transitive: true, hierarchical: false,
    skos: null, wikidata: null, position: 1, isBuiltin: true, isArchived: false, createdAt: '2026-09-30T00:00:00Z', relationCount: 3,
  });
  const json = JSON.stringify(out);
  assert.ok(!json.includes(U.curator) && !json.includes(TYPE) && !/createdBy|spaceId|conceptId/.test(json));

  const all = fakeQuery([]);
  await listRelationTypes(all.q, { spaceId: SPACE, includeArchived: true });
  assert.deepEqual(all.calls[0].params, [SPACE, true]);
  assert.deepEqual(await listRelationTypes(all.q, { spaceId: 'nope' }), []);
});

test('listRelationTypes: a commons space without any type is seeded once (guarded), then re-read', async () => {
  let seeded = false;
  const fx = fakeQuery([
    ['mm_seed_relation_types', () => { seeded = true; return [{ created: 5 }]; }],
    ['FROM "RelationType" t', () => (seeded ? [typeRow()] : [])],
  ]);
  const out = await listRelationTypes(fx.q, { spaceId: SPACE });
  assert.equal(out.length, 1);
  const seed = fx.find('mm_seed_relation_types');
  assert.deepEqual(seed.params, [SPACE]);
  assert.match(seed.text, /s\.kind = 'commons'/);
  assert.match(seed.text, /NOT EXISTS \(SELECT 1 FROM "RelationType" t WHERE t\."spaceId" = s\.id\)/);
  assert.equal(fx.calls.length, 3);

  // Not commons, or only archived types: the guard returns no row and nothing is re-read.
  const none = fakeQuery([]);
  assert.deepEqual(await listRelationTypes(none.q, { spaceId: DISS_SPACE }), []);
  assert.equal(none.calls.length, 2);
});

test('getRelationType: type + its definition concept (kind relation-type, rendered); unknown → null', async () => {
  const fx = fakeQuery([
    ['FROM "RelationType" t', () => [typeRow()]],
    ['FROM "Concept" c', ([, slug, kind]) => (slug === 'rel:derives' && kind === 'relation-type'
      ? [{ id: CONCEPT, spaceId: SPACE, slug, label: 'derives from', labelNb: null, status: 'neologism', threadId: null,
          createdBy: null, createdAt: 't', updatedAt: 't', forumId: null }]
      : [])],
    ['FROM "ConceptVersion" v', () => [{ id: 'v1', lang: 'en', definition: 'The source **derives**.', sources: [], editedBy: null,
      creditedUserId: null, fromPostId: null, createdAt: '2026-09-30T00:00:00Z', editedByName: null, creditedName: null }]],
  ]);
  const render = async (md) => `<p>${md.toUpperCase()}</p>`;
  const out = await getRelationType(fx.q, { spaceId: SPACE, slug: 'derives', render });
  assert.equal(out.slug, 'derives');
  assert.equal(out.transitive, true);
  assert.equal(out.concept.slug, 'rel:derives');
  assert.equal(out.concept.current.en.definitionHtml, '<p>THE SOURCE **DERIVES**.</p>');
  assert.deepEqual(out.concept.current.en.credited, { name: null, deleted: true });
  assert.deepEqual(fx.calls[0].params, [SPACE, 'derives']);

  assert.equal(await getRelationType(fakeQuery([]).q, { spaceId: SPACE, slug: 'nope' }), null);
  const bad = fakeQuery([]);
  assert.equal(await getRelationType(bad.q, { spaceId: SPACE, slug: "x' OR 1=1" }), null);
  assert.equal(bad.calls.length, 0);
});

// ---------------------------------------------------------------------------
// createRelationType
// ---------------------------------------------------------------------------

function createFixture({ existing = [{ slug: 'derives', position: 5 }], boards = [{ id: FORUM, parentId: null }], failOn = null } = {}) {
  return fakeQuery([
    memberRoute,
    ['FROM "ForumBoard" b', ([a], text) => (text.includes('b.id = $1') ? boards.filter((b) => b.id === a) : boards.slice(0, 1))],
    ['SELECT slug, "position" FROM "RelationType"', () => existing],
    ['INSERT INTO "ForumThread"', () => (failOn === 'thread' ? { error: { message: 'boom' } } : [{ id: THREAD }])],
    ['INSERT INTO "Concept"', () => (failOn === 'concept' ? { error: { message: 'dup', code: '23505' } } : [{ id: CONCEPT }])],
    ['INSERT INTO "ConceptVersion"', ([, lang]) => [{ id: `v-${lang}`, createdAt: 't' }]],
    ['INSERT INTO "RelationType"', () => (failOn === 'type' ? { error: { message: 'boom' } } : [{ id: TYPE }])],
  ]);
}
const CONTAINS = { label: 'contains', inverseLabel: 'is contained in', render: 'area', hierarchical: true, transitive: true, color: 'green' };

test('createRelationType: curator creates concept (kind relation-type, rel:<slug>) + thread + v1 en + type, one transaction', async () => {
  const fx = createFixture();
  const out = await createRelationType(fx.q, { spaceId: SPACE, actorUserId: U.curator, type: CONTAINS, definition: ' A contains B. ' });
  assert.deepEqual(out, { slug: 'contains', conceptSlug: 'rel:contains', threadId: THREAD, versionId: 'v-en' });
  const t = fx.texts();
  assert.ok(t.indexOf('BEGIN') > -1 && t.indexOf('COMMIT') > t.indexOf('BEGIN') && !t.includes('ROLLBACK'));
  const begin = fx.calls.findIndex((c) => c.text === 'BEGIN');
  for (const s of ['INSERT INTO "ForumThread"', 'INSERT INTO "Concept"', 'INSERT INTO "ConceptVersion"', 'INSERT INTO "RelationType"']) {
    assert.ok(fx.calls.findIndex((c) => c.text.includes(s)) > begin, `${s} inside the transaction`);
  }
  assert.deepEqual(fx.find('INSERT INTO "ForumThread"').params, [SPACE, FORUM, 'contains', U.curator]);
  const concept = fx.find('INSERT INTO "Concept"');
  assert.match(concept.text, /'relation-type'/);
  assert.deepEqual(concept.params, [SPACE, FORUM, 'rel:contains', 'contains', null, THREAD, U.curator]);
  const version = fx.find('INSERT INTO "ConceptVersion"');
  assert.deepEqual(version.params.slice(0, 3), [CONCEPT, 'en', 'A contains B.']);
  assert.deepEqual(version.params.slice(4, 6), [U.curator, U.curator]);
  const type = fx.find('INSERT INTO "RelationType"');
  assert.match(type.text, /"symmetric"/);
  assert.deepEqual(type.params, [SPACE, CONCEPT, 'contains', 'contains', null, 'is contained in', null, 'area', 'solid', true, 'green',
    false, true, true, null, null, 6, U.curator]);
});

test('createRelationType: given channel → thread in the channel, concept in its group; nb definition; no forum → no thread', async () => {
  const fx = createFixture({ boards: [{ id: CHANNEL, parentId: FORUM }] });
  await createRelationType(fx.q, { spaceId: SPACE, actorUserId: U.admin, type: { label: 'Is part of' }, definition: 'd', definitionNb: 'nb d', forumId: CHANNEL });
  assert.equal(fx.find('INSERT INTO "ForumThread"').params[1], CHANNEL);
  assert.deepEqual(fx.find('INSERT INTO "Concept"').params.slice(0, 3), [SPACE, FORUM, 'rel:is-part-of']);
  assert.deepEqual(fx.calls.filter((c) => c.text.includes('INSERT INTO "ConceptVersion"')).map((c) => c.params[1]), ['en', 'nb']);

  const bare = createFixture({ boards: [] });
  const out = await createRelationType(bare.q, { spaceId: SPACE, actorUserId: U.admin, type: { label: 'x' }, definition: 'd' });
  assert.equal(out.threadId, null);
  assert.ok(!bare.find('INSERT INTO "ForumThread"'));
  assert.deepEqual(bare.find('INSERT INTO "Concept"').params.slice(1, 6), [null, 'rel:x', 'x', null, null]);
  await rejectsStatus(createRelationType(createFixture().q, { spaceId: SPACE, actorUserId: U.admin, type: { label: 'x' }, definition: 'd', forumId: id(999) }), 404);
});

test('createRelationType: members, guests, strangers and anonymous are denied before anything is written', async () => {
  for (const [actor, status] of [[U.member, 403], [U.guest, 403], [U.stranger, 403], [null, 401]]) {
    const fx = createFixture();
    await rejectsStatus(createRelationType(fx.q, { spaceId: SPACE, actorUserId: actor, type: CONTAINS, definition: 'd' }), status);
    assert.ok(!fx.calls.some((c) => /INSERT|BEGIN/.test(c.text)));
  }
});

test('createRelationType: validation 400 (palette, area without hierarchical, no definition); taken slug 409, rolled back', async () => {
  const args = (over) => ({ spaceId: SPACE, actorUserId: U.curator, type: CONTAINS, definition: 'd', ...over });
  await rejectsStatus(createRelationType(createFixture().q, args({ type: { ...CONTAINS, color: 'teal' } })), 400);
  await rejectsStatus(createRelationType(createFixture().q, args({ type: { label: 'x', render: 'area' } })), 400);
  await rejectsStatus(createRelationType(createFixture().q, args({ definition: '  ' })), 400);

  let fx = createFixture();
  await rejectsStatus(createRelationType(fx.q, args({ type: { label: 'Derives' } })), 409);
  assert.ok(fx.texts().includes('ROLLBACK') && !fx.texts().includes('COMMIT') && !fx.calls.some((c) => c.text.includes('INSERT')));

  fx = createFixture({ failOn: 'concept' });
  await rejectsStatus(createRelationType(fx.q, args()), 409);
  assert.ok(fx.texts().includes('ROLLBACK') && !fx.texts().includes('COMMIT'));

  fx = createFixture({ failOn: 'type' });
  await assert.rejects(createRelationType(fx.q, args()), /boom/);
  assert.ok(fx.texts().includes('ROLLBACK') && !fx.texts().includes('COMMIT'));
});

// ---------------------------------------------------------------------------
// update / archive / reorder
// ---------------------------------------------------------------------------

function typeFixture(row = typeRow(), relations = []) {
  return fakeQuery([
    memberRoute,
    ['FROM "ConceptRelation" WHERE "typeId"', () => relations],
    [/SELECT t\.id, t\.slug, t\."conceptId"/, ([, slug]) => (slug === row.slug ? [row] : [])],
    ['UPDATE "RelationType" SET label', () => [{ id: row.id }]],
    ['UPDATE "RelationType" SET "isArchived"', ([, , archived], text) =>
      (/\$3 = false OR "isBuiltin" = false/.test(text) && archived && row.isBuiltin ? [] : [{ isArchived: archived }])],
    ['SELECT slug FROM "RelationType"', () => [{ slug: 'derives' }, { slug: 'combines' }, { slug: 'contains' }]],
  ]);
}

test('updateRelationType: built-ins are editable; merged with current state; concept label and thread title follow', async () => {
  const fx = typeFixture();
  const out = await updateRelationType(fx.q, { spaceId: SPACE, slug: 'derives', actorUserId: U.curator, patch: { label: 'stems from', color: 'blue', stroke: 'double' } });
  assert.deepEqual([out.slug, out.label, out.color, out.stroke, out.transitive, out.inverseLabel], ['derives', 'stems from', 'blue', 'double', true, 'gives rise to']);
  assert.ok(fx.calls.some((c) => c.text.includes('SELECT t.id, t.slug') && /FOR UPDATE OF t/.test(c.text)));
  const upd = fx.find('UPDATE "RelationType" SET label');
  assert.deepEqual(upd.params, [TYPE, SPACE, 'stems from', 'avledes fra', 'gives rise to', null, 'line', 'double', true, 'blue', false, true, false, null, null]);
  assert.deepEqual(fx.find('UPDATE "Concept" SET label').params, ['stems from', 'avledes fra', CONCEPT, SPACE]);
  assert.deepEqual(fx.find('UPDATE "ForumThread" SET title').params, ['stems from', THREAD, SPACE]);
  assert.ok(fx.texts().includes('COMMIT'));

  const same = typeFixture();
  await updateRelationType(same.q, { spaceId: SPACE, slug: 'derives', actorUserId: U.admin, patch: { color: 'red' } });
  assert.ok(!same.find('UPDATE "Concept"') && !same.find('UPDATE "ForumThread"'));
});

test('updateRelationType: permissions, unknown type, invalid merge, slug change', async () => {
  const patch = { color: 'red' };
  await rejectsStatus(updateRelationType(typeFixture().q, { spaceId: SPACE, slug: 'derives', actorUserId: U.member, patch }), 403);
  await rejectsStatus(updateRelationType(typeFixture().q, { spaceId: SPACE, slug: 'derives', actorUserId: null, patch }), 401);
  await rejectsStatus(updateRelationType(typeFixture().q, { spaceId: SPACE, slug: 'nope', actorUserId: U.curator, patch }), 404);
  await rejectsStatus(updateRelationType(typeFixture().q, { spaceId: SPACE, slug: 'derives', actorUserId: U.curator, patch: { slug: 'other' } }), 400);
  let fx = typeFixture();
  await rejectsStatus(updateRelationType(fx.q, { spaceId: SPACE, slug: 'derives', actorUserId: U.curator, patch: { render: 'area' } }), 400);
  assert.ok(fx.texts().includes('ROLLBACK') && !fx.find('UPDATE "RelationType"'));

});

test('updateRelationType: relations in use veto hierarchical-over-a-cycle and symmetric-over-mirrored-pairs (409), under the relations lock', async () => {
  const A = id(21), B = id(22), C = id(23);
  const cyc = [{ sourceId: A, targetId: B }, { sourceId: B, targetId: A }];
  const tree = [{ sourceId: A, targetId: B }, { sourceId: A, targetId: C }];
  const upd = (relations, patch, row) => {
    const fx = typeFixture(row, relations);
    return [fx, updateRelationType(fx.q, { spaceId: SPACE, slug: 'derives', actorUserId: U.curator, patch })];
  };
  for (const patch of [{ hierarchical: true }, { symmetric: true, arrow: false }]) {
    const [fx, p] = upd(cyc, patch);
    await rejectsStatus(p, 409);
    assert.ok(fx.texts().includes('ROLLBACK') && !fx.find('UPDATE "RelationType"'), JSON.stringify(patch));
  }
  for (const patch of [{ hierarchical: true }, { symmetric: true }]) {
    const [fx, p] = upd(tree, patch);
    await p;
    assert.ok(fx.find('UPDATE "RelationType" SET label') && fx.texts().includes('COMMIT'));
  }
  // Order: advisory lock (same key as createRelation) → row lock → relations read → update.
  const [fx, p] = upd(tree, { hierarchical: true });
  await p;
  const at = (s) => fx.calls.findIndex((c) => c.text.includes(s));
  const order = [at('BEGIN'), at('pg_advisory_xact_lock'), at('FOR UPDATE OF t'), at('FROM "ConceptRelation" WHERE "typeId"'), at('UPDATE "RelationType" SET label')];
  assert.ok(order.every((i) => i >= 0) && order.join() === [...order].sort((a, b) => a - b).join(), `order ${order}`);
  assert.deepEqual(fx.find('pg_advisory_xact_lock').params, [relationsLockKey(TYPE)]);
  assert.equal(relationsLockKey(TYPE), `mm-relations:${TYPE}`);
  assert.deepEqual(fx.find('FROM "ConceptRelation" WHERE "typeId"').params, [TYPE]);
  // Other changes, or a property that does not newly turn on, read no relations.
  const [idle, q1] = upd(cyc, { transitive: false, color: 'red' });
  await q1;
  assert.ok(!idle.find('FROM "ConceptRelation" WHERE "typeId"'));
  const [already, q2] = upd(cyc, { label: 'x' }, typeRow({ hierarchical: true }));
  await q2;
  assert.ok(!already.find('FROM "ConceptRelation" WHERE "typeId"'));
});

test('archiveRelationType: built-ins refused (409, also in SQL); custom types archive and restore; curator only', async () => {
  let fx = typeFixture();
  await rejectsStatus(archiveRelationType(fx.q, { spaceId: SPACE, slug: 'derives', actorUserId: U.admin }), 409);
  assert.ok(!fx.find('UPDATE "RelationType"'));

  const custom = typeRow({ slug: 'contains', isBuiltin: false });
  fx = typeFixture(custom);
  assert.deepEqual(await archiveRelationType(fx.q, { spaceId: SPACE, slug: 'contains', actorUserId: U.curator }), { slug: 'contains', isArchived: true });
  assert.deepEqual(fx.find('UPDATE "RelationType"').params, [TYPE, SPACE, true]);
  assert.match(fx.find('UPDATE "RelationType"').text, /\$3 = false OR "isBuiltin" = false/);
  assert.ok(!fx.calls.some((c) => /DELETE/.test(c.text)), 'a type is never deleted');
  assert.deepEqual(await archiveRelationType(typeFixture(custom).q, { spaceId: SPACE, slug: 'contains', actorUserId: U.curator, archived: false }),
    { slug: 'contains', isArchived: false });
  // Restoring a built-in (should one ever be archived) is allowed.
  assert.deepEqual(await archiveRelationType(typeFixture().q, { spaceId: SPACE, slug: 'derives', actorUserId: U.admin, archived: false }),
    { slug: 'derives', isArchived: false });
  await rejectsStatus(archiveRelationType(typeFixture(custom).q, { spaceId: SPACE, slug: 'contains', actorUserId: U.member }), 403);
  await rejectsStatus(archiveRelationType(typeFixture(custom).q, { spaceId: SPACE, slug: 'nope', actorUserId: U.curator }), 404);
});

test('reorderRelationTypes: given slugs first, the rest keep their order; unknown/duplicate 400; curator only', async () => {
  const fx = typeFixture();
  assert.deepEqual(await reorderRelationTypes(fx.q, { spaceId: SPACE, actorUserId: U.curator, slugs: ['contains', 'derives'] }),
    { order: ['contains', 'derives', 'combines'] });
  const upd = fx.find('UPDATE "RelationType" t SET "position"');
  assert.deepEqual(upd.params, [SPACE, ['contains', 'derives', 'combines']]);
  assert.match(upd.text, /unnest\(\$2::text\[\]\) WITH ORDINALITY/);
  assert.ok(fx.texts().includes('COMMIT'));

  for (const slugs of [['nope'], ['derives', 'derives'], [], 'derives', [1]]) {
    const bad = typeFixture();
    await rejectsStatus(reorderRelationTypes(bad.q, { spaceId: SPACE, actorUserId: U.curator, slugs }), 400);
    assert.ok(!bad.find('UPDATE "RelationType"'));
  }
  await rejectsStatus(reorderRelationTypes(typeFixture().q, { spaceId: SPACE, actorUserId: U.member, slugs: ['derives'] }), 403);
});

test('listRelationsOfType: space- and type-pinned, oldest first, bounded, no user fields', async () => {
  const f = fakeQuery([['FROM "ConceptRelation" r', () => [{
    id: id(70), createdAt: new Date('2026-09-30T10:00:00Z'), settled: false, sourceSlug: 'a', sourceLabel: 'A', sourceLabelNb: null,
    targetSlug: 'b', targetLabel: 'B', targetLabelNb: 'Bee', agree: '2', disagree: 0,
    // Planted: must never reach the view.
    createdBy: U.member, spaceId: SPACE,
  }]]]);
  const out = await listRelationsOfType(f.q, { spaceId: SPACE, slug: 'contains', limit: 10_000 });
  assert.deepEqual(out, [{
    id: id(70), source: { slug: 'a', label: 'A', labelNb: null }, target: { slug: 'b', label: 'B', labelNb: 'Bee' },
    createdAt: '2026-09-30T10:00:00.000Z', agree: 2, disagree: 0, settled: false,
  }]);
  const call = f.find('FROM "ConceptRelation" r');
  assert.deepEqual(call.params, [SPACE, 'contains', 500]);
  assert.match(call.text, /t\."spaceId" = \$1::uuid AND t\.slug = \$2 AND r\."spaceId" = \$1::uuid/);
  assert.doesNotMatch(call.text, /"User"|"createdBy"|x\."userId"/);
  // Bad input never reaches SQL.
  const g = fakeQuery([]);
  assert.deepEqual(await listRelationsOfType(g.q, { spaceId: 'x', slug: 'contains' }), []);
  assert.deepEqual(await listRelationsOfType(g.q, { spaceId: SPACE, slug: 'Bad Slug' }), []);
  assert.equal(g.calls.length, 0);
});
