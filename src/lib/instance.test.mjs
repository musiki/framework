import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INSTANCES, currentInstance, contentManifestPath } from './instance.mjs';

test('defaults to musiki when unset or empty', () => {
  assert.equal(currentInstance({}), 'musiki');
  assert.equal(currentInstance({ MUSIKI_INSTANCE: '' }), 'musiki');
  assert.deepEqual(INSTANCES, ['musiki', 'hem']);
});

test('selects hem', () => {
  assert.equal(currentInstance({ MUSIKI_INSTANCE: 'hem' }), 'hem');
});

test('unknown instance throws', () => {
  assert.throws(
    () => currentInstance({ MUSIKI_INSTANCE: 'nope' }),
    { message: 'Unknown MUSIKI_INSTANCE "nope" (expected musiki or hem)' },
  );
});

test('manifest paths', () => {
  assert.equal(contentManifestPath('musiki'), 'config/sources.manifest.json');
  assert.equal(contentManifestPath('hem'), 'config/sources.hem.json');
});

test('hem manifest has the internetmusic source and assembly block', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../../config/sources.hem.json', import.meta.url), 'utf8'));
  const enabled = m.sources.filter((s) => s.enabled);
  assert.equal(enabled.length, 1);
  assert.deepEqual(enabled[0], {
    id: 'internetmusic', enabled: true, repo: 'HEM-Multimedia-Master/internetmusic',
    branch: 'main', contentRoot: '.', localPath: '../../hem/internetmusic',
  });
  assert.equal(m.assembly.coursesDir, 'cursos');
  assert.equal(m.assembly.requiredPublicStatus, 'approved');
  assert.equal(m.assembly.excludeTypesFromPublic.length, 4);
});
