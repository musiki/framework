import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIndexQuery, indexSearch, sortLink, ariaSort, filterIndex, sortIndex, groupIndex, indexForums, DEFAULT_DIR,
} from './concepts-index.ts';
import { listConceptIndex, CONCEPT_INDEX_LIMIT } from './concepts-core.ts';

const row = (slug, over = {}) => ({
  id: `id-${slug}`, slug, label: slug[0].toUpperCase() + slug.slice(1), labelNb: null, status: 'neologism',
  createdAt: '2026-09-01T00:00:00Z', lastActivityAt: '2026-09-01T00:00:00Z',
  forum: { slug: 'stiegler', title: 'Stiegler', archived: false }, channel: null, postCount: 0, relationTypes: [], relationCount: 0,
  ...over,
});
const rels = (...pairs) => {
  const relationTypes = pairs.map(([type, n]) => ({ type, n }));
  return { relationTypes, relationCount: relationTypes.reduce((s, x) => s + x.n, 0) };
};

const ROWS = [
  row('memory', { status: 'assimilated', createdAt: '2026-09-03T00:00:00Z', lastActivityAt: '2026-09-29T00:00:00Z', ...rels(['derives', 2]) }),
  row('archive', { status: 'discussion', createdAt: '2026-09-06T00:00:00Z', lastActivityAt: '2026-09-07T00:00:00Z', labelNb: 'Arkiv', ...rels(['exemplifies', 1], ['derives', 1]) }),
  row('pharmakon', { createdAt: '2026-09-05T00:00:00Z', lastActivityAt: '2026-09-20T00:00:00Z', forum: { slug: 'derrida', title: 'Derrida', archived: false } }),
  row('zeta', { forum: null, ...rels(['contains', 3]) }),
];

test('parseIndexQuery: defaults, natural directions, unknown values ignored', () => {
  assert.deepEqual(parseIndexQuery(new URLSearchParams('')), { sort: 'label', dir: 'asc', group: 'none', status: '', forum: '', type: '' });
  assert.equal(parseIndexQuery(new URLSearchParams('sort=date')).dir, 'desc');
  assert.equal(parseIndexQuery(new URLSearchParams('sort=relations&dir=asc')).dir, 'asc');
  const q = parseIndexQuery(new URLSearchParams('sort=evil&dir=up&group=x&status=gone&forum=Bad Slug&type=%3Cscript%3E'));
  assert.deepEqual(q, { sort: 'label', dir: 'asc', group: 'none', status: '', forum: '', type: '' });
  assert.deepEqual(parseIndexQuery(new URLSearchParams('group=type&status=discussion&forum=stiegler&type=derives')),
    { sort: 'label', dir: 'asc', group: 'type', status: 'discussion', forum: 'stiegler', type: 'derives' });
  assert.equal(DEFAULT_DIR.activity, 'desc');
});

test('indexSearch / sortLink / ariaSort', () => {
  const q = parseIndexQuery(new URLSearchParams('group=status&forum=stiegler'));
  assert.equal(indexSearch(parseIndexQuery(new URLSearchParams(''))), '');
  assert.equal(indexSearch(q), '?group=status&forum=stiegler');
  assert.equal(sortLink(q, 'date'), '/concepts?sort=date&group=status&forum=stiegler');
  assert.equal(sortLink(q, 'label'), '/concepts?dir=desc&group=status&forum=stiegler', 'already sorted by label: toggles');
  const byDate = parseIndexQuery(new URLSearchParams('sort=date'));
  assert.equal(sortLink(byDate, 'date'), '/concepts?sort=date&dir=asc');
  assert.equal(ariaSort(byDate, 'date'), 'descending');
  assert.equal(ariaSort(byDate, 'label'), 'none');
  assert.equal(ariaSort(q, 'label'), 'ascending');
});

test('filterIndex: status, forum and relation type combine', () => {
  const slugs = (rs) => rs.map((r) => r.slug);
  assert.deepEqual(slugs(filterIndex(ROWS, { status: '', forum: '', type: '' })), ['memory', 'archive', 'pharmakon', 'zeta']);
  assert.deepEqual(slugs(filterIndex(ROWS, { status: 'neologism', forum: '', type: '' })), ['pharmakon', 'zeta']);
  assert.deepEqual(slugs(filterIndex(ROWS, { status: '', forum: 'stiegler', type: '' })), ['memory', 'archive']);
  assert.deepEqual(slugs(filterIndex(ROWS, { status: '', forum: '', type: 'derives' })), ['memory', 'archive']);
  assert.deepEqual(slugs(filterIndex(ROWS, { status: 'discussion', forum: 'stiegler', type: 'exemplifies' })), ['archive']);
});

test('sortIndex: every key, both directions, stable label ties, reader-language labels', () => {
  const s = (sort, dir, lang = 'en') => sortIndex(ROWS, sort, dir, lang).map((r) => r.slug);
  assert.deepEqual(s('label', 'asc'), ['archive', 'memory', 'pharmakon', 'zeta']);
  assert.deepEqual(s('label', 'desc'), ['zeta', 'pharmakon', 'memory', 'archive']);
  assert.deepEqual(s('label', 'asc', 'nb'), ['archive', 'memory', 'pharmakon', 'zeta'], 'Arkiv still first');
  assert.deepEqual(s('date', 'desc'), ['archive', 'pharmakon', 'memory', 'zeta']);
  assert.deepEqual(s('activity', 'desc'), ['memory', 'pharmakon', 'archive', 'zeta']);
  assert.deepEqual(s('status', 'asc'), ['pharmakon', 'zeta', 'archive', 'memory']);
  assert.deepEqual(s('relations', 'desc'), ['zeta', 'archive', 'memory', 'pharmakon']);
  assert.deepEqual(s('forum', 'asc'), ['zeta', 'pharmakon', 'archive', 'memory'], 'no forum sorts first ascending');
  assert.notEqual(sortIndex(ROWS, 'label', 'asc', 'en'), ROWS, 'returns a copy');
});

test('groupIndex: none, status order, forum (no forum last), relation type (each concept under each type)', () => {
  assert.deepEqual(groupIndex(ROWS, 'none').map((g) => g.rows.length), [4]);
  assert.deepEqual(groupIndex(ROWS, 'status').map((g) => [g.key, g.rows.map((r) => r.slug)]),
    [['neologism', ['pharmakon', 'zeta']], ['discussion', ['archive']], ['assimilated', ['memory']]]);
  assert.deepEqual(groupIndex(ROWS, 'forum').map((g) => [g.key, g.rows.length]), [['derrida', 1], ['stiegler', 2], ['', 1]]);
  const byType = groupIndex(ROWS, 'type', { typeOrder: ['derives', 'contains', 'exemplifies'] });
  assert.deepEqual(byType.map((g) => [g.key, g.rows.map((r) => r.slug), g.relations]), [
    ['derives', ['memory', 'archive'], 3],
    ['contains', ['zeta'], 3],
    ['exemplifies', ['archive'], 1],
    ['', ['pharmakon'], 0],
  ]);
  assert.deepEqual(groupIndex([], 'status'), []);
});

test('indexForums: distinct groups by title', () => {
  assert.deepEqual(indexForums(ROWS), [{ slug: 'derrida', title: 'Derrida' }, { slug: 'stiegler', title: 'Stiegler' }]);
});

test('listConceptIndex: space-scoped, concepts only, bounded, no user fields; maps counts and channel', async () => {
  const calls = [];
  const q = async (text, params) => {
    calls.push({ text, params });
    return { data: [{
      id: 'c1', slug: 'memory', label: 'Memory', labelNb: null, status: 'discussion',
      createdAt: new Date('2026-09-01T00:00:00Z'), lastActivityAt: new Date('2026-09-02T00:00:00Z'),
      groupSlug: 'stiegler', groupTitle: 'Stiegler', groupArchived: false,
      boardSlug: 'reading', boardTitle: 'Reading', boardArchived: false, boardParentId: 'g1',
      postCount: '3', relationCount: 3, relationTypes: [{ type: 'derives', n: 2 }, { type: 'combines', n: 1 }, { type: '', n: 4 }],
    }, {
      id: 'c2', slug: 'archive', label: 'Archive', labelNb: 'Arkiv', status: 'neologism',
      createdAt: '2026-09-03T00:00:00Z', lastActivityAt: null, groupSlug: null, boardSlug: 'stiegler', boardParentId: null,
      postCount: 0, relationTypes: '[]',
    }], error: null };
  };
  const out = await listConceptIndex(q, { spaceId: '00000000-0000-4000-8000-000000000001' });
  const sql = calls[0].text;
  assert.match(sql, /WHERE c\."spaceId" = \$1::uuid AND c\.kind = 'concept'/);
  assert.match(sql, new RegExp(`LIMIT ${CONCEPT_INDEX_LIMIT}`));
  assert.match(sql, /r\."spaceId" = c\."spaceId"/);
  assert.match(sql, /LEFT JOIN "RelationType" t ON t\.id = r\."typeId"/);
  assert.match(sql, /AS "relationCount"/);
  assert.doesNotMatch(sql, /"User"|email|createdBy/);
  assert.deepEqual(out[0], {
    id: 'c1', slug: 'memory', label: 'Memory', labelNb: null, status: 'discussion',
    createdAt: '2026-09-01T00:00:00.000Z', lastActivityAt: '2026-09-02T00:00:00.000Z',
    forum: { slug: 'stiegler', title: 'Stiegler', archived: false },
    channel: { slug: 'reading', title: 'Reading', archived: false },
    postCount: 3, relationTypes: [{ type: 'combines', n: 1 }, { type: 'derives', n: 2 }], relationCount: 3,
  });
  assert.equal(out[1].forum, null);
  assert.equal(out[1].channel, null, 'a thread in the group itself is not a channel');
  assert.equal(out[1].lastActivityAt, '2026-09-03T00:00:00Z', 'falls back to the creation date');
  assert.deepEqual(await listConceptIndex(q, { spaceId: 'nope' }), []);
});
