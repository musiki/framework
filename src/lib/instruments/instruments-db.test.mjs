import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPublicInstruments } from './instruments-db.ts';

const SPACE_ID = 'space-1';

function fakeQuery(routes) {
  return async (text, params = []) => {
    for (const [match, handler] of routes) {
      const hit = typeof match === 'string' ? text.includes(match) : match.test(text);
      if (hit) return { data: handler(params, text) ?? [], error: null };
    }
    return { data: [], error: null };
  };
}

// A realistic fixture: a `Cases` root (public) with `Instruments` (inherits
// public) and `Instruments (fictional)` (inherits public, name contains
// "fictional") subfolders, plus an unrelated private `GTX` root and a note
// directly under Cases that's explicitly private.
function fixture() {
  const folders = [
    { id: 'f-gtx', parentId: null, name: 'GTX', visibility: 'private' },
    { id: 'f-cases', parentId: null, name: 'Cases', visibility: 'public' },
    { id: 'f-instruments', parentId: 'f-cases', name: 'Instruments', visibility: null },
    { id: 'f-fictional', parentId: 'f-cases', name: 'Instruments (fictional)', visibility: null },
  ];
  const instrumentBody = (title) => `---\ntype: instrument\ntitle: ${title}\n---\nBody text for ${title}.`;
  const notes = [
    {
      id: 'n-real',
      folderId: 'f-instruments',
      title: 'Real One',
      body: instrumentBody('Real One'),
      visibility: null,
      userId: 'u1',
    },
    {
      id: 'n-fictional',
      folderId: 'f-fictional',
      title: 'Fictional One',
      body: instrumentBody('Fictional One'),
      visibility: null,
      userId: 'u1',
    },
    {
      id: 'n-private',
      folderId: 'f-cases',
      title: 'Private One',
      body: instrumentBody('Private One'),
      visibility: 'private',
      userId: 'u1',
    },
    {
      id: 'n-outside',
      folderId: 'f-gtx',
      title: 'Outside Cases',
      body: instrumentBody('Outside Cases'),
      visibility: 'public',
      userId: 'u1',
    },
    {
      id: 'n-non-instrument',
      folderId: 'f-instruments',
      title: 'Not An Instrument',
      body: '---\ntype: essay\ntitle: Not An Instrument\n---\nSome prose.',
      visibility: null,
      userId: 'u1',
    },
  ];
  return fakeQuery([
    ['"Space"', () => [{ id: SPACE_ID }]],
    ['"LiveClassNoteFolder"', () => folders],
    ['"LiveClassNote"', () => notes],
  ]);
}

test('loadPublicInstruments: excludes a note explicitly marked private', async () => {
  const q = fixture();
  const instruments = await loadPublicInstruments(q, { tenantId: 'so' });
  const titles = instruments.map((i) => i.title);
  assert.ok(!titles.includes('Private One'));
});

test('loadPublicInstruments: excludes a note outside the Cases tree', async () => {
  const q = fixture();
  const instruments = await loadPublicInstruments(q, { tenantId: 'so' });
  const titles = instruments.map((i) => i.title);
  assert.ok(!titles.includes('Outside Cases'));
});

test('loadPublicInstruments: excludes a non-instrument note (frontmatter type mismatch)', async () => {
  const q = fixture();
  const instruments = await loadPublicInstruments(q, { tenantId: 'so' });
  const titles = instruments.map((i) => i.title);
  assert.ok(!titles.includes('Not An Instrument'));
});

test('loadPublicInstruments: flags instruments under a folder whose name contains "fictional"', async () => {
  const q = fixture();
  const instruments = await loadPublicInstruments(q, { tenantId: 'so' });
  const real = instruments.find((i) => i.title === 'Real One');
  const fictional = instruments.find((i) => i.title === 'Fictional One');
  assert.equal(real?.fictional, false);
  assert.equal(fictional?.fictional, true);
});

test('loadPublicInstruments: sorts by title (locale en)', async () => {
  const q = fakeQuery([
    ['"Space"', () => [{ id: SPACE_ID }]],
    ['"LiveClassNoteFolder"', () => [{ id: 'f-cases', parentId: null, name: 'Cases', visibility: 'public' }]],
    ['"LiveClassNote"', () => [
      { id: 'n-z', folderId: 'f-cases', title: 'Zither', body: '---\ntype: instrument\ntitle: Zither\n---\n', visibility: null },
      { id: 'n-a', folderId: 'f-cases', title: 'Accordion', body: '---\ntype: instrument\ntitle: Accordion\n---\n', visibility: null },
      { id: 'n-m', folderId: 'f-cases', title: 'Mbira', body: '---\ntype: instrument\ntitle: Mbira\n---\n', visibility: null },
    ]],
  ]);
  const instruments = await loadPublicInstruments(q, { tenantId: 'so' });
  assert.deepEqual(instruments.map((i) => i.title), ['Accordion', 'Mbira', 'Zither']);
});

test('loadPublicInstruments: output never contains user ids, other author fields, or body prose', async () => {
  const q = fixture();
  const instruments = await loadPublicInstruments(q, { tenantId: 'so' });
  const serialized = JSON.stringify(instruments);
  assert.ok(!serialized.includes('userId'));
  assert.ok(!serialized.includes('u1'));
  assert.ok(!serialized.includes('Body text for'));
});

test('loadPublicInstruments: returns [] when the tenant has no dissertation space', async () => {
  const q = fakeQuery([['"Space"', () => []]]);
  assert.deepEqual(await loadPublicInstruments(q, { tenantId: 'so' }), []);
});

test('loadPublicInstruments: returns [] when the space has no root Cases folder yet', async () => {
  const q = fakeQuery([
    ['"Space"', () => [{ id: SPACE_ID }]],
    ['"LiveClassNoteFolder"', () => [
      { id: 'f-gtx', parentId: null, name: 'GTX', visibility: 'private' },
    ]],
    ['"LiveClassNote"', () => []],
  ]);
  assert.deepEqual(await loadPublicInstruments(q, { tenantId: 'so' }), []);
});
