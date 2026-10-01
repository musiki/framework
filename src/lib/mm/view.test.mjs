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
  assert.equal(conceptPath('pharmakon'), '/pharmakon');
  assert.equal(conceptPath('tertiary-retention'), '/tertiary-retention');
  // reserved words and non-canonical legacy slugs keep /c/<slug>
  assert.equal(conceptPath('graph'), '/c/graph');
  assert.equal(conceptPath('concepts'), '/c/concepts');
  assert.equal(conceptPath('Odd'), '/c/Odd');
});

test('display names', () => {
  assert.equal(displayName({ name: 'Ada', deleted: false }, 'Former member'), 'Ada');
  assert.equal(displayName({ name: null, deleted: true }, 'Former member'), 'Former member');
  assert.equal(displayName({ name: '  ', deleted: false }, 'Someone'), 'Someone');
  assert.equal(displayName(null, 'Someone'), 'Someone');
  // living user without a usable name: "Member", not "Former member"
  assert.equal(displayName({ name: null, deleted: false }, 'Former member', 'Member'), 'Member');
  assert.equal(displayName({ name: ' ', deleted: false }, 'Former member', 'Member'), 'Member');
  assert.equal(displayName({ name: 'ada@uni.no', deleted: false }, 'Former member', 'Member'), 'Member');
  assert.equal(displayName({ name: 'Ada', deleted: true }, 'Former member', 'Member'), 'Former member');
});

test('publicName never returns something that looks like an e-mail', async () => {
  const { publicName } = await import('./view.ts');
  assert.equal(publicName(' Ada Lovelace '), 'Ada Lovelace');
  assert.equal(publicName('ada@uni.no'), null);
  assert.equal(publicName('Ada (ada@uni.no)'), null);
  assert.equal(publicName(''), null);
  assert.equal(publicName(null), null);
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

test('channel paths: group, channel, group-level and channel threads; encoded', async () => {
  const { boardPath, boardThreadPath, boardMatchesPath, forumCrumbs } = await import('./view.ts');
  assert.equal(forumPath('stiegler'), '/f/stiegler');
  assert.equal(forumPath('stiegler', 'welcome'), '/f/stiegler/welcome');
  assert.equal(threadPath('stiegler', 'abc'), '/f/stiegler/t/abc');
  assert.equal(threadPath('stiegler', 'abc', 'technics-and-time'), '/f/stiegler/technics-and-time/t/abc');
  assert.equal(forumPath('a b', 'c/d'), '/f/a%20b/c%2Fd');
  const group = { slug: 'stiegler', title: 'Stiegler', parent: null };
  const channel = { slug: 'welcome', title: 'Welcome', parent: { slug: 'stiegler', title: 'Stiegler' } };
  assert.equal(boardPath(group), '/f/stiegler');
  assert.equal(boardPath(channel), '/f/stiegler/welcome');
  assert.equal(boardThreadPath(group, 't1'), '/f/stiegler/t/t1');
  assert.equal(boardThreadPath(channel, 't1'), '/f/stiegler/welcome/t/t1');

  assert.equal(boardMatchesPath(group, 'stiegler'), true);
  assert.equal(boardMatchesPath(channel, 'stiegler', 'welcome'), true);
  // mismatches: group URL for a channel thread, channel URL for a group thread, wrong group/channel
  assert.equal(boardMatchesPath(channel, 'stiegler'), false);
  assert.equal(boardMatchesPath(channel, 'welcome'), false);
  assert.equal(boardMatchesPath(group, 'stiegler', 'welcome'), false);
  assert.equal(boardMatchesPath(channel, 'other', 'welcome'), false);
  assert.equal(boardMatchesPath(channel, 'stiegler', 'technics'), false);
  assert.equal(boardMatchesPath(null, 'stiegler'), false);

  assert.deepEqual(forumCrumbs(channel, 'Session 1'), [
    { label: 'Stiegler', href: '/f/stiegler' },
    { label: 'Welcome', href: '/f/stiegler/welcome' },
    { label: 'Session 1', href: null },
  ]);
  assert.deepEqual(forumCrumbs(channel), [{ label: 'Stiegler', href: '/f/stiegler' }, { label: 'Welcome', href: null }]);
  assert.deepEqual(forumCrumbs(group, 'T'), [{ label: 'Stiegler', href: '/f/stiegler' }, { label: 'T', href: null }]);
});

test('definitionExcerpt: plain text from markdown (no fences, math delimiters, links or HTML), capped', async () => {
  const { definitionExcerpt } = await import('./view.ts');
  const md = "# Title\n\nThe **weight** matrix $\\mathbf{W}$ maps [inputs](https://x.test) to _outputs_ <b>x</b>.\n\n```lily\n{ c'4 }\n```\n\n$$\na^2\n$$\n\n- see [[Other|other concept]]";
  const out = definitionExcerpt(md, 200);
  assert.equal(out, 'Title The weight matrix \\mathbf{W} maps inputs to outputs x . a^2 see other concept');
  assert.ok(!/[<>$`]|https?:|c'4/.test(out), out);
  const long = definitionExcerpt('word '.repeat(80), 50);
  assert.ok(long.length <= 50 && long.endsWith('…'), long);
  assert.equal(definitionExcerpt(null), '');
});
