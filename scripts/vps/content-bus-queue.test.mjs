import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePending, sourcesOf, reloadCommandFor } from './content-bus-queue.mjs';

test('mergePending: un aviso por repo, el último gana y va al final', () => {
  const q = mergePending(
    [{ source_repo: 'musiki/s123', source_sha: 'aaaaaaa' }, { source_repo: 'musiki/i1', source_sha: 'bbbbbbb' }],
    [{ source_repo: 'https://github.com/musiki/S123.git', source_sha: 'ccccccc' }],
  );
  assert.deepEqual(q.map((p) => p.source_sha), ['bbbbbbb', 'ccccccc']);
});

test('mergePending: ignora basura', () => {
  assert.deepEqual(mergePending(null ?? [], [null, 'x']), []);
});

test('sourcesOf: materia y hash corto', () => {
  assert.deepEqual(sourcesOf([{ source_repo: 'musiki/s123', source_sha: '69ebdfa1234567', source_ref: 'refs/heads/main' }]), [
    { repo: 'musiki/s123', course: 's123', sha: '69ebdfa', ref: 'main' },
  ]);
  assert.equal(sourcesOf([{ source_sha: 'no-es-sha' }])[0].sha, '');
});

test('reloadCommandFor: recarga todas las apps menos el bus, de a una', () => {
  const cmd = reloadCommandFor([
    { name: 'musiki-framework', script: 'dist/server/entry.mjs' },
    { name: 'musiki-framework-dev', script: 'node_modules/.bin/astro' },
    { name: 'musiki-content-bus', script: 'scripts/vps/content-bus.mjs' },
  ]);
  assert.match(cmd, /--only musiki-framework --update-env/);
  assert.match(cmd, /--only musiki-framework-dev --update-env/);
  assert.doesNotMatch(cmd, /content-bus/);
  assert.doesNotMatch(cmd, /--only [^ ]*,/);
});
