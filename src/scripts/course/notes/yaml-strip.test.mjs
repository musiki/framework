import assert from 'node:assert/strict';
import test from 'node:test';

import { parseFrontmatter, serializeFrontmatter } from '../../notes-editor/yaml-strip.ts';

test('parseFrontmatter accepts BOM and whitespace before YAML delimiters', () => {
  const parsed = parseFrontmatter('\uFEFF\n  \n---\ntitle: Forma\nchapter: 02-forma\n---\nTexto');

  assert.equal(parsed.data.title, 'Forma');
  assert.equal(parsed.data.chapter, '02-forma');
  assert.equal(parsed.body, 'Texto');
});

test('notes without YAML receive editable default properties when serialized', () => {
  const parsed = parseFrontmatter('# Materiales\nTexto');
  const content = serializeFrontmatter({ ...parsed.data, title: 'Materiales', chapter: '01-notas' }, parsed.body);

  assert.match(content, /^---\ntitle: Materiales\ntype: lesson\nchapter: 01-notas\nstatus: draft\norder: 0\n---\n/);
  assert.match(content, /# Materiales\nTexto$/);
});
