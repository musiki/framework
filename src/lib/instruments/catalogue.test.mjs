import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearCatalogueCache,
  handlePublicInstrumentsRequest,
  instrumentsDir,
  instrumentsLangForTenant,
  isInstrumentsHostAllowed,
  listCatalogueFiles,
  loadPublicInstruments,
  slugifyFileName,
} from './catalogue.ts';

function tempCatalogue(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soog-instruments-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  clearCatalogueCache();
  return dir;
}

const md = (yaml, body = 'Body prose that must never leak.') => `---\n${yaml}\n---\n${body}\n`;
const instrument = (extra = '') => md(`type: instrument\npublish: true${extra ? `\n${extra}` : ''}`);

test('publish filter: only YAML boolean publish: true is public', () => {
  const dir = tempCatalogue({
    'Yes.md': instrument(),
    'No.md': md('type: instrument\npublish: false'),
    'Missing.md': md('type: instrument'),
    'String.md': md('type: instrument\npublish: "true"'),
  });
  const titles = loadPublicInstruments({ dir, lang: 'en' }).map((i) => i.title);
  assert.deepEqual(titles, ['Yes']);
});

test('type filter: published notes that are not instruments are excluded', () => {
  const dir = tempCatalogue({
    'Inst.md': instrument(),
    'Box.md': md('type: box\npublish: true'),
    'Concept.md': md('type: concept\npublish: true'),
    'Untyped.md': md('publish: true'),
    'NoFrontmatter.md': 'just text',
  });
  assert.deepEqual(loadPublicInstruments({ dir, lang: 'en' }).map((i) => i.title), ['Inst']);
});

test('subfolders are walked', () => {
  const dir = tempCatalogue({
    'Top.md': instrument(),
    'fictional/deep/Nested.md': instrument(),
  });
  assert.deepEqual(loadPublicInstruments({ dir, lang: 'en' }).map((i) => i.title), ['Nested', 'Top']);
});

test('ignored files: scripts/, node_modules/, dotfiles, README.md, SCHEMA.md, non-md', () => {
  const dir = tempCatalogue({
    'Real.md': instrument(),
    'scripts/fixture.md': instrument(),
    'node_modules/pkg/x.md': instrument(),
    '.obsidian/hidden.md': instrument(),
    '.hidden.md': instrument(),
    'README.md': instrument(),
    'readme.md': instrument(),
    'SCHEMA.md': instrument(),
    'sub/README.md': instrument(),
    'notes.txt': instrument(),
  });
  assert.deepEqual(listCatalogueFiles(dir).map((f) => path.relative(dir, f)), ['Real.md']);
  assert.deepEqual(loadPublicInstruments({ dir, lang: 'en' }).map((i) => i.title), ['Real']);
});

test('language: title_es for es, plain title for en, fallback to the other language', () => {
  const dir = tempCatalogue({
    'parrot.md': instrument('title: Spectral Parrot\ntitle_es: Loro espectral\nfamily: hybrid\nfamily_es: híbrido\nmoaie:\n  M: matter\n  M_es: materia'),
    'onlyes.md': instrument('title_es: Sólo español'),
    'enkey.md': instrument('title: Canonical\ntitle_en: English Title'),
  });
  const es = loadPublicInstruments({ dir, lang: 'es' });
  const en = loadPublicInstruments({ dir, lang: 'en' });
  const byId = (list) => Object.fromEntries(list.map((i) => [i.id, i]));
  assert.equal(byId(es).parrot.title, 'Loro espectral');
  assert.equal(byId(es).parrot.family, 'híbrido');
  assert.equal(byId(es).parrot.moaie.text.M, 'materia');
  assert.equal(byId(en).parrot.title, 'Spectral Parrot');
  assert.equal(byId(en).parrot.family, 'hybrid');
  assert.equal(byId(en).parrot.moaie.text.M, 'matter');
  assert.equal(byId(en).onlyes.title, 'Sólo español');
  assert.equal(byId(en).enkey.title, 'English Title');
  assert.equal(byId(es).enkey.title, 'Canonical');
  // no *_es keys leak into the payload
  assert.ok(!JSON.stringify(es).includes('title_es'));
});

test('fictional: layer: fictional (case-insensitive) sets fictional, other layers do not', () => {
  const dir = tempCatalogue({
    'Fic.md': instrument('layer: Fictional'),
    'Ac.md': instrument('layer: acoustic'),
    'None.md': instrument(),
  });
  const list = loadPublicInstruments({ dir, lang: 'en' });
  assert.deepEqual(list.map((i) => [i.title, i.fictional]), [['Ac', false], ['Fic', true], ['None', false]]);
});

test('ids: YAML id wins, else filename slug; duplicates get a suffix', () => {
  const dir = tempCatalogue({
    'Latigo de Madera.md': instrument('id: latigo-de-madera'),
    'a/Ü Ñandú.md': instrument(),
    'b/Ü Ñandú.md': instrument(),
  });
  const ids = loadPublicInstruments({ dir, lang: 'en' }).map((i) => i.id).sort();
  assert.deepEqual(ids, ['latigo-de-madera', 'u-nandu', 'u-nandu-2']);
  assert.equal(slugifyFileName('Oscil  Twins.md'), 'oscil-twins');
});

test('payload never contains body prose, publish flags or private notes', () => {
  const dir = tempCatalogue({
    'Pub.md': instrument('secret_field: nope'),
    'Priv.md': md('type: instrument\npublish: false\ntitle: Private Thing'),
  });
  const json = JSON.stringify(loadPublicInstruments({ dir, lang: 'en' }));
  assert.ok(!json.includes('Body prose'));
  assert.ok(!json.includes('Private Thing'));
  assert.ok(!json.includes('secret_field'));
  assert.ok(!json.includes('publish'));
});

test('cache invalidates when a file changes', () => {
  const dir = tempCatalogue({ 'A.md': instrument() });
  assert.equal(loadPublicInstruments({ dir, lang: 'en' }).length, 1);
  fs.writeFileSync(path.join(dir, 'B.md'), instrument());
  assert.equal(loadPublicInstruments({ dir, lang: 'en' }).length, 2);
  fs.writeFileSync(path.join(dir, 'A.md'), md('type: instrument\npublish: false\nx: longer content'));
  assert.deepEqual(loadPublicInstruments({ dir, lang: 'en' }).map((i) => i.title), ['B']);
});

test('missing directory: loader returns null, handler 200 with empty list', () => {
  const dir = path.join(os.tmpdir(), 'soog-instruments-does-not-exist-' + process.pid);
  assert.equal(loadPublicInstruments({ dir, lang: 'en' }), null);
  const res = handlePublicInstrumentsRequest('so', { dir, now: () => new Date('2026-10-05T00:00:00Z') });
  assert.deepEqual(res, { status: 200, body: { generatedAt: '2026-10-05T00:00:00.000Z', instruments: [] } });
});

test('handler: host gating and tenant language', () => {
  const dir = tempCatalogue({ 'x.md': instrument('title: Parrot\ntitle_es: Loro') });
  assert.equal(handlePublicInstrumentsRequest('mm', { dir }).status, 404);
  assert.equal(handlePublicInstrumentsRequest('hem', { dir }).status, 404);
  assert.equal(handlePublicInstrumentsRequest('so', { dir }).body.instruments[0].title, 'Parrot');
  assert.equal(handlePublicInstrumentsRequest('musiki', { dir }).body.instruments[0].title, 'Loro');
  assert.equal(isInstrumentsHostAllowed('so'), true);
  assert.equal(isInstrumentsHostAllowed('musiki'), true);
  assert.equal(instrumentsLangForTenant('so'), 'en');
  assert.equal(instrumentsLangForTenant('musiki'), 'es');
});

test('instrumentsDir: INSTRUMENTS_DIR override, else .content-sources/soog-instruments', () => {
  assert.equal(instrumentsDir({}, '/repo'), path.join('/repo', '.content-sources', 'soog-instruments'));
  assert.equal(instrumentsDir({ INSTRUMENTS_DIR: '/data/cat' }, '/repo'), '/data/cat');
  assert.equal(instrumentsDir({ INSTRUMENTS_DIR: 'rel/cat' }, '/repo'), path.join('/repo', 'rel', 'cat'));
});

test('tags and videos reach the payload (body urls included, body text not)', () => {
  const dir = tempCatalogue({
    'Vid.md': md(
      'type: instrument\npublish: true\ntags: [noise, dss/case]\nlink: https://vimeo.com/55',
      'Secret prose https://www.youtube.com/watch?v=dQw4w9WgXcQ and <iframe src="https://player.vimeo.com/video/55"></iframe>',
    ),
  });
  const [inst] = loadPublicInstruments({ dir, lang: 'en' });
  assert.deepEqual(inst.tags, ['noise']);
  assert.deepEqual(inst.videos.map((v) => `${v.provider}:${v.id}`), ['vimeo:55', 'youtube:dQw4w9WgXcQ']);
  assert.ok(!JSON.stringify(inst).includes('Secret prose'));
});
