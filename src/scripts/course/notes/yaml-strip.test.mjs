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

test('claves con espacios, mapas anidados y listas sobreviven un ida y vuelta', async () => {
  const original = [
    '---',
    'title: Gustav Metzger',
    'born in city: Nuremberg',
    'died in city:',
    'tags:',
    '  - persona',
    '  - "[[arte autodestructivo]]"',
    'lily:',
    '  expected: true',
    '  format: scenes',
    'date: 2026-03-01',
    '---',
    'Texto',
  ].join('\n');
  const { parseFrontmatter: parse, serializeFrontmatter: serialize } = await import('../../notes-editor/yaml-strip.ts');
  const first = parse(original);
  assert.equal(first.error, null);
  assert.equal(first.data['born in city'], 'Nuremberg');
  assert.deepEqual(first.data.lily, { expected: true, format: 'scenes' });
  assert.equal(first.data.date, '2026-03-01', 'sin timestamps: la fecha queda como texto');

  const again = parse(serialize(first.data, first.body));
  assert.deepEqual(again.data, first.data);
  assert.match(serialize(first.data, first.body), /^died in city:\s*$/m, 'la clave vacía no desaparece');
});

test('YAML inválido se informa y no se adivina', async () => {
  const { parseFrontmatter: parse } = await import('../../notes-editor/yaml-strip.ts');
  const parsed = parse('---\ntitle: [sin cerrar\n---\nTexto');
  assert.ok(parsed.error);
  assert.equal(parsed.raw, 'title: [sin cerrar');
  assert.equal(parsed.body, 'Texto');
});
