import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, loadExport } from './export-core.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPACE = id(1);
const U1 = id(101);
const U2 = id(102);

// DB rows as the loader's SQL returns them. Emails/ids are planted in extra
// columns to prove they never reach the export.
const conceptRows = [
  { id: id(20), slug: 'co-creation', label: 'Co-creation', labelNb: 'Samskaping', status: 'assimilated', forumSlug: 'stiegler', forumTitle: 'Stiegler', createdBy: U1, email: 'a@example.org' },
  { id: id(21), slug: 'machine-listening', label: 'Machine listening', labelNb: null, status: 'neologism', forumSlug: null, forumTitle: null, createdBy: U2 },
  { id: id(22), slug: 'orphan', label: 'Orphan', labelNb: null, status: 'discussion', forumSlug: null, forumTitle: null },
];
const versionRows = [
  { conceptId: id(20), lang: 'en', definition: 'v1 en', createdAt: '2026-09-01T00:00:00Z', creditedName: 'Ana', creditedDeleted: false, creditedUserId: U1, email: 'ana@example.org' },
  { conceptId: id(20), lang: 'en', definition: 'v2 en adopted', createdAt: '2026-09-03T00:00:00Z', creditedName: 'Bo', creditedDeleted: false, creditedUserId: U2 },
  { conceptId: id(20), lang: 'nb', definition: 'v1 nb', createdAt: '2026-09-02T00:00:00Z', creditedName: 'Ana', creditedDeleted: false },
  { conceptId: id(20), lang: 'en', definition: 'by deleted', createdAt: '2026-08-01T00:00:00Z', creditedName: null, creditedDeleted: true },
  { conceptId: id(21), lang: 'en', definition: 'ml', createdAt: '2026-09-01T00:00:00Z', creditedName: '  ', creditedDeleted: false },
  // id(22) has no English version → skipped.
  { conceptId: id(22), lang: 'nb', definition: 'bare nb', createdAt: '2026-09-01T00:00:00Z', creditedName: 'Ana', creditedDeleted: false },
];
const relationRows = [
  { sourceId: id(21), targetId: id(20), type: 'derives', createdBy: U1, settledBy: U2 },
  { sourceId: id(22), targetId: id(20), type: 'combines' }, // skipped concept → dropped edge
  { sourceId: id(20), targetId: id(21), type: 'contains', agree: 3, disagree: 1 }, // custom type, by slug
  { sourceId: id(21), targetId: id(20), type: 'old-used' }, // archived type still in use
];
const typeRow = (slug, over = {}) => ({
  conceptId: id(80 + slug.length), slug, label: slug, labelNb: null, inverseLabel: null, inverseLabelNb: null, render: 'line',
  stroke: 'solid', arrow: true, color: 'ink', symmetric: false, transitive: false, hierarchical: false, skos: null, wikidata: null,
  isBuiltin: true, isArchived: false, createdBy: U1, email: 'curator@example.org', ...over,
});
const BUILTIN_LABELS = {
  derives: ['derives from', 'avledes fra'], combines: ['combines with', 'kombineres med'], contrasts: ['contrasts with', 'står i kontrast til'],
  reformulates: ['reformulates', 'reformulerer'], exemplifies: ['exemplifies', 'eksemplifiserer'],
};
const CONTAINS_CONCEPT = id(90);
const typeRows = [
  ...Object.entries(BUILTIN_LABELS).map(([slug, [label, labelNb]]) => typeRow(slug, { label, labelNb, symmetric: slug === 'combines' || slug === 'contrasts' })),
  typeRow('contains', {
    conceptId: CONTAINS_CONCEPT, label: 'contains', labelNb: 'inneholder', inverseLabel: 'is part of', inverseLabelNb: 'er del av',
    render: 'area', color: 'green', hierarchical: true, transitive: true, skos: 'skos:narrower', wikidata: 'P527', isBuiltin: false,
  }),
  typeRow('old-used', { isArchived: true, isBuiltin: false }),
  typeRow('old-unused', { isArchived: true, isBuiltin: false }),
];
const typeVersionRows = [
  { conceptId: CONTAINS_CONCEPT, lang: 'en', definition: 'v1', createdAt: '2026-09-01T00:00:00Z', creditedUserId: U1, email: 'x@example.org' },
  { conceptId: CONTAINS_CONCEPT, lang: 'en', definition: 'A **contains** B.', createdAt: '2026-09-02T00:00:00Z' },
  { conceptId: CONTAINS_CONCEPT, lang: 'nb', definition: 'A *inneholder* B.', createdAt: '2026-09-02T00:00:00Z' },
];

const fakeQ = (seen = []) => async (text, params) => {
  seen.push({ text, params });
  if (/FROM "Concept" c LEFT JOIN/.test(text)) return { data: conceptRows, error: null };
  if (/FROM "ConceptVersion"/.test(text) && /kind = 'relation-type'/.test(text)) return { data: typeVersionRows, error: null };
  if (/FROM "ConceptVersion"/.test(text)) return { data: versionRows, error: null };
  if (/FROM "RelationType" t/.test(text)) return { data: typeRows, error: null };
  if (/FROM "ConceptRelation"/.test(text)) return { data: relationRows, error: null };
  return { data: [], error: null };
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL_RE = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;
const PRIVATE_KEYS = new Set([
  'email', 'userId', 'createdBy', 'creditedUserId', 'editedBy', 'authorUserId', 'spaceId', 'uuid', 'settledBy', 'conceptId',
  // Nothing about stances: no names, no holders, no totals.
  'stances', 'stance', 'agree', 'disagree', 'myStance', 'afterReveal',
]);

function walk(value, path, visit) {
  visit(value, path);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`, visit);
}

test('export has the Lab shape + forum + _nb fields', async () => {
  const out = await loadExport(fakeQ(), SPACE, new Date('2026-09-29T12:00:00Z'));
  assert.equal(out.snapshot, '2026-09-29');
  for (const k of ['note', 'note_nb', 'statuses', 'statuses_nb', 'relation_types', 'relation_types_nb', 'relation_vocabulary', 'concepts', 'relations']) {
    assert.ok(k in out, k);
  }
  assert.deepEqual(Object.keys(out.statuses), ['neologism', 'discussion', 'assimilated']);
  // Lab compatibility: slug → label strings, now from the space's types (custom and archived-but-used included).
  assert.deepEqual(Object.keys(out.relation_types), ['derives', 'combines', 'contrasts', 'reformulates', 'exemplifies', 'contains', 'old-used']);
  for (const v of [...Object.values(out.relation_types), ...Object.values(out.relation_types_nb)]) assert.equal(typeof v, 'string');
  assert.equal(out.relation_types.derives, 'derives from');
  assert.equal(out.relation_types_nb.contains, 'inneholder');
  assert.equal(out.relation_types_nb['old-used'], 'old-used', 'label_nb falls back to the English label');

  assert.deepEqual(out.concepts, [
    {
      id: 'co-creation', label: 'Co-creation', status: 'assimilated', definition: 'v2 en adopted',
      authors: ['Ana', 'Bo'], forum: { id: 'stiegler', title: 'Stiegler' }, label_nb: 'Samskaping', definition_nb: 'v1 nb',
    },
    { id: 'machine-listening', label: 'Machine listening', status: 'neologism', definition: 'ml', authors: [], forum: null },
  ]);
  assert.deepEqual(out.relations, [
    { source: 'machine-listening', target: 'co-creation', type: 'derives' },
    { source: 'co-creation', target: 'machine-listening', type: 'contains' },
    { source: 'machine-listening', target: 'co-creation', type: 'old-used' },
  ]);
});

test('relation_vocabulary: labels, inverse, properties, encoding, mappings, current en/nb definition (markdown)', async () => {
  const out = await loadExport(fakeQ(), SPACE, new Date('2026-09-29T12:00:00Z'));
  assert.deepEqual(out.relation_vocabulary.map((t) => t.id), ['derives', 'combines', 'contrasts', 'reformulates', 'exemplifies', 'contains', 'old-used']);
  assert.deepEqual(out.relation_vocabulary.find((t) => t.id === 'contains'), {
    id: 'contains', label: 'contains', label_nb: 'inneholder', inverse: 'is part of', inverse_nb: 'er del av',
    properties: { symmetric: false, transitive: true, hierarchical: true },
    encoding: { render: 'area', stroke: 'solid', arrow: true, color: 'green' },
    mappings: { skos: 'skos:narrower', wikidata: 'P527' },
    definition: 'A **contains** B.', definition_nb: 'A *inneholder* B.', builtin: false,
  });
  assert.equal(out.relation_vocabulary.find((t) => t.id === 'combines').properties.symmetric, true);
  assert.equal(out.relation_vocabulary.find((t) => t.id === 'old-used').archived, true);
  assert.ok(!out.relation_vocabulary.some((t) => t.id === 'old-unused'), 'archived and unused → left out');
  assert.equal(out.relation_vocabulary.find((t) => t.id === 'derives').archived, undefined);
});

test('without relation type rows the five built-in labels and relations are kept (old shape)', () => {
  const out = buildExport({
    concepts: [
      { id: 'a', slug: 'a', label: 'A', labelNb: null, status: 'neologism', forumSlug: null, forumTitle: null },
      { id: 'b', slug: 'b', label: 'B', labelNb: null, status: 'neologism', forumSlug: null, forumTitle: null },
    ],
    versions: ['a', 'b'].map((c) => ({ conceptId: c, lang: 'en', definition: 'd', createdAt: '2026-01-01', creditedName: null, creditedDeleted: true })),
    relations: [{ sourceId: 'a', targetId: 'b', type: 'derives' }, { sourceId: 'a', targetId: 'b', type: 'custom' }],
  });
  assert.deepEqual(Object.keys(out.relation_types_nb), ['derives', 'combines', 'contrasts', 'reformulates', 'exemplifies']);
  assert.deepEqual(out.relations, [{ source: 'a', target: 'b', type: 'derives' }]);
  assert.deepEqual(out.relation_vocabulary, []);
});

test('export contains no emails, user ids or uuids anywhere', async () => {
  const out = await loadExport(fakeQ(), SPACE);
  walk(out, '$', (v, path) => {
    if (typeof v === 'string') {
      assert.doesNotMatch(v, UUID_RE, `uuid at ${path}`);
      assert.doesNotMatch(v, EMAIL_RE, `email at ${path}`);
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of Object.keys(v)) assert.ok(!PRIVATE_KEYS.has(k), `private key ${k} at ${path}`);
    }
  });
});

test('deleted or nameless credited users are omitted from authors', () => {
  const out = buildExport({
    concepts: [{ id: 'c', slug: 'x', label: 'X', labelNb: null, status: 'neologism', forumSlug: null, forumTitle: null }],
    versions: [
      { conceptId: 'c', lang: 'en', definition: 'd', createdAt: '2026-01-01', creditedName: null, creditedDeleted: true },
      { conceptId: 'c', lang: 'en', definition: 'd2', createdAt: '2026-01-02', creditedName: 'Gone', creditedDeleted: true },
    ],
    relations: [],
  });
  assert.deepEqual(out.concepts[0].authors, []);
});

test('loader SQL selects only display names and is scoped to the space', async () => {
  const seen = [];
  await loadExport(fakeQ(seen), SPACE);
  assert.equal(seen.length, 5);
  for (const s of seen) {
    assert.deepEqual(s.params, [SPACE]);
    assert.doesNotMatch(s.text, /\.email|"email"/);
    // No statement of the export reads stances, users of relations/types, or who settled.
    assert.doesNotMatch(s.text, /ConceptRelationStance|"createdBy"|"settledBy"/);
  }
  const versionSql = seen.find((s) => /ConceptVersion/.test(s.text) && /kind = 'concept'/.test(s.text)).text;
  const typeVersionSql = seen.find((s) => /ConceptVersion/.test(s.text) && /kind = 'relation-type'/.test(s.text)).text;
  assert.doesNotMatch(typeVersionSql, /"User"|creditedUserId|name/);
  assert.match(seen.find((s) => /FROM "ConceptRelation" r/.test(s.text)).text, /t\.slug AS type/);
  assert.match(versionSql, /u\.name AS "creditedName"/);
  assert.doesNotMatch(versionSql, /SELECT[^]*"creditedUserId",/);
  // Relation types' definition concepts (kind 'relation-type') are not concepts of the export.
  assert.match(seen.find((s) => /FROM "Concept" c LEFT JOIN/.test(s.text)).text, /c\.kind = 'concept'/);
  assert.match(versionSql, /c\.kind = 'concept'/);
});

test('names that look like e-mails are omitted from authors (living users are not "deleted")', () => {
  const out = buildExport({
    concepts: [{ id: id(30), slug: 'x', label: 'X', labelNb: null, status: 'neologism', forumSlug: null, forumTitle: null }],
    versions: [
      { conceptId: id(30), lang: 'en', definition: 'd', createdAt: '2026-09-01T00:00:00Z', creditedName: 'ana@uni.no', creditedDeleted: false },
      { conceptId: id(30), lang: 'en', definition: 'd2', createdAt: '2026-09-02T00:00:00Z', creditedName: 'Bo', creditedDeleted: false },
    ],
    relations: [],
  }, new Date('2026-09-29T00:00:00Z'));
  const c = out.concepts.find((x) => x.id === 'x');
  assert.deepEqual(c.authors, ['Bo']);
  assert.ok(!JSON.stringify(out).includes('@'));
});
