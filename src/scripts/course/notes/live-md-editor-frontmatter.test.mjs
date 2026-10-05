import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { buildMarkDecos, frontmatterField, BLOCK_NODES, INLINE_NODES } from './live-md-editor.ts';

function classes(doc) {
  const state = EditorState.create({ doc, extensions: [markdown(), frontmatterField] });
  ensureSyntaxTree(state, doc.length, 5000);
  const out = [];
  for (const map of [BLOCK_NODES, INLINE_NODES]) {
    const set = buildMarkDecos(state, map, 0, doc.length);
    set.between(0, doc.length, (from, to, v) => { out.push([doc.slice(from, to), v.spec.class]); });
  }
  return out;
}

test('markdown styling survives after frontmatter; frontmatter itself is not a heading', () => {
  const doc = '---\ntitle: x\n---\n# Head\n\nsome **bold** text\n';
  const c = classes(doc);
  assert.ok(c.some(([t, k]) => k === 'cm-lmd-h1' && t === '# Head'), JSON.stringify(c));
  assert.ok(c.some(([t, k]) => k === 'cm-lmd-bold' && t === '**bold**'), JSON.stringify(c));
  assert.ok(!c.some(([t, k]) => /^cm-lmd-h2$/.test(k) || t.includes('title')), JSON.stringify(c));
});

test('docs without frontmatter still style normally', () => {
  const c = classes('# A\n\n**b**\n');
  assert.ok(c.some(([, k]) => k === 'cm-lmd-h1') && c.some(([, k]) => k === 'cm-lmd-bold'));
});

test('frontmatter field exposes block end and ignores a plain leading rule', () => {
  const mk = (doc) => EditorState.create({ doc, extensions: [markdown(), frontmatterField] }).field(frontmatterField);
  assert.equal(mk('---\na: 1\n---\nx').end, 14);
  assert.equal(mk('---\n\ntext\n\n---\n'), null);
});
