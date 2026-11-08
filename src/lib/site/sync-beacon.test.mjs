import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSync } from './sync-beacon.mjs';

const formatTime = (v) => (v ? `t(${v})` : '');
const s123 = { repo: 'musiki/s123', course: 's123', sha: '69ebdfa' };
const i1 = { repo: 'musiki/i1', course: 'i1', sha: 'ae8b1ef' };

test('en curso: materia, hash y fase', () => {
  assert.equal(
    describeSync({ state: 'running', title: 'Building Astro', sources: [s123] }, { formatTime }),
    'Publicando s123 @ 69ebdfa · Building Astro',
  );
});

test('ok: lo publicado, la hora y el commit del framework', () => {
  assert.equal(
    describeSync({ state: 'ok', sources: [i1, s123], lastDeployed: { sources: [i1, s123], at: 'X' } }, { formatTime, frameworkCommit: '1113b18' }),
    'Publicado i1 @ ae8b1ef, s123 @ 69ebdfa · t(X) · framework #1113b18',
  );
});

test('error: qué falló y qué quedó publicado', () => {
  assert.equal(
    describeSync({ state: 'error', sources: [i1], updatedAt: 'Y', lastDeployed: { sources: [s123], at: 'X' } }, { formatTime }),
    'Falló la publicación de i1 @ ae8b1ef · t(Y) · último publicado: s123 @ 69ebdfa (t(X))',
  );
});

test('idle con y sin historia', () => {
  assert.equal(describeSync({ state: 'idle', lastDeployed: { sources: [s123], at: 'X' } }, { formatTime }), 'Último publicado: s123 @ 69ebdfa · t(X)');
  assert.equal(describeSync({ state: 'idle' }, { formatTime }), 'Sincronización sin cambios');
});

test('desconocido o fallback de GitHub sin fuentes: vacío o genérico', () => {
  assert.equal(describeSync({ state: 'unknown' }), '');
  assert.equal(describeSync({ state: 'ok' }, { formatTime }), 'Publicado contenido');
});
