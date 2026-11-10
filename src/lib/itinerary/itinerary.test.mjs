import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ITINERARY_KINDS,
  MAX_STOPS,
  kindForNoteType,
  normalizeStops,
  reservoirOf,
  slugKey,
  stopFromNote,
} from './itinerary.mjs';

test('los cinco kinds del plan, en orden', () => {
  assert.deepEqual(ITINERARY_KINDS.map((k) => k.id), ['concepto', 'protocolo', 'clase', 'assignment', 'output']);
});

test('kindForNoteType agrupa los types y deja afuera los recursos', () => {
  assert.equal(kindForNoteType('concept'), 'concepto');
  assert.equal(kindForNoteType(' Glossary '), 'concepto');
  assert.equal(kindForNoteType('lesson'), 'clase');
  assert.equal(kindForNoteType('obra'), 'output');
  assert.equal(kindForNoteType('person'), '');
  assert.equal(kindForNoteType(undefined), '');
});

test('normalizeStops limpia y conserva el orden', () => {
  const r = normalizeStops([
    { id: 'a1', title: '  Escucha   reducida ', kind: 'concepto', notes: ['/s123/escucha.md', 's123/escucha', ''] },
    { id: 'a2', title: 'Entrega 1', kind: 'assignment', notes: [] },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.stops, [
    { id: 'a1', title: 'Escucha reducida', kind: 'concepto', notes: ['s123/escucha'] },
    { id: 'a2', title: 'Entrega 1', kind: 'assignment', notes: [] },
  ]);
});

test('normalizeStops rechaza lo que no se puede arreglar', () => {
  assert.equal(normalizeStops('x').ok, false);
  assert.equal(normalizeStops([{ title: '', kind: 'clase' }]).ok, false);
  assert.equal(normalizeStops([{ title: 'A', kind: 'otro' }]).ok, false);
  assert.equal(normalizeStops([{ title: 'x'.repeat(121), kind: 'clase' }]).ok, false);
  assert.equal(normalizeStops(Array.from({ length: MAX_STOPS + 1 }, () => ({ title: 'A', kind: 'clase' }))).ok, false);
});

test('normalizeStops da id nuevo a los repetidos o inválidos', () => {
  const r = normalizeStops([
    { id: 'a', title: 'A', kind: 'clase' },
    { id: 'a', title: 'B', kind: 'clase' },
    { id: 'con espacio', title: 'C', kind: 'clase' },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.stops[0].id, 'a');
  assert.equal(new Set(r.stops.map((s) => s.id)).size, 3);
  assert.match(r.stops[2].id, /^[a-z0-9]+$/);
});

test('slugKey compara sin la materia adelante', () => {
  assert.equal(slugKey('s123/Escucha', 's123'), 'escucha');
  assert.equal(slugKey('escucha', 's123'), 'escucha');
  assert.equal(slugKey('/i1/escucha.md', 's123'), 'i1/escucha');
});

test('reservoirOf es el complemento del itinerario', () => {
  const notes = [{ slug: 'escucha' }, { slug: 's123/timbre' }, { slug: 'forma' }];
  const stops = [{ notes: ['s123/escucha'] }, { notes: ['timbre'] }];
  assert.deepEqual(reservoirOf(notes, stops, 's123').map((n) => n.slug), ['forma']);
  assert.equal(reservoirOf(notes, [], 's123').length, 3);
});

test('stopFromNote toma título y kind de la nota', () => {
  const s = stopFromNote({ slug: 'sesgo-de-confirmacion', title: 'Sesgo de confirmación', type: 'concept' });
  assert.equal(s.title, 'Sesgo de confirmación');
  assert.equal(s.kind, 'concepto');
  assert.deepEqual(s.notes, ['sesgo-de-confirmacion']);
  assert.equal(stopFromNote({ slug: 'x', type: 'person' }).kind, 'clase');
});

test('normalizeStops: bifurcaciones con ramas, sin anidar y cerradas', () => {
  const ok = normalizeStops([
    { title: 'Elegí', kind: 'bifurcacion', notes: ['x'] },
    { title: 'A1', kind: 'concepto', notes: [], branch: 'B' },
    { title: 'A2', kind: 'concepto', notes: [], branch: 'Z' },
    { title: 'Tronco', kind: 'union' },
    { title: 'Afuera', kind: 'clase', branch: 'A' },
  ]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.stops.map((s) => [s.kind, s.branch, s.notes.length]), [
    ['bifurcacion', undefined, 0], ['concepto', 'B', 0], ['concepto', 'A', 0], ['union', undefined, 0], ['clase', undefined, 0],
  ]);
  assert.equal(normalizeStops([{ title: 'a', kind: 'bifurcacion' }]).ok, false);
  assert.equal(normalizeStops([{ title: 'a', kind: 'union' }]).ok, false);
  assert.equal(normalizeStops([{ title: 'a', kind: 'bifurcacion' }, { title: 'b', kind: 'bifurcacion' }]).ok, false);
});
