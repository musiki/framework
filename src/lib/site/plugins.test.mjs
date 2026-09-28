import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listPlugins, parsePluginManifest } from './plugins.ts';

async function withFixtureDir(packages, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugins-test-'));
  try {
    for (const [name, files] of Object.entries(packages)) {
      const pkgDir = path.join(dir, name);
      await fs.mkdir(pkgDir, { recursive: true });
      for (const [file, contents] of Object.entries(files)) {
        await fs.writeFile(path.join(pkgDir, file), contents, 'utf8');
      }
    }
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const ZOTERO_MANIFEST = JSON.stringify({
  name: 'zotero-graph',
  description: 'Interactive graph of a Zotero collection',
  targets: ['so'],
  options: {
    src: { type: 'string', example: '/research/zoterob.json' },
    height: { type: 'number', default: 600 },
  },
});

test('parsePluginManifest: accepts the spec 3.3 shape', () => {
  const manifest = parsePluginManifest(JSON.parse(ZOTERO_MANIFEST));
  assert.deepEqual(manifest, {
    name: 'zotero-graph',
    description: 'Interactive graph of a Zotero collection',
    targets: ['so'],
    options: {
      src: { type: 'string', example: '/research/zoterob.json' },
      height: { type: 'number', default: 600 },
    },
  });
});

test('parsePluginManifest: options may be omitted', () => {
  const manifest = parsePluginManifest({ name: 'p', description: 'd', targets: ['so'] });
  assert.deepEqual(manifest, { name: 'p', description: 'd', targets: ['so'], options: {} });
});

test('parsePluginManifest: rejects non-object input', () => {
  assert.equal(parsePluginManifest(null), null);
  assert.equal(parsePluginManifest([1, 2]), null);
  assert.equal(parsePluginManifest('nope'), null);
});

test('parsePluginManifest: rejects missing/wrong-typed required fields', () => {
  assert.equal(parsePluginManifest({ description: 'd', targets: ['so'] }), null);
  assert.equal(parsePluginManifest({ name: 'p', targets: ['so'] }), null);
  assert.equal(parsePluginManifest({ name: 'p', description: 'd', targets: 'so' }), null);
  assert.equal(parsePluginManifest({ name: '', description: 'd', targets: ['so'] }), null);
});

test('parsePluginManifest: rejects an option with an unknown type', () => {
  const manifest = parsePluginManifest({
    name: 'p', description: 'd', targets: ['so'],
    options: { foo: { type: 'array' } },
  });
  assert.equal(manifest, null);
});

test('parsePluginManifest: rejects an option that is not an object', () => {
  const manifest = parsePluginManifest({
    name: 'p', description: 'd', targets: ['so'],
    options: { foo: 'string' },
  });
  assert.equal(manifest, null);
});

test('listPlugins: reads a valid manifest and includes it', async () => {
  await withFixtureDir({ 'zotero-graph': { 'manifest.json': ZOTERO_MANIFEST } }, async (dir) => {
    const plugins = await listPlugins(dir);
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0].name, 'zotero-graph');
  });
});

test('listPlugins: filters out manifests whose targets do not include "so"', async () => {
  await withFixtureDir({
    'musiki-only': {
      'manifest.json': JSON.stringify({ name: 'musiki-only', description: 'd', targets: ['musiki'] }),
    },
    'both': {
      'manifest.json': JSON.stringify({ name: 'both', description: 'd', targets: ['so', 'musiki'] }),
    },
  }, async (dir) => {
    const plugins = await listPlugins(dir);
    const names = plugins.map((p) => p.name);
    assert.ok(!names.includes('musiki-only'));
    assert.ok(names.includes('both'));
  });
});

test('listPlugins: skips invalid JSON with a warning, does not crash', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await withFixtureDir({
      'broken': { 'manifest.json': '{ not valid json' },
      'ok': { 'manifest.json': ZOTERO_MANIFEST },
    }, async (dir) => {
      const plugins = await listPlugins(dir);
      assert.equal(plugins.length, 1);
      assert.equal(plugins[0].name, 'zotero-graph');
      assert.ok(warnings.some((w) => w.includes('broken')));
    });
  } finally {
    console.warn = originalWarn;
  }
});

test('listPlugins: skips a manifest with the wrong shape with a warning', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await withFixtureDir({
      'malformed': { 'manifest.json': JSON.stringify({ name: 'malformed', targets: ['so'] }) },
    }, async (dir) => {
      const plugins = await listPlugins(dir);
      assert.equal(plugins.length, 0);
      assert.ok(warnings.length > 0);
    });
  } finally {
    console.warn = originalWarn;
  }
});

test('listPlugins: ignores subdirectories with no manifest.json', async () => {
  await withFixtureDir({ 'not-a-plugin': { 'README.md': 'hello' } }, async (dir) => {
    const plugins = await listPlugins(dir);
    assert.equal(plugins.length, 0);
  });
});

test('listPlugins: ignores files at the top level (not directories)', async () => {
  await withFixtureDir({}, async (dir) => {
    await fs.writeFile(path.join(dir, 'stray-file.json'), '{}', 'utf8');
    const plugins = await listPlugins(dir);
    assert.equal(plugins.length, 0);
  });
});

test('listPlugins: returns an empty array (no throw) when dir does not exist', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const plugins = await listPlugins('/nonexistent/path/that/should/not/exist');
    assert.deepEqual(plugins, []);
  } finally {
    console.warn = originalWarn;
  }
});

test('listPlugins: sorts results by name', async () => {
  await withFixtureDir({
    'zebra': { 'manifest.json': JSON.stringify({ name: 'zebra', description: 'd', targets: ['so'] }) },
    'alpha': { 'manifest.json': JSON.stringify({ name: 'alpha', description: 'd', targets: ['so'] }) },
  }, async (dir) => {
    const plugins = await listPlugins(dir);
    assert.deepEqual(plugins.map((p) => p.name), ['alpha', 'zebra']);
  });
});

test('listPlugins: follows symlinked package directories (M9)', async () => {
  const real = await fs.mkdtemp(path.join(os.tmpdir(), 'plugins-real-'));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugins-links-'));
  try {
    await fs.mkdir(path.join(real, 'zotero-graph'));
    await fs.writeFile(path.join(real, 'zotero-graph', 'manifest.json'), ZOTERO_MANIFEST, 'utf8');
    await fs.symlink(path.join(real, 'zotero-graph'), path.join(dir, 'zotero-graph'), 'dir');
    await fs.symlink(path.join(real, 'nope'), path.join(dir, 'dangling'), 'dir');
    const result = await listPlugins(dir);
    assert.deepEqual(result.map((m) => m.name), ['zotero-graph']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(real, { recursive: true, force: true });
  }
});
