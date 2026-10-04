import assert from 'node:assert/strict';
import test from 'node:test';
import remarkLanguageBlocks from '../plugins/remark-language-blocks.mjs';

const paragraph = (value) => ({
  type: 'paragraph',
  children: [{ type: 'text', value }],
});

const html = (value) => ({ type: 'html', value });

const runPlugin = (children) => {
  const tree = { type: 'root', children: structuredClone(children) };
  remarkLanguageBlocks()(tree);
  return tree.children;
};

test('remarkLanguageBlocks wraps default and alternate language blocks', () => {
  const result = runPlugin([
    paragraph('Base text'),
    html('<!--lang:fr-->'),
    paragraph('Texte français'),
    html('<!--/lang-->'),
  ]);

  assert.equal(result[0].value, '<div class="musiki-i18n-block musiki-i18n-default" data-translation-block="default">');
  assert.equal(result[2].value, '</div>');
  assert.equal(result[3].value, '<div class="musiki-i18n-block" data-translation-block="fr" hidden>');
  assert.equal(result[5].value, '</div>');
});

test('remarkLanguageBlocks keeps leading media outside translated blocks', () => {
  const result = runPlugin([
    html('<figure><img src="/cover.jpg" /></figure>'),
    paragraph('Base text'),
    html('<!--lang:en-->'),
    paragraph('English text'),
    html('<!--/lang-->'),
  ]);

  assert.equal(result[0].value, '<figure><img src="/cover.jpg" /></figure>');
  assert.equal(result[1].value, '<div class="musiki-i18n-block musiki-i18n-default" data-translation-block="default">');
});

test('remarkLanguageBlocks supports language markers split across html lines', () => {
  const result = runPlugin([
    paragraph('Base text'),
    html('<!--lang:fr-->\n<p>Texte HTML</p>\n<!--/lang-->'),
  ]);

  assert.equal(result[3].value, '<div class="musiki-i18n-block" data-translation-block="fr" hidden>');
  assert.equal(result[4].value, '<p>Texte HTML</p>');
});

test('remarkLanguageBlocks keeps the prologue shared with two explicit translations', () => {
  const result = runPlugin([
    paragraph('Shared heading and metadata'),
    html('<!--lang:fr-->'),
    paragraph('Texte français'),
    html('<!--/lang-->'),
    html('<!--lang:en-->'),
    paragraph('English text'),
    html('<!--/lang-->'),
    paragraph('Shared schedule'),
  ]);

  assert.deepEqual(result[0], paragraph('Shared heading and metadata'));
  assert.equal(result[1].value, '<div class="musiki-i18n-block" data-translation-block="fr" hidden>');
  assert.equal(result[4].value, '<div class="musiki-i18n-block" data-translation-block="en" hidden>');
  assert.deepEqual(result.at(-1), paragraph('Shared schedule'));
});

test('remarkLanguageBlocks leaves notes without language blocks untouched', () => {
  const children = [
    paragraph('Plain note'),
    html('<div>raw html</div>'),
    html('<!-- an ordinary comment -->'),
    paragraph('More'),
  ];
  const tree = { type: 'root', children: structuredClone(children) };
  remarkLanguageBlocks()(tree);
  assert.deepEqual(tree.children, children);
});

test('remarkLanguageBlocks ignores an unclosed language block', () => {
  const children = [paragraph('Base'), html('<!--lang:fr-->'), paragraph('Texte')];
  assert.deepEqual(runPlugin(children), children);
});

test('content-language helpers: switcher languages only when blocks exist', async () => {
  const m = await import('./content-language.ts');
  assert.deepEqual(m.getAvailableContentTranslationLanguages({ body: 'no blocks', fallback: 'fr' }), []);
  assert.deepEqual(
    m.getAvailableContentTranslationLanguages({ body: 'x <!--lang:en-->y<!--/lang-->', fallback: 'es' }),
    ['fr', 'en'],
  );
  assert.equal(m.getDefaultContentLanguage({ body: '', fallback: 'es' }), 'en');
  assert.equal(m.getDefaultContentLanguage({ body: '', fallback: 'fr' }), 'fr');
  assert.equal(m.getDefaultContentLanguage({ body: '', data: { lang: 'en' }, fallback: 'fr' }), 'en');
});

// Runs the switcher's client script against a minimal fake DOM.
const runSwitcherScript = async ({ withSwitcher }) => {
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const source = fs.readFileSync(new URL('../components/ContentLanguageSwitcher.astro', import.meta.url), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const listeners = {};
  const on = (target) => (type, fn) => { (listeners[`${target}:${type}`] ||= []).push(fn); };
  const switcher = { getAttribute: (name) => (name === 'data-default-lang' ? 'fr' : null) };
  const documentElement = { dataset: {}, lang: 'es' };
  const document = {
    documentElement,
    querySelector: (sel) => (withSwitcher && sel === '[data-content-language-switcher]' ? switcher : null),
    querySelectorAll: () => [],
    addEventListener: on('document'),
  };
  const window = {
    location: { search: '', href: 'https://musiki.org.ar/curso/x#a' },
    localStorage: { getItem: () => null, setItem: () => {} },
    history: { pushState: () => {} },
    addEventListener: on('window'),
  };
  vm.runInNewContext(script, { window, document, URLSearchParams, URL, Element: class {}, HTMLElement: class {} });
  return { documentElement, fire: (type) => (listeners[`window:${type}`] || []).forEach((fn) => fn()) };
};

test('content language switcher: popstate is inert on pages without a switcher', async () => {
  const page = await runSwitcherScript({ withSwitcher: false });
  page.fire('popstate');
  assert.equal(page.documentElement.lang, 'es');
  assert.equal(page.documentElement.dataset.contentLang, undefined);
});

test('content language switcher: popstate re-applies the language when a switcher exists', async () => {
  const page = await runSwitcherScript({ withSwitcher: true });
  page.documentElement.lang = 'es';
  page.fire('popstate');
  assert.equal(page.documentElement.lang, 'fr');
});
