import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLegacyDynamics, buildLocalLilypondSourceAttempts } from '../lilypond-support.mjs';

test('define \\sffz después de \\version cuando la partitura lo usa', () => {
  const out = withLegacyDynamics('\\version "2.24.0"\n{ c4\\sffz d }');
  assert.equal(out, '\\version "2.24.0"\nsffz = #(make-dynamic-script "sffz")\n{ c4\\sffz d }');
});

test('sin \\version, la definición va arriba', () => {
  assert.match(withLegacyDynamics('{ c4\\sfff }'), /^sfff = #\(make-dynamic-script "sfff"\)\n/);
});

test('no toca partituras que no las usan, ni confunde \\sfz o \\sff', () => {
  const src = '{ c4\\sfz d\\sff e\\sffzz }';
  assert.equal(withLegacyDynamics(src), src);
});

test('si la partitura ya la define, no la redefine', () => {
  const src = 'sffz = #(make-dynamic-script "sffz")\n{ c4\\sffz }';
  assert.equal(withLegacyDynamics(src), src);
});

test('el intento principal de render lleva la definición', () => {
  const [primary] = buildLocalLilypondSourceAttempts('\\score { \\new Staff { c4\\sffz } }');
  assert.match(primary, /sffz = #\(make-dynamic-script "sffz"\)/);
});
