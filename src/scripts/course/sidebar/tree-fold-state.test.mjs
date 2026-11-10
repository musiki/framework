import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenState, foldKeyFromTitles } from './tree-fold-state.mjs';

test('parseOpenState tolera vacío, basura y tipos raros', () => {
  assert.deepEqual([...parseOpenState(null)], []);
  assert.deepEqual([...parseOpenState('{roto')], []);
  assert.deepEqual([...parseOpenState('{"a":1}')], []);
  assert.deepEqual([...parseOpenState('["01 FORMA", 3, "70 CONCEPTOS / timbre"]')], ['01 FORMA', '70 CONCEPTOS / timbre']);
});

test('foldKeyFromTitles: ruta de títulos normalizada', () => {
  assert.equal(foldKeyFromTitles(['  70 CONCEPTOS ', 'timbre\n orquestación', '']), '70 CONCEPTOS / timbre orquestación');
});

test('foldKeyFromTitles: sin los glifos de adelante de las carpetas', () => {
  assert.equal(foldKeyFromTitles(['70 CONCEPTOS', '▸⊟00-inicios-de-investigación']), '70 CONCEPTOS / 00-inicios-de-investigación');
});
