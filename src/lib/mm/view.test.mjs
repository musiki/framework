import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickDefinition, conceptLabel, groupByDay, dayKey, conceptThreadRedirect, safeHttpUrl, formatDate, forumPath, threadPath, conceptPath, displayName,
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
  assert.equal(forumPath('stiegler'), '/stiegler');
  assert.equal(threadPath('stiegler', '0b7c'), '/stiegler/t/0b7c');
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
  assert.equal(forumPath('stiegler'), '/stiegler');
  assert.equal(forumPath('stiegler', 'welcome'), '/stiegler/welcome');
  assert.equal(threadPath('stiegler', 'abc'), '/stiegler/t/abc');
  assert.equal(threadPath('stiegler', 'abc', 'technics-and-time'), '/stiegler/technics-and-time/t/abc');
  // slugs that cannot live at the root keep /f/ (reserved group, odd spelling, reserved channel "t")
  assert.equal(forumPath('a b', 'c/d'), '/f/a%20b/c%2Fd');
  assert.equal(forumPath('help'), '/f/help');
  assert.equal(forumPath('help', 'x'), '/f/help/x');
  assert.equal(forumPath('stiegler', 't'), '/f/stiegler/t');
  assert.equal(forumPath('stiegler', 'A b'), '/f/stiegler/A%20b');
  assert.equal(threadPath('graph', 'abc'), '/f/graph/t/abc');
  assert.equal(forumPath('stiegler', 'graph'), '/stiegler/graph');
  const group = { slug: 'stiegler', title: 'Stiegler', parent: null };
  const channel = { slug: 'welcome', title: 'Welcome', parent: { slug: 'stiegler', title: 'Stiegler' } };
  assert.equal(boardPath(group), '/stiegler');
  assert.equal(boardPath(channel), '/stiegler/welcome');
  assert.equal(boardThreadPath(group, 't1'), '/stiegler/t/t1');
  assert.equal(boardThreadPath(channel, 't1'), '/stiegler/welcome/t/t1');

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
    { label: 'Stiegler', href: '/stiegler' },
    { label: 'Welcome', href: '/stiegler/welcome' },
    { label: 'Session 1', href: null },
  ]);
  assert.deepEqual(forumCrumbs(channel), [{ label: 'Stiegler', href: '/stiegler' }, { label: 'Welcome', href: null }]);
  assert.deepEqual(forumCrumbs(group, 'T'), [{ label: 'Stiegler', href: '/stiegler' }, { label: 'T', href: null }]);
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

test('groupByDay: consecutive versions of the same UTC day share a group, order kept', () => {
  const v = (id, createdAt) => ({ id, createdAt });
  const groups = groupByDay([
    v('c', '2026-09-30T23:30:00Z'), v('b', '2026-09-30T08:00:00Z'), v('a', '2026-09-29T10:00:00Z'),
  ], 'en');
  assert.deepEqual(groups.map((g) => [g.day, g.items.map((x) => x.id)]), [['2026-09-30', ['c', 'b']], ['2026-09-29', ['a']]]);
  assert.equal(groups[0].label, '30 Sept 2026'.replace('Sept', new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date('2026-09-30'))));
  assert.deepEqual(groupByDay([], 'nb'), []);
  assert.equal(dayKey('nope'), '');
  assert.equal(dayKey(null), '');
});

test('threadRedirect: any item page (e.g. a relation type) + query kept + from=thread', async () => {
  const { threadRedirect } = await import('./view.ts');
  assert.equal(threadRedirect('/r/contains'), '/r/contains?from=thread');
  assert.equal(threadRedirect('/r/contains', '?lang=nb&threads=type'), '/r/contains?lang=nb&threads=type&from=thread');
  assert.doesNotMatch(threadRedirect('/r/a', '?q=%23x'), /#/);
});

test('conceptThreadRedirect: permalink + query kept + from=thread, never a fragment', () => {
  assert.equal(conceptThreadRedirect('pharmakon'), '/pharmakon?from=thread');
  assert.equal(conceptThreadRedirect('pharmakon', '?lang=nb'), '/pharmakon?lang=nb&from=thread');
  assert.equal(conceptThreadRedirect('pharmakon', '?from=x&lang=en'), '/pharmakon?from=thread&lang=en');
  assert.equal(conceptThreadRedirect('graph'), '/c/graph?from=thread');
  assert.doesNotMatch(conceptThreadRedirect('a-b', '?q=%23x'), /#/);
});

test('legacyForumRedirect: root canonical paths with the query kept; /f/ canonical paths stay', async () => {
  const { legacyForumRedirect, forumPath, threadPath } = await import('./view.ts');
  assert.equal(legacyForumRedirect(forumPath('stiegler')), '/stiegler');
  assert.equal(legacyForumRedirect(forumPath('stiegler', 'tt1'), '?lang=nb&threads=type'), '/stiegler/tt1?lang=nb&threads=type');
  assert.equal(legacyForumRedirect(threadPath('stiegler', 'abc'), '?'), '/stiegler/t/abc');
  assert.equal(legacyForumRedirect(forumPath('help')), null);
  assert.equal(legacyForumRedirect(forumPath('stiegler', 't')), null);
  assert.doesNotMatch(legacyForumRedirect('/stiegler', '?q=%23x'), /#/);
});

test('root board paths built by view.ts have the router\'s root shapes', async () => {
  const { forumPath, threadPath } = await import('./view.ts');
  const { parseRootPath } = await import('./slugs.ts');
  const T = '0b7c1a2e-3f4d-4a5b-8c6d-7e8f9a0b1c2d';
  assert.equal(parseRootPath(forumPath('stiegler'))?.kind, 'slug');
  assert.equal(parseRootPath(forumPath('stiegler', 'tt1'))?.kind, 'board');
  assert.equal(parseRootPath(threadPath('stiegler', T))?.kind, 'thread');
  assert.equal(parseRootPath(threadPath('stiegler', T, 'tt1'))?.kind, 'thread');
});
