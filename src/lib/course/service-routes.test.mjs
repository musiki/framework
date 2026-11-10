import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchServiceRoute, serviceForConceptSlug, noteLinkHref } from './service-routes.mjs';

test('matchServiceRoute: las rutas de siempre del servicio siguen siendo del servicio', () => {
  for (const s of ['amigxcriticx', 'amigx-criticx', 'amigo-critico', '85-amigx-criticx', 'AMIGX-CRITICX']) {
    assert.equal(matchServiceRoute(s, 's123')?.service.id, 'amigxcriticx', s);
  }
  assert.equal(matchServiceRoute('amigx-criticx')?.service.id, 'amigxcriticx', 'sin materia: primer nivel');
});

test('matchServiceRoute: vistas', () => {
  assert.equal(matchServiceRoute('amigo-critico-devoluciones', 's123')?.view, 'devoluciones');
  assert.equal(matchServiceRoute('amigxcriticx-dashboard', 's123')?.view, 'dashboard');
  assert.equal(matchServiceRoute('amigx-criticx', 's123')?.view, '');
});

test('matchServiceRoute: otra materia u otra nota no son el servicio', () => {
  assert.equal(matchServiceRoute('amigx-criticx', 'i1'), null);
  assert.equal(matchServiceRoute('practica-reflexiva', 's123'), null);
  assert.equal(matchServiceRoute('', 's123'), null);
});

test('la nota de concepto con el slug del servicio va plegada en #concepto', () => {
  assert.equal(serviceForConceptSlug('amigx-criticx')?.id, 'amigxcriticx');
  assert.equal(serviceForConceptSlug('amigo-critico'), null, 'el alias viejo no es la nota');
  assert.equal(noteLinkHref('amigx-criticx'), '/amigx-criticx#concepto');
  assert.equal(noteLinkHref('practica-reflexiva'), '/practica-reflexiva');
});
