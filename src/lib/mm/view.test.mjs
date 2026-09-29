import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickDefinition, conceptLabel, safeHttpUrl, formatDate, forumPath, threadPath, conceptPath, displayName,
} from './view.ts';

const en = { lang: 'en', definition: 'English text' };
const nb = { lang: 'nb', definition: 'Bokmål tekst' };
const nn = { lang: 'nn', definition: 'Nynorsk tekst' };

test('English reader sees English; Bokmål offered when it exists', () => {
  assert.deepEqual(pickDefinition({ en }, 'en'), { version: en, lang: 'en', missingTranslation: false, alternate: null });
  assert.deepEqual(pickDefinition({ en, nb }, 'en'), { version: en, lang: 'en', missingTranslation: false, alternate: 'nb' });
});

test('Bokmål reader sees Bokmål, or English with a visible missing-translation state (never machine-filled)', () => {
  assert.deepEqual(pickDefinition({ en, nb }, 'nb'), { version: nb, lang: 'nb', missingTranslation: false, alternate: 'en' });
  const missing = pickDefinition({ en }, 'nb');
  assert.equal(missing.version, en);
  assert.equal(missing.lang, 'en');
  assert.equal(missing.missingTranslation, true);
  assert.equal(missing.alternate, null);
});

test('Nynorsk falls back to Bokmål (policy, not "missing"), then English', () => {
  assert.equal(pickDefinition({ en, nb, nn }, 'nn').version, nn);
  const viaNb = pickDefinition({ en, nb }, 'nn');
  assert.equal(viaNb.version, nb);
  assert.equal(viaNb.missingTranslation, false);
  const viaEn = pickDefinition({ en }, 'nn');
  assert.equal(viaEn.version, en);
  assert.equal(viaEn.missingTranslation, true);
});

test('no definition at all', () => {
  assert.deepEqual(pickDefinition({}, 'nb'), { version: null, lang: null, missingTranslation: false, alternate: null });
});

test('concept label: Bokmål label only when present and non-blank', () => {
  assert.deepEqual(conceptLabel({ label: 'Care', labelNb: 'Omsorg' }, 'nb'), { text: 'Omsorg', lang: 'nb' });
  assert.deepEqual(conceptLabel({ label: 'Care', labelNb: 'Omsorg' }, 'nn'), { text: 'Omsorg', lang: 'nb' });
  assert.deepEqual(conceptLabel({ label: 'Care', labelNb: '  ' }, 'nb'), { text: 'Care', lang: 'en' });
  assert.deepEqual(conceptLabel({ label: 'Care', labelNb: 'Omsorg' }, 'en'), { text: 'Care', lang: 'en' });
});

test('source links: only absolute http(s)', () => {
  assert.equal(safeHttpUrl('https://example.org/a?b=1'), 'https://example.org/a?b=1');
  assert.equal(safeHttpUrl(' http://example.org '), 'http://example.org/');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/local', '//evil.example', 'ftp://x', '', null, 42]) {
    assert.equal(safeHttpUrl(bad), null, String(bad));
  }
});

test('dates', () => {
  assert.match(formatDate('2026-09-29T10:00:00Z', 'en'), /^29 \S+ 2026$/);
  assert.match(formatDate('2026-09-29T10:00:00Z', 'nb'), /29/);
  assert.equal(formatDate(null, 'en'), '');
  assert.equal(formatDate('nope', 'en'), '');
});

test('paths are encoded', () => {
  assert.equal(forumPath('stiegler'), '/f/stiegler');
  assert.equal(threadPath('stiegler', '0b7c'), '/f/stiegler/t/0b7c');
  assert.equal(conceptPath('café'), '/c/caf%C3%A9');
  assert.equal(conceptPath('a/b'), '/c/a%2Fb');
});

test('display names', () => {
  assert.equal(displayName({ name: 'Ada', deleted: false }, 'Former member'), 'Ada');
  assert.equal(displayName({ name: null, deleted: true }, 'Former member'), 'Former member');
  assert.equal(displayName({ name: '  ', deleted: false }, 'Someone'), 'Someone');
  assert.equal(displayName(null, 'Someone'), 'Someone');
});

test('page error state: domain 404 → notFound, anything else → unavailable', async () => {
  const { pageErrorState } = await import('./view.ts');
  const domain = (name, status) => Object.assign(new Error('x'), { name, status });
  assert.equal(pageErrorState(domain('ForumError', 404)), 'notFound');
  assert.equal(pageErrorState(domain('ConceptError', 404)), 'notFound');
  assert.equal(pageErrorState(domain('ForumError', 403)), 'unavailable');
  assert.equal(pageErrorState(domain('Error', 404)), 'unavailable');
  assert.equal(pageErrorState(new Error('ECONNREFUSED')), 'unavailable');
  assert.equal(pageErrorState(null), 'unavailable');
});
