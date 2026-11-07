import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_TYPES, NOTE_STATUSES, NOTE_FIELDS,
  fieldsFor, optionsFor, toControlValue, fromControlValue, applyEdits,
} from './note-metadata-schema.mjs';

const campo = (name) => NOTE_FIELDS.find((f) => f.name === name);

describe('optionsFor · el bug que convertía concept en lesson', () => {
  test('el valor actual entra en la lista aunque el esquema no lo conozca', () => {
    const opts = optionsFor({ options: ['lesson', 'info'] }, 'concept');
    assert.ok(opts.includes('concept'), 'el valor actual tiene que estar');
  });

  test('no duplica el valor actual si ya estaba', () => {
    const opts = optionsFor({ options: ['lesson', 'concept'] }, 'concept');
    assert.equal(opts.filter((o) => o === 'concept').length, 1);
  });

  test('los tipos y estados reales del vault están contemplados', () => {
    for (const t of ['concept', 'glossary', 'lesson', 'info']) {
      assert.ok(NOTE_TYPES.includes(t), t);
    }
    for (const s of ['draft', 'published', 'public', 'inprocess', 'nonshown']) {
      assert.ok(NOTE_STATUSES.includes(s), s);
    }
  });

  test('un valor vacío no agrega una opción fantasma', () => {
    assert.deepEqual(optionsFor({ options: ['a', 'b'] }, ''), ['a', 'b']);
  });
});

describe('fieldsFor', () => {
  test('un concepto muestra la sinopsis y las relaciones', () => {
    const nombres = fieldsFor('concept').map((f) => f.name);
    for (const n of ['def', 'hyper', 'hypo', 'connect', 'alias']) {
      assert.ok(nombres.includes(n), n);
    }
  });

  test('una clase no muestra sinopsis ni relaciones, pero sí tema', () => {
    const nombres = fieldsFor('lesson').map((f) => f.name);
    assert.ok(!nombres.includes('def'));
    assert.ok(!nombres.includes('hypo'));
    assert.ok(nombres.includes('theme'));
  });

  test('los campos comunes están siempre', () => {
    for (const tipo of ['concept', 'lesson', 'info', 'cualquier-cosa']) {
      const nombres = fieldsFor(tipo).map((f) => f.name);
      for (const n of ['type', 'status', 'chapter', 'order', 'tags', 'slug']) {
        assert.ok(nombres.includes(n), `${tipo} → ${n}`);
      }
    }
  });
});

describe('ida y vuelta entre control y frontmatter', () => {
  test('listas: array ↔ texto separado por comas', () => {
    assert.equal(toControlValue(campo('tags'), ['a', 'b']), 'a, b');
    assert.deepEqual(fromControlValue(campo('tags'), 'a, b , c'), ['a', 'b', 'c']);
    assert.deepEqual(fromControlValue(campo('tags'), '   '), []);
  });

  test('links: se muestran sin corchetes y se guardan con corchetes', () => {
    assert.equal(toControlValue(campo('hypo'), ['[[a]]', '[[b]]']), '[[a]], [[b]]');
    assert.deepEqual(fromControlValue(campo('hypo'), 'a, b'), ['[[a]]', '[[b]]']);
    // y si el docente los escribe con corchetes, no se duplican
    assert.deepEqual(fromControlValue(campo('hypo'), '[[a]], [[b]]'), ['[[a]]', '[[b]]']);
  });

  test('un valor suelto que no era array se tolera', () => {
    assert.equal(toControlValue(campo('tags'), 'solo-uno'), 'solo-uno');
  });

  test('number no devuelve NaN', () => {
    assert.equal(fromControlValue(campo('order'), ''), 0);
    assert.equal(fromControlValue(campo('order'), 'siete'), 0);
    assert.equal(fromControlValue(campo('order'), '7'), 7);
  });
});

describe('applyEdits', () => {
  test('no toca los campos que el formulario no mostró', () => {
    const actual = { type: 'concept', def: 'una sinopsis', project: 's123', coverImage: 'x.png' };
    const salida = applyEdits(actual, { type: 'glossary' }, [campo('type')]);
    assert.equal(salida.type, 'glossary');
    assert.equal(salida.def, 'una sinopsis');
    assert.equal(salida.project, 's123');
    assert.equal(salida.coverImage, 'x.png');
  });

  test('un campo vaciado se borra, no se guarda como cadena vacía', () => {
    const salida = applyEdits({ alias: 'viejo' }, { alias: '  ' }, [campo('alias')]);
    assert.ok(!('alias' in salida));
  });

  test('una relación vaciada se borra', () => {
    const salida = applyEdits({ hypo: ['[[a]]'] }, { hypo: '' }, [campo('hypo')]);
    assert.ok(!('hypo' in salida));
  });

  test('guardar un concepto sin tocar nada no cambia su tipo', () => {
    const actual = { type: 'concept', status: 'public', def: 'x' };
    const visibles = fieldsFor('concept');
    const edits = {};
    for (const f of visibles) edits[f.name] = toControlValue(f, actual[f.name]);
    const salida = applyEdits(actual, edits, visibles);
    assert.equal(salida.type, 'concept', 'no puede degradarse a lesson');
    assert.equal(salida.status, 'public', 'no puede degradarse a draft');
    assert.equal(salida.def, 'x');
  });
});
