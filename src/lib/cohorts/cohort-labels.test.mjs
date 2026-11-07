import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { suggestCohortLabel, normalizeCohortInput, TERMS } from './cohort-labels.mjs';

describe('suggestCohortLabel', () => {
  test('una materia anual es sólo el año', () => {
    assert.equal(suggestCohortLabel({ year: 2027 }), '2027');
    assert.equal(suggestCohortLabel({ year: 2027, term: 'anual' }), '2027');
  });

  test('el cuatrimestre se escribe en castellano', () => {
    assert.equal(suggestCohortLabel({ year: 2027, term: '2c' }), '2027 · 2do cuatrimestre');
    assert.equal(suggestCohortLabel({ year: 2027, term: '1c' }), '2027 · 1er cuatrimestre');
  });

  test('la comisión numérica se expande, el texto libre se respeta', () => {
    assert.equal(suggestCohortLabel({ year: 2027, comision: '2' }), '2027 · Comisión 2');
    assert.equal(suggestCohortLabel({ year: 2027, comision: 'turno noche' }), '2027 · turno noche');
  });

  test('cuatrimestre y comisión conviven', () => {
    assert.equal(
      suggestCohortLabel({ year: 2027, term: '1c', comision: '2' }),
      '2027 · 1er cuatrimestre · Comisión 2',
    );
  });

  test('sin año usa el actual', () => {
    assert.equal(suggestCohortLabel({}), String(new Date().getFullYear()));
  });
});

describe('normalizeCohortInput', () => {
  test('exige courseId', () => {
    const r = normalizeCohortInput({ year: 2027 });
    assert.equal(r.ok, false);
    assert.match(r.error, /courseId/);
  });

  test('rechaza un período que no existe', () => {
    const r = normalizeCohortInput({ courseId: 's123', term: 'trimestre' });
    assert.equal(r.ok, false);
    assert.match(r.error, /Per[ií]odo inv[áa]lido/);
  });

  test('rechaza años fuera de rango', () => {
    assert.equal(normalizeCohortInput({ courseId: 's123', year: 1821 }).ok, false);
    assert.equal(normalizeCohortInput({ courseId: 's123', year: 3000 }).ok, false);
    assert.equal(normalizeCohortInput({ courseId: 's123', year: 2027 }).ok, true);
  });

  test('arma la etiqueta sola si no se la pasan', () => {
    const r = normalizeCohortInput({ courseId: 's123', year: 2027, term: '2c' });
    assert.equal(r.ok, true);
    assert.equal(r.value.label, '2027 · 2do cuatrimestre');
  });

  test('respeta la etiqueta explícita', () => {
    const r = normalizeCohortInput({ courseId: 's123', year: 2027, label: 'Piloto docentes' });
    assert.equal(r.value.label, 'Piloto docentes');
  });

  test('por defecto activa la cohorte y arrastra docentes, no estudiantes', () => {
    const r = normalizeCohortInput({ courseId: 's123', year: 2027 });
    assert.equal(r.value.activate, true);
    assert.equal(r.value.copyTeachers, true);
  });

  test('se puede crear una cohorte inactiva para prepararla antes', () => {
    const r = normalizeCohortInput({ courseId: 's123', year: 2027, activate: false });
    assert.equal(r.value.activate, false);
  });

  test('TERMS es la lista que la UI ofrece', () => {
    assert.deepEqual(TERMS, ['anual', '1c', '2c', 'verano']);
  });
});
