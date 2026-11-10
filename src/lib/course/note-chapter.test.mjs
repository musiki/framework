import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterForNode, humanizeChapter } from './note-chapter.mjs';

test('humanizeChapter saca el número y los guiones', () => {
  assert.equal(humanizeChapter('70 CONCEPTOS'), 'Conceptos');
  assert.equal(humanizeChapter('10-escritura-académica'), 'Escritura académica');
  assert.equal(humanizeChapter(''), '');
});

test('el chapter del frontmatter manda', () => {
  assert.deepEqual(chapterForNode({ id: 'cursos/s123/x/forma', chapter: 'FORMA Y ESTRUCTURA' }, 's123'),
    { id: 'FORMA Y ESTRUCTURA', label: 'Forma y estructura', order: 999 });
});

test('sin chapter: la carpeta de la materia o la de public', () => {
  assert.equal(chapterForNode({ id: 'cursos/s123/20-forma/forma' }, 's123').label, 'Forma');
  assert.equal(chapterForNode({ id: 'public/10-escritura académica/matriz-operativa', publicFolder: '10-escritura académica' }, 's123').label, 'Escritura académica');
});

test('sin carpeta: la raíz', () => {
  assert.deepEqual(chapterForNode({ id: 'cursos/s123/27-guia' }, 's123'), { id: '', label: '', order: -1 });
});
