import test from 'node:test';
import assert from 'node:assert/strict';
import { groupThreadsByKind, parseThreadOrder, threadOrderLink } from './thread-list.ts';

test('parseThreadOrder: date by default, type only when asked', () => {
  assert.equal(parseThreadOrder(new URLSearchParams('')), 'date');
  assert.equal(parseThreadOrder(new URLSearchParams('threads=type')), 'type');
  assert.equal(parseThreadOrder(new URLSearchParams('threads=TYPE')), 'date');
  assert.equal(parseThreadOrder(new URLSearchParams('threads=zzz')), 'date');
});

test('threadOrderLink keeps other parameters and anchors the list', () => {
  assert.equal(threadOrderLink(new URLSearchParams('lang=nb'), 'type'), '?lang=nb&threads=type#mm-threads');
  assert.equal(threadOrderLink(new URLSearchParams('lang=nb&threads=type'), 'date'), '?lang=nb#mm-threads');
  assert.equal(threadOrderLink(new URLSearchParams(''), 'date'), '?#mm-threads');
});

test('groupThreadsByKind: concept, relation, post; input order kept; empty groups dropped', () => {
  const list = [
    { id: 1, kind: 'post' }, { id: 2, kind: 'concept' }, { id: 3, kind: 'post' }, { id: 4, kind: 'concept' },
  ];
  const groups = groupThreadsByKind(list);
  assert.deepEqual(groups.map((g) => g.kind), ['concept', 'post']);
  assert.deepEqual(groups[0].threads.map((t) => t.id), [2, 4]);
  assert.deepEqual(groups[1].threads.map((t) => t.id), [1, 3]);
  assert.deepEqual(groupThreadsByKind([]), []);
});
