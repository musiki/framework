import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteRelPathKey } from './note-path.mjs';

test('saca acentos, baja a minúsculas y cambia espacios por guiones en cada segmento', () => {
  assert.equal(noteRelPathKey('03-organología/Introducción a la Organología'), '03-organologia/introduccion-a-la-organologia');
  assert.equal(noteRelPathKey('01-mentes/Vibecoding.md'), '01-mentes/vibecoding');
});

test('una ruta ya normalizada no cambia', () => {
  assert.equal(noteRelPathKey('03-organologia/instrumentalidad'), '03-organologia/instrumentalidad');
});

test('ignora barras sobrantes', () => {
  assert.equal(noteRelPathKey('/a//B c/'), 'a/b-c');
});
