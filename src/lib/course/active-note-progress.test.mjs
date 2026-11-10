import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeActiveNote } from './active-note-progress.mjs';

test('nota sin evaluaciones', () => {
  assert.deepEqual(summarizeActiveNote([]), { evals: [], done: 0, reading: null, rubricKeys: [] });
});

test('cada evaluación dice a qué requisito cuenta, y los requisitos salen en orden de rúbrica', () => {
  const s = summarizeActiveNote([
    { id: 'a', label: 'Aporte', type: 'essay_ai' },
    { id: 'b', label: 'Conexión', type: 'conexion', complete: true },
    { id: 'c', label: 'MCQ', type: 'mcq' },
  ]);
  assert.deepEqual(s.evals.map((e) => e.rubricKey), ['aporte', 'conexiones', '']);
  assert.deepEqual(s.rubricKeys, ['conexiones', 'aporte']);
  assert.equal(s.done, 1);
});

test('lectura (mcc) aparte', () => {
  const s = summarizeActiveNote([
    { id: 'm1', type: 'mcc', complete: true },
    { id: 'm2', type: 'mcc' },
  ]);
  assert.deepEqual(s.reading, { done: 1, total: 2 });
});

test('ignora entradas sin id', () => {
  assert.equal(summarizeActiveNote([null, { label: 'x' }]).evals.length, 0);
});
