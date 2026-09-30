import test from 'node:test';
import assert from 'node:assert/strict';
import { ConceptError } from './concepts-core.ts';
import { createRelation, deleteRelation, graph } from './relations-core.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPACE = id(1);
const OTHER_SPACE = id(2);
const FORUM = id(10);
const C1 = id(20);
const C2 = id(21);
const C3 = id(22);
const C4 = id(23);
const RT_CONCEPT = id(29);
const POST = id(40);
const REL = id(50);
const T = { derives: id(60), combines: id(61), contains: id(62), old: id(63) };
const U = { admin: id(100), curator: id(101), member: id(102), author: id(103), guest: id(104) };
const ROLES = { [U.admin]: 'admin', [U.curator]: 'curator', [U.member]: 'member', [U.author]: 'member', [U.guest]: 'guest' };

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
const concept = (cid, slug, over = {}) => ({
  id: cid, spaceId: SPACE, forumId: FORUM, slug, label: slug, labelNb: null, status: 'neologism', threadId: null,
  createdBy: U.author, kind: 'concept', ...over,
});
const CONCEPTS = {
  [C1]: concept(C1, 'a'), [C2]: concept(C2, 'b'), [C3]: concept(C3, 'c'), [C4]: concept(C4, 'x', { spaceId: OTHER_SPACE }),
  [RT_CONCEPT]: concept(RT_CONCEPT, 'rel:derives', { kind: 'relation-type' }),
};
const TYPE_ROWS = {
  derives: { id: T.derives, slug: 'derives', symmetric: false, hierarchical: false, isArchived: false },
  combines: { id: T.combines, slug: 'combines', symmetric: true, hierarchical: false, isArchived: false },
  contains: { id: T.contains, slug: 'contains', symmetric: false, hierarchical: true, isArchived: false },
  old: { id: T.old, slug: 'old', symmetric: false, hierarchical: false, isArchived: true },
};

async function rejectsStatus(promise, status) {
  await assert.rejects(promise, (err) => err instanceof ConceptError && err.status === status, `expected ${status}`);
}

/** `relations`: existing rows [{typeId, sourceId, targetId}] the duplicate / cycle statements are answered from. */
function relFixture({
  relations = [], insertError = null, relCreatedBy = U.member, postOk = true, settled = false, stanceHolders = [], lockedType = null,
} = {}) {
  return fakeQuery([
    memberRoute,
    [/FROM "Concept" WHERE id = \$1/, ([cid]) => (CONCEPTS[cid] ? [CONCEPTS[cid]] : [])],
    // First read: only the id, by (space, slug).
    ['FROM "RelationType" t WHERE t."spaceId" = $1::uuid AND t.slug = $2', ([spaceId, slug]) =>
      (spaceId === SPACE && TYPE_ROWS[slug] ? [{ id: TYPE_ROWS[slug].id }] : [])],
    // Second read, under the lock: the properties, by (id, space). `lockedType` simulates a concurrent change.
    ['FROM "RelationType" t WHERE t.id = $1::uuid AND t."spaceId" = $2::uuid', ([typeId, spaceId]) => {
      const row = Object.values(TYPE_ROWS).find((t) => t.id === typeId);
      return spaceId === SPACE && row ? [{ ...row, ...(lockedType ?? {}) }] : [];
    }],
    ['FROM "ForumPost" p JOIN "ForumThread" t', ([pid, spaceId], text) =>
      (postOk && pid === POST && spaceId === SPACE && /p\.status = 'published'/.test(text) ? [{ id: POST }] : [])],
    [/SELECT id FROM "ConceptRelation"\s+WHERE "typeId"/, ([typeId, s, t, symmetric]) =>
      relations.filter((r) => r.typeId === typeId && ((r.sourceId === s && r.targetId === t) || (symmetric && r.sourceId === t && r.targetId === s)))
        .map(() => ({ id: REL }))],
    [/SELECT "sourceId", "targetId" FROM "ConceptRelation" WHERE "typeId"/, ([typeId]) => relations.filter((r) => r.typeId === typeId)],
    ['INSERT INTO "ConceptRelation"', () => (insertError ? { error: insertError } : [{ id: REL }])],
    [/SELECT r\.id, r\."spaceId", r\."createdBy"/, ([rid, spaceId, actor]) =>
      (rid === REL && spaceId === SPACE
        ? [{ id: REL, spaceId: SPACE, createdBy: relCreatedBy, settled, othersHaveStances: stanceHolders.some((u) => u !== actor) }]
        : [])],
    ['DELETE FROM "ConceptRelation"', () => []],
  ]);
}
const args = (over = {}) => ({ spaceId: SPACE, sourceId: C1, targetId: C2, typeSlug: 'derives', actorUserId: U.member, ...over });

// ---------------------------------------------------------------------------
// createRelation
// ---------------------------------------------------------------------------

test('createRelation: member creates by typeSlug; typeId + slug + creator written in one transaction', async () => {
  const fx = relFixture();
  assert.deepEqual(await createRelation(fx.q, args()), { id: REL });
  const ins = fx.find('INSERT INTO "ConceptRelation"');
  assert.match(ins.text, /\("spaceId", "sourceId", "targetId", "typeId", type, "fromPostId", "createdBy"\)/);
  assert.deepEqual(ins.params, [SPACE, C1, C2, T.derives, 'derives', null, U.member]);
  assert.deepEqual(fx.find('FROM "RelationType" t WHERE t."spaceId"').params, [SPACE, 'derives']);
  assert.match(fx.find('FROM "RelationType" t WHERE t.id').text, /t\."symmetric"/);
  const t = fx.texts();
  assert.ok(t.indexOf('BEGIN') < t.indexOf('INSERT INTO "ConceptRelation"') && t.includes('COMMIT') && !t.includes('ROLLBACK'));
  assert.deepEqual(fx.find('pg_advisory_xact_lock').params, [`mm-relations:${T.derives}`]);
});

test('createRelation: the legacy `type` field still names the type', async () => {
  const fx = relFixture();
  await createRelation(fx.q, { spaceId: SPACE, sourceId: C1, targetId: C2, type: 'combines', actorUserId: U.member });
  assert.equal(fx.find('INSERT INTO "ConceptRelation"').params[3], T.combines);
});

test('createRelation: provenance — fromPostId must be a published post of the same space', async () => {
  const fx = relFixture();
  await createRelation(fx.q, args({ fromPostId: POST }));
  assert.deepEqual(fx.find('FROM "ForumPost" p').params, [POST, SPACE]);
  assert.equal(fx.find('INSERT INTO "ConceptRelation"').params[5], POST);

  for (const bad of [{ fromPostId: id(999) }, { fromPostId: 'not-a-uuid' }]) {
    const f = relFixture();
    await rejectsStatus(createRelation(f.q, args(bad)), 404);
    assert.ok(!f.find('INSERT INTO "ConceptRelation"'));
  }
  await rejectsStatus(createRelation(relFixture({ postOk: false }).q, args({ fromPostId: POST })), 404);
  const none = relFixture();
  await createRelation(none.q, args({ fromPostId: '' }));
  assert.equal(none.find('INSERT INTO "ConceptRelation"').params[5], null);
});

test('createRelation: self 400, unknown/invalid type 400, archived type 409, relation-type concept 404', async () => {
  await rejectsStatus(createRelation(relFixture().q, args({ targetId: C1 })), 400);
  for (const typeSlug of ['loves', "x' OR 1=1", '', undefined, 7, 'x'.repeat(60)]) {
    const fx = relFixture();
    await rejectsStatus(createRelation(fx.q, args({ typeSlug })), 400);
    assert.ok(!fx.find('INSERT INTO'));
  }
  await rejectsStatus(createRelation(relFixture().q, args({ typeSlug: 'old' })), 409);
  await rejectsStatus(createRelation(relFixture().q, args({ targetId: RT_CONCEPT })), 404);
  await rejectsStatus(createRelation(relFixture().q, args({ sourceId: RT_CONCEPT, actorUserId: U.curator })), 404);
  await rejectsStatus(createRelation(relFixture().q, args({ targetId: id(999) })), 404);
});

test('createRelation: pinned to the caller\'s space — concepts of another space are 404, spaceId is required', async () => {
  for (const over of [{ targetId: C4 }, { sourceId: C4 }, { spaceId: OTHER_SPACE }, { spaceId: undefined }, { spaceId: 'nope' }]) {
    const fx = relFixture();
    await rejectsStatus(createRelation(fx.q, args({ actorUserId: U.admin, ...over })), 404);
    assert.ok(!fx.calls.some((c) => /INSERT|BEGIN/.test(c.text)), JSON.stringify(over));
  }
});

test('createRelation: the type is re-read inside the transaction, after the advisory lock (concurrent property changes are seen)', async () => {
  const order = (fx) => {
    const at = (s) => fx.calls.findIndex((c) => c.text.includes(s));
    return [at('BEGIN'), at('pg_advisory_xact_lock'), at('FROM "RelationType" t WHERE t.id'), at('SELECT id FROM "ConceptRelation"')];
  };
  const ok = relFixture();
  await createRelation(ok.q, args());
  const o = order(ok);
  assert.ok(o.every((i) => i >= 0) && o.join() === [...o].sort((a, b) => a - b).join(), `order ${o}`);
  assert.deepEqual(ok.find('FROM "RelationType" t WHERE t.id').params, [T.derives, SPACE]);
  assert.doesNotMatch(ok.find('FROM "RelationType" t WHERE t."spaceId"').text, /symmetric|hierarchical|isArchived/, 'nothing but the id is trusted from the first read');

  // Archived meanwhile → 409, rolled back.
  let fx = relFixture({ lockedType: { isArchived: true } });
  await rejectsStatus(createRelation(fx.q, args()), 409);
  assert.ok(fx.texts().includes('ROLLBACK') && !fx.find('INSERT INTO'));
  // Became symmetric meanwhile → the mirrored pair is a duplicate.
  fx = relFixture({ lockedType: { symmetric: true }, relations: [{ typeId: T.derives, sourceId: C2, targetId: C1 }] });
  await rejectsStatus(createRelation(fx.q, args()), 409);
  // Became hierarchical meanwhile → the cycle check runs.
  fx = relFixture({ lockedType: { hierarchical: true }, relations: [{ typeId: T.derives, sourceId: C2, targetId: C3 }, { typeId: T.derives, sourceId: C3, targetId: C1 }] });
  await rejectsStatus(createRelation(fx.q, args()), 409);
  assert.ok(!fx.find('INSERT INTO'));
});

test('createRelation: guests, strangers and anonymous are denied', async () => {
  for (const [actor, status] of [[U.guest, 403], [id(999), 403], [null, 401]]) {
    const fx = relFixture();
    await rejectsStatus(createRelation(fx.q, args({ actorUserId: actor })), status);
    assert.ok(!fx.calls.some((c) => /INSERT|BEGIN/.test(c.text)));
  }
});

test('createRelation: duplicate 409 (also on a unique violation), rolled back', async () => {
  let fx = relFixture({ relations: [{ typeId: T.derives, sourceId: C1, targetId: C2 }] });
  await rejectsStatus(createRelation(fx.q, args()), 409);
  assert.ok(fx.texts().includes('ROLLBACK') && !fx.find('INSERT INTO'));
  // Same pair, another type: fine.
  assert.deepEqual(await createRelation(relFixture({ relations: [{ typeId: T.combines, sourceId: C1, targetId: C2 }] }).q, args()), { id: REL });
  // A directed type may hold the reverse relation.
  assert.deepEqual(await createRelation(relFixture({ relations: [{ typeId: T.derives, sourceId: C2, targetId: C1 }] }).q, args()), { id: REL });

  fx = relFixture({ insertError: { message: 'dup', code: '23505' } });
  await rejectsStatus(createRelation(fx.q, args()), 409);
  assert.ok(fx.texts().includes('ROLLBACK') && !fx.texts().includes('COMMIT'));
});

test('createRelation: symmetric dedupe — A–B and B–A are the same relation', async () => {
  const fx = relFixture({ relations: [{ typeId: T.combines, sourceId: C2, targetId: C1 }] });
  await rejectsStatus(createRelation(fx.q, args({ typeSlug: 'combines' })), 409);
  const dup = fx.calls.find((c) => /SELECT id FROM "ConceptRelation"\s+WHERE "typeId"/.test(c.text));
  assert.deepEqual(dup.params, [T.combines, C1, C2, true]);
  assert.match(dup.text, /\$4::boolean AND "sourceId" = \$3::uuid AND "targetId" = \$2::uuid/);
  assert.ok(!fx.find('INSERT INTO'));
});

test('createRelation: a hierarchical type rejects a relation that closes a cycle (409), allows the rest', async () => {
  const chain = [{ typeId: T.contains, sourceId: C1, targetId: C2 }, { typeId: T.contains, sourceId: C2, targetId: C3 }];
  let fx = relFixture({ relations: chain });
  await rejectsStatus(createRelation(fx.q, args({ sourceId: C3, targetId: C1, typeSlug: 'contains' })), 409);
  assert.ok(fx.texts().includes('ROLLBACK') && !fx.find('INSERT INTO'));
  await rejectsStatus(createRelation(relFixture({ relations: chain }).q, args({ sourceId: C2, targetId: C1, typeSlug: 'contains' })), 409);
  // A shortcut down the hierarchy is not a cycle.
  assert.deepEqual(await createRelation(relFixture({ relations: chain }).q, args({ sourceId: C1, targetId: C3, typeSlug: 'contains' })), { id: REL });
  // Non-hierarchical types may form cycles: the cycle statement is not even run.
  fx = relFixture({ relations: [{ typeId: T.derives, sourceId: C1, targetId: C2 }, { typeId: T.derives, sourceId: C2, targetId: C3 }] });
  assert.deepEqual(await createRelation(fx.q, args({ sourceId: C3, targetId: C1 })), { id: REL });
  assert.ok(!fx.calls.some((c) => /SELECT "sourceId", "targetId" FROM "ConceptRelation" WHERE "typeId"/.test(c.text)));
});

const del = (over = {}) => ({ relationId: REL, spaceId: SPACE, actorUserId: U.member, ...over });

test('deleteRelation: own member ok, other member 403, curator ok, deleted creator only curator', async () => {
  let fx = relFixture();
  assert.deepEqual(await deleteRelation(fx.q, del()), { deleted: true });
  assert.deepEqual(fx.find('DELETE FROM "ConceptRelation"').params, [REL, SPACE]);

  fx = relFixture();
  await rejectsStatus(deleteRelation(fx.q, del({ actorUserId: U.author })), 403);
  assert.ok(!fx.find('DELETE FROM'));

  assert.deepEqual(await deleteRelation(relFixture().q, del({ actorUserId: U.curator })), { deleted: true });
  await rejectsStatus(deleteRelation(relFixture({ relCreatedBy: null }).q, del()), 403);
  await rejectsStatus(deleteRelation(relFixture().q, del({ relationId: id(999), actorUserId: U.curator })), 404);
});

test('deleteRelation: pinned to the space — a relation id from another space is 404 even for an admin', async () => {
  for (const over of [{ spaceId: OTHER_SPACE }, { spaceId: undefined }]) {
    const fx = relFixture();
    await rejectsStatus(deleteRelation(fx.q, del({ actorUserId: U.admin, ...over })), 404);
    assert.ok(!fx.find('DELETE FROM'));
  }
  const fx = relFixture();
  await deleteRelation(fx.q, del());
  assert.match(fx.find('SELECT r.id, r."spaceId", r."createdBy"').text, /WHERE r\.id = \$1::uuid AND r\."spaceId" = \$2::uuid/);
});

test('deleteRelation: the owner cannot erase others\' stances or a settled relation (409); curators always can', async () => {
  // Someone else took a stance.
  let fx = relFixture({ stanceHolders: [U.author] });
  await rejectsStatus(deleteRelation(fx.q, del()), 409);
  assert.ok(!fx.find('DELETE FROM'));
  // Only the owner's own stance: still theirs alone.
  assert.deepEqual(await deleteRelation(relFixture({ stanceHolders: [U.member] }).q, del()), { deleted: true });
  // Settled.
  await rejectsStatus(deleteRelation(relFixture({ settled: true }).q, del()), 409);
  for (const actor of [U.curator, U.admin]) {
    assert.deepEqual(await deleteRelation(relFixture({ settled: true, stanceHolders: [U.author, U.member] }).q, del({ actorUserId: actor })), { deleted: true });
  }
  // The check reads a yes/no only — never who holds a stance.
  fx = relFixture();
  await deleteRelation(fx.q, del());
  const sel = fx.find('SELECT r.id, r."spaceId", r."createdBy"');
  assert.match(sel.text, /EXISTS \(SELECT 1 FROM "ConceptRelationStance" s\s+WHERE s\."relationId" = r\.id AND s\."userId" IS DISTINCT FROM \$3::uuid\) AS "othersHaveStances"/);
  assert.deepEqual(sel.params, [REL, SPACE, U.member]);
});

// ---------------------------------------------------------------------------
// graph
// ---------------------------------------------------------------------------

const listRows = [
  { id: C1, slug: 'pharmakon', label: 'Pharmakon', labelNb: 'Farmakon', status: 'discussion', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: 't',
    forumId: FORUM, forumSlug: 'stiegler', forumTitle: 'Stiegler', langs: ['nb', 'en'] },
  { id: C2, slug: 'b', label: 'B', labelNb: null, status: 'neologism', createdAt: new Date('2026-09-02T00:00:00.000Z'), updatedAt: 't',
    forumId: null, forumSlug: null, forumTitle: null, langs: ['en'] },
  { id: C3, slug: 'c', label: 'C', labelNb: null, status: 'neologism', createdAt: '2026-09-03T00:00:00.000Z', updatedAt: 't',
    forumId: null, forumSlug: null, forumTitle: null, langs: ['en'] },
];
const typeView = (slug, over = {}) => ({
  slug, label: slug, labelNb: null, inverseLabel: null, inverseLabelNb: null, render: 'line', stroke: 'solid', arrow: true, color: 'ink',
  symmetric: false, transitive: false, hierarchical: false, skos: null, wikidata: null, position: 1, isBuiltin: true, isArchived: false,
  createdAt: '2026-09-30T00:00:00.000Z', relationCount: 1,
  // Planted: never part of the payload.
  id: T[slug], createdBy: U.curator, ...over,
});
const TYPE_VIEWS = [
  typeView('derives', { transitive: true, color: 'purple' }),
  typeView('combines', { symmetric: true, arrow: false, position: 2 }),
  typeView('old', { isArchived: true, relationCount: 0, position: 3 }),
];
const relRow = (n, s, t, type, over = {}) => ({
  id: id(50 + n), sourceId: s, targetId: t, type, createdAt: `2026-09-1${n}T00:00:00.000Z`, settled: false, agree: 0, disagree: 0,
  createdBy: U.member, settledBy: U.curator, ...over,
});

function graphFixture({ concepts = listRows, rels = [], types = TYPE_VIEWS } = {}) {
  return fakeQuery([
    ['FROM "Concept" c', () => concepts],
    ['FROM "RelationType" t', () => types],
    ['FROM "ConceptRelation" r', () => rels],
    ['FROM "ConceptVersion"', () => [
      { conceptId: C1, lang: 'en', definition: 'A **remedy** and a [poison](https://x.org) <b>at once</b>' },
      { conceptId: C1, lang: 'nb', definition: 'Både *medisin* og gift.' },
      { conceptId: C2, lang: 'en', definition: 'English only.' },
    ]],
  ]);
}

test('graph: slug nodes with createdAt, typed edges with totals/settled/createdAt, relationTypes; no user fields', async () => {
  const fx = graphFixture({
    concepts: listRows.slice(0, 2),
    rels: [
      relRow(1, C1, C2, 'derives', { agree: 3, disagree: 1, settled: true }),
      relRow(2, C1, C3, 'combines'), // C3 is not an included node
    ],
  });
  const g = await graph(fx.q, { spaceId: SPACE });
  assert.deepEqual(g.nodes[0], { id: 'pharmakon', label: 'Pharmakon', labelNb: 'Farmakon', status: 'discussion', forum: 'stiegler',
    excerpt: 'A remedy and a poison at once', excerptLang: 'en', createdAt: '2026-09-01T00:00:00.000Z' });
  assert.deepEqual(g.nodes[1], { id: 'b', label: 'B', labelNb: null, status: 'neologism', forum: null, excerpt: 'English only.',
    excerptLang: 'en', createdAt: '2026-09-02T00:00:00.000Z' });
  assert.deepEqual(g.edges, [{ id: id(51), source: 'pharmakon', target: 'b', type: 'derives', inferred: false, agree: 3, disagree: 1,
    createdAt: '2026-09-11T00:00:00.000Z', settled: true }]);
  // Legend: the space's types in order; an archived type without relations is left out.
  assert.deepEqual(g.relationTypes.map((t) => t.slug), ['derives', 'combines']);
  assert.deepEqual(fx.find('FROM "RelationType" t').params, [SPACE, true]);
  const json = JSON.stringify(g);
  for (const uid of Object.values(U)) assert.ok(!json.includes(uid));
  assert.ok(!/email|createdBy|settledBy|userId/i.test(json));
});

test('graph: the relations statement reads stance totals only — never who holds a stance', async () => {
  const fx = graphFixture({ rels: [relRow(1, C1, C2, 'derives')] });
  await graph(fx.q, { spaceId: SPACE });
  const sql = fx.find('JOIN "RelationType" t ON t.id = r."typeId"').text;
  assert.match(sql, /count\(\*\) FROM "ConceptRelationStance" s WHERE s\."relationId" = r\.id AND s\.stance = 'agree'/);
  assert.match(sql, /JOIN "RelationType" t ON t\.id = r\."typeId"/);
  for (const c of fx.calls) assert.doesNotMatch(c.text, /s\."userId"|"User"|\.name\b|email/);
});

test('graph: inferred edges for transitive types — flagged, no id, no totals, never duplicating an asserted edge', async () => {
  const fx = graphFixture({
    rels: [relRow(1, C1, C2, 'derives', { agree: 2 }), relRow(2, C2, C3, 'derives'), relRow(3, C1, C2, 'combines'), relRow(4, C2, C3, 'combines')],
  });
  const g = await graph(fx.q, { spaceId: SPACE });
  const inferred = g.edges.filter((e) => e.inferred);
  assert.deepEqual(inferred, [{ id: null, source: 'pharmakon', target: 'c', type: 'derives', inferred: true, agree: 0, disagree: 0,
    createdAt: '2026-09-12T00:00:00.000Z', settled: false }], 'combines is not transitive; createdAt = latest edge of the path');
  assert.equal(g.edges.filter((e) => !e.inferred).length, 4);

  // The same pair asserted: nothing inferred.
  const dup = await graph(graphFixture({
    rels: [relRow(1, C1, C2, 'derives'), relRow(2, C2, C3, 'derives'), relRow(3, C1, C3, 'derives')],
  }).q, { spaceId: SPACE });
  assert.equal(dup.edges.filter((e) => e.inferred).length, 0);
  assert.equal(dup.edges.length, 3);
});

test('graph: inference is cycle-safe and symmetric types infer one edge per pair', async () => {
  const cyc = await graph(graphFixture({
    rels: [relRow(1, C1, C2, 'derives'), relRow(2, C2, C3, 'derives'), relRow(3, C3, C1, 'derives')],
  }).q, { spaceId: SPACE });
  const inferred = cyc.edges.filter((e) => e.inferred).map((e) => `${e.source}>${e.target}`).sort();
  assert.deepEqual(inferred, ['b>pharmakon', 'c>b', 'pharmakon>c']);

  const sym = await graph(graphFixture({
    types: [typeView('combines', { symmetric: true, transitive: true })],
    rels: [relRow(1, C2, C1, 'combines'), relRow(2, C2, C3, 'combines')],
  }).q, { spaceId: SPACE });
  assert.deepEqual(sym.edges.filter((e) => e.inferred).map((e) => `${e.source}>${e.target}`), ['pharmakon>c']);
});

test('graph: a path through a filtered-out concept still infers between visible nodes; hidden ends give no edge', async () => {
  const fx = graphFixture({
    concepts: [listRows[0], listRows[2]], // C2 filtered out (forum/status filter)
    rels: [relRow(1, C1, C2, 'derives'), relRow(2, C2, C3, 'derives')],
  });
  const g = await graph(fx.q, { spaceId: SPACE, forumId: FORUM });
  assert.deepEqual(g.edges.map((e) => [e.source, e.target, e.inferred]), [['pharmakon', 'c', true]]);
});

test('graph: excerpt follows the reader language; empty space still returns the legend', async () => {
  const nb = await graph(graphFixture().q, { spaceId: SPACE, lang: 'nb' });
  assert.deepEqual([nb.nodes[0].excerpt, nb.nodes[0].excerptLang], ['Både medisin og gift.', 'nb']);
  assert.deepEqual([nb.nodes[1].excerpt, nb.nodes[1].excerptLang], ['English only.', 'en']);
  assert.deepEqual([nb.nodes[2].excerpt, nb.nodes[2].excerptLang], ['', null]);
  const empty = await graph(graphFixture({ concepts: [] }).q, { spaceId: SPACE });
  assert.deepEqual([empty.nodes, empty.edges], [[], []]);
  assert.deepEqual(empty.relationTypes.map((t) => t.slug), ['derives', 'combines']);
});
