import test from 'node:test';
import assert from 'node:assert/strict';
import { findFrontmatter, tokenizeYamlLine } from './frontmatter-yaml.ts';

const kinds = (line) => tokenizeYamlLine(line).map((t) => [t.kind, line.slice(t.from, t.to)]);

test('findFrontmatter locates the leading block', () => {
  const doc = '---\ntitle: x\n---\nbody';
  const fm = findFrontmatter(doc);
  assert.equal(fm.start, 0);
  assert.equal(doc.slice(fm.closeFrom, fm.end), '---');
  assert.equal(doc.slice(fm.end), '\nbody');
});
test('findFrontmatter returns null without leading or closing delimiter', () => {
  assert.equal(findFrontmatter('hello\n---\na: 1\n---'), null);
  assert.equal(findFrontmatter('---\na: 1\n'), null);
  assert.equal(findFrontmatter(''), null);
});
test('findFrontmatter handles CRLF and an empty block', () => {
  const doc = '---\r\na: 1\r\n---\r\nx';
  const fm = findFrontmatter(doc);
  assert.equal(doc.slice(fm.closeFrom, fm.end), '---');
  assert.ok(findFrontmatter('---\n---\n'));
});
test('key with string / number / bool / date / comment', () => {
  assert.deepEqual(kinds('title: "Hello"'), [['key', 'title'], ['punct', ':'], ['string', '"Hello"']]);
  assert.deepEqual(kinds('n: 12'), [['key', 'n'], ['punct', ':'], ['number', '12']]);
  assert.deepEqual(kinds('draft: true'), [['key', 'draft'], ['punct', ':'], ['bool', 'true']]);
  assert.deepEqual(kinds('date: 2026-10-05'), [['key', 'date'], ['punct', ':'], ['number', '2026-10-05']]);
  assert.deepEqual(kinds('a: b # note'), [['key', 'a'], ['punct', ':'], ['comment', '# note']]);
});
test('comment lines, list items and flow sequences', () => {
  assert.deepEqual(kinds('  # hi'), [['comment', '# hi']]);
  assert.deepEqual(kinds('- 3'), [['punct', '-'], ['number', '3']]);
  assert.deepEqual(kinds('- tags: x').slice(0, 2), [['punct', '-'], ['key', 'tags']]);
  assert.deepEqual(kinds('t: [a, 1, "b"]').filter(([k]) => k !== 'key' && k !== 'punct'), [['number', '1'], ['string', '"b"']]);
});
test('colon inside value does not create a second key', () => {
  const k = kinds('url: http://x.org');
  assert.equal(k.filter(([t]) => t === 'key').length, 1);
});
test('tokens are sorted and non-overlapping', () => {
  for (const line of ['title: "a"  # c', '- k: [1, "b"] # z', 'a: 2026-10-05T10:00:00Z']) {
    const t = tokenizeYamlLine(line);
    for (let i = 1; i < t.length; i++) assert.ok(t[i].from >= t[i - 1].to, line);
  }
});
