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
  { sourceId: id(21), targetId: id(20), type: 'derives', createdBy: U1 },
  { sourceId: id(22), targetId: id(20), type: 'combines' }, // skipped concept → dropped edge
];

const fakeQ = (seen = []) => async (text, params) => {
  seen.push({ text, params });
  if (/FROM "Concept" c LEFT JOIN/.test(text)) return { data: conceptRows, error: null };
  if (/FROM "ConceptVersion"/.test(text)) return { data: versionRows, error: null };
  if (/FROM "ConceptRelation"/.test(text)) return { data: relationRows, error: null };
  return { data: [], error: null };
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL_RE = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;
const PRIVATE_KEYS = new Set(['email', 'userId', 'createdBy', 'creditedUserId', 'editedBy', 'authorUserId', 'spaceId', 'uuid']);

function walk(value, path, visit) {
  visit(value, path);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`, visit);
}

test('export has the Lab shape + forum + _nb fields', async () => {
  const out = await loadExport(fakeQ(), SPACE, new Date('2026-09-29T12:00:00Z'));
  assert.equal(out.snapshot, '2026-09-29');
  for (const k of ['note', 'note_nb', 'statuses', 'statuses_nb', 'relation_types', 'relation_types_nb', 'concepts', 'relations']) {
    assert.ok(k in out, k);
  }
  assert.deepEqual(Object.keys(out.statuses), ['neologism', 'discussion', 'assimilated']);
  assert.deepEqual(Object.keys(out.relation_types_nb), ['derives', 'combines', 'contrasts', 'reformulates', 'exemplifies']);

  assert.deepEqual(out.concepts, [
    {
      id: 'co-creation', label: 'Co-creation', status: 'assimilated', definition: 'v2 en adopted',
      authors: ['Ana', 'Bo'], forum: { id: 'stiegler', title: 'Stiegler' }, label_nb: 'Samskaping', definition_nb: 'v1 nb',
    },
    { id: 'machine-listening', label: 'Machine listening', status: 'neologism', definition: 'ml', authors: [], forum: null },
  ]);
  assert.deepEqual(out.relations, [{ source: 'machine-listening', target: 'co-creation', type: 'derives' }]);
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
  assert.equal(seen.length, 3);
  for (const s of seen) {
    assert.deepEqual(s.params, [SPACE]);
    assert.doesNotMatch(s.text, /\.email|"email"/);
  }
  const versionSql = seen.find((s) => /ConceptVersion/.test(s.text)).text;
  assert.match(versionSql, /u\.name AS "creditedName"/);
  assert.doesNotMatch(versionSql, /SELECT[^]*"creditedUserId",/);
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
