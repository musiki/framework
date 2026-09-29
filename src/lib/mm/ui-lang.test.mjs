import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMmLang,
  langFromAcceptLanguage,
  langSwitchHref,
  normalizeMmLang,
  resolveMmLang,
} from './ui-lang.ts';

test('normalizeMmLang: nynorsk and generic Norwegian fall back to Bokmål', () => {
  assert.equal(normalizeMmLang('en'), 'en');
  assert.equal(normalizeMmLang('en-GB'), 'en');
  assert.equal(normalizeMmLang('nb'), 'nb');
  assert.equal(normalizeMmLang('nn'), 'nb');
  assert.equal(normalizeMmLang('no'), 'nb');
  assert.equal(normalizeMmLang('NB_no'), 'nb');
  assert.equal(normalizeMmLang('es'), null);
  assert.equal(normalizeMmLang(''), null);
  assert.equal(normalizeMmLang(undefined), null);
});

test('langFromAcceptLanguage honours q order', () => {
  assert.equal(langFromAcceptLanguage('nn-NO,nn;q=0.9,en;q=0.8'), 'nb');
  assert.equal(langFromAcceptLanguage('de;q=0.9,en;q=0.5,nb;q=0.7'), 'nb');
  assert.equal(langFromAcceptLanguage('fr,de'), null);
  assert.equal(langFromAcceptLanguage('nb;q=0,en'), 'en');
  assert.equal(langFromAcceptLanguage(null), null);
});

test('resolveMmLang: query > cookie > Accept-Language > en', () => {
  assert.deepEqual(resolveMmLang({ query: 'nb', cookie: 'en' }), { lang: 'nb', persist: true });
  assert.deepEqual(resolveMmLang({ query: 'xx', cookie: 'nb' }), { lang: 'nb', persist: false });
  assert.deepEqual(resolveMmLang({ cookie: 'garbage', acceptLanguage: 'nb' }), { lang: 'nb', persist: false });
  assert.deepEqual(resolveMmLang({}), { lang: 'en', persist: false });
});

function fakeAstro(url, { cookie, headers = {} } = {}) {
  const set = [];
  const responseHeaders = new Headers();
  return {
    set,
    astro: {
      url: new URL(url),
      request: new Request(url, { headers }),
      cookies: {
        get: (name) => (name === 'mm-lang' && cookie ? { value: cookie } : undefined),
        set: (name, value, options) => set.push({ name, value, options }),
      },
      response: { headers: responseHeaders },
    },
  };
}

test('applyMmLang persists an explicit choice in mm-lang only', () => {
  const { astro, set } = fakeAstro('http://mm.zztt.org/about?lang=nn', { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(applyMmLang(astro), 'nb');
  assert.equal(set.length, 1);
  assert.equal(set[0].name, 'mm-lang');
  assert.equal(set[0].value, 'nb');
  assert.equal(set[0].options.path, '/');
  assert.equal(set[0].options.secure, true);
  assert.match(astro.response.headers.get('vary'), /Cookie/);
});

test('applyMmLang reads the cookie without setting one', () => {
  const { astro, set } = fakeAstro('http://mm.zztt.org/', { cookie: 'nb' });
  assert.equal(applyMmLang(astro), 'nb');
  assert.equal(set.length, 0);
});

test('langSwitchHref stays same-origin', () => {
  assert.equal(langSwitchHref('/about', 'nb'), '/about?lang=nb');
  assert.equal(langSwitchHref('//evil.example/x', 'en'), '/evil.example/x?lang=en');
  assert.equal(langSwitchHref('/\\evil.example', 'en'), '/evil.example?lang=en');
  assert.equal(langSwitchHref('https://evil.example', 'en'), '/?lang=en');
  assert.equal(langSwitchHref(undefined, 'nb'), '/?lang=nb');
});
