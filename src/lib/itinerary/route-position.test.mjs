import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conceptState, noteKey, resolveRoute, sliceItems, visibleStopIndexes } from './route-position.mjs';

test('noteKey compara slugs de cualquier forma por su última parte', () => {
  assert.equal(noteKey('public/11-sesgos/sesgo-de-confirmacion'), 'sesgo-de-confirmacion');
  assert.equal(noteKey('sesgo-de-confirmacion'), 'sesgo-de-confirmacion');
  assert.equal(noteKey('cursos/s123/Forma.md'), 'forma');
  assert.equal(noteKey('/s123/escucha-reducida#concepto'), 'escucha-reducida');
  assert.equal(noteKey('00-inicios/Acusmática'), 'acusmatica');
  assert.equal(noteKey(''), '');
});

test('conceptState sigue la escala del pod', () => {
  assert.equal(conceptState({}), 0);
  assert.equal(conceptState({ read: true }), 1);
  assert.equal(conceptState({ read: true, completed: true }), 2);
  assert.equal(conceptState({ evaluated: true }), 3);
});

const concepts = [
  { id: 'public/a/escucha', slug: 'escucha', completed: true },
  { id: 'public/a/timbre', slug: 'timbre', read: true },
  { id: 'cursos/s123/Forma', slug: 'forma' },
];

test('resolveRoute: la parada actual es la de la nota activa', () => {
  const route = resolveRoute(
    [
      { id: '1', title: 'Escucha', kind: 'concepto', notes: ['escucha'] },
      { id: '2', title: 'Timbre', kind: 'concepto', notes: ['public/a/timbre'] },
      { id: '3', title: 'Forma', kind: 'clase', notes: ['Forma'] },
    ],
    concepts,
    's123/forma',
  );
  assert.equal(route.currentIndex, 2);
  assert.deepEqual(route.stops.map((s) => s.state), ['done', 'upcoming', 'current']);
  assert.equal(route.stops[1].items[0].read, true);
});

test('resolveRoute: sin nota activa en el itinerario, la primera sin terminar', () => {
  const route = resolveRoute(
    [
      { id: '1', title: 'Escucha', kind: 'concepto', notes: ['escucha'] },
      { id: '2', title: 'Timbre', kind: 'concepto', notes: ['timbre'] },
    ],
    concepts,
    'otra-nota',
  );
  assert.equal(route.currentIndex, 1);
  assert.deepEqual(route.stops.map((s) => s.state), ['done', 'current']);
});

test('resolveRoute: una nota que el pod no conoce queda como marcador', () => {
  const route = resolveRoute([{ id: '1', title: 'X', kind: 'clase', notes: ['public/b/nueva-nota'] }], concepts, '');
  assert.equal(route.stops[0].items[0].placeholder, true);
  assert.equal(route.stops[0].items[0].name, 'nueva nota');
});

test('resolveRoute con lista vacía', () => {
  assert.deepEqual(resolveRoute([], concepts, 'x'), { currentIndex: -1, stops: [] });
});

test('visibleStopIndexes: plegado muestra la actual y sus vecinas', () => {
  assert.deepEqual(visibleStopIndexes(5, 2, false), [0, 1, 2, 3, 4]);
  assert.deepEqual(visibleStopIndexes(5, 2, true), [1, 2, 3]);
  assert.deepEqual(visibleStopIndexes(5, 0, true), [0, 1]);
  assert.deepEqual(visibleStopIndexes(5, -1, true), [0, 1, 2, 3, 4]);
});

test('sliceItems: una parada de una nota se parte en sus hypo', () => {
  const all = [
    { id: 'clase' },
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
  ];
  const edges = [
    { source: 'clase', target: 'a', type: 'rel', relType: 'hypo' },
    { source: 'b', target: 'clase', type: 'rel', relType: 'hyper' },
    { source: 'clase', target: 'c', type: 'rel', relType: 'connect' },
    { source: 'clase', target: 'c', type: 'link' },
  ];
  assert.deepEqual(sliceItems([all[0]], all, edges).map((c) => c.id), ['a', 'b']);
  assert.deepEqual(sliceItems([all[2]], all, edges).map((c) => c.id), ['b']);
  assert.deepEqual(sliceItems([all[1], all[2]], all, edges).map((c) => c.id), ['a', 'b']);
});
