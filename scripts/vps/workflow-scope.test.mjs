// The deploy workflow classifies a run as a hem dispatch twice: in the
// workflow concurrency group and in the "Select instances to deploy" step.
// They must agree, or a musiki deploy can run outside the content-sync group.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const workflowPath = new URL('../../.github/workflows/sync-content-sources.yml', import.meta.url);
const workflow = YAML.parse(fs.readFileSync(workflowPath, 'utf8'));
const scopeStep = workflow.jobs.deploy.steps.find((s) => s.id === 'scope');
const unwrap = (v) => /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(String(v).trim())[1];

const groupExpr = unwrap(workflow.concurrency.group);
const hemExpr = unwrap(scopeStep.env.HEM_DISPATCH);

// Evaluate the restricted expression subset used here: `a == 'lit'` (GitHub
// compares strings case-insensitively), &&, ||, parentheses.
function evaluate(expr, ctx) {
  const js = expr.replace(/([\w.]+) == '([^']*)'/g, (_, ref, lit) =>
    `(String(${JSON.stringify(ctx[ref] ?? '')}).toLowerCase() === ${JSON.stringify(lit.toLowerCase())})`);
  assert.doesNotMatch(js, /\bgithub\.event/, `unsupported reference in ${js}`);
  return Function(`return (${js});`)();
}

function scope(eventName, sourceRepo) {
  const ctx = { 'github.event_name': eventName, 'github.event.client_payload.source_repo': sourceRepo };
  const hemDispatch = evaluate(hemExpr, ctx);
  const group = evaluate(groupExpr.replace(/\s*&& 'content-sync-hem' \|\| 'content-sync'$/, ''), ctx)
    ? 'content-sync-hem' : 'content-sync';
  const r = spawnSync('bash', ['-e', '-c', scopeStep.run], {
    encoding: 'utf8',
    env: { ...process.env, EVENT_NAME: eventName, HEM_DISPATCH: String(hemDispatch),
      CONTENT_SOURCE_TARGET_REPO: sourceRepo, GITHUB_OUTPUT: '/dev/null' },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = Object.fromEntries(r.stdout.match(/(musiki|hem)=(true|false)/g).map((kv) => kv.split('=')));
  return { group, musiki: out.musiki === 'true', hem: out.hem === 'true' };
}

test('concurrency group and scope step use the identical hem-dispatch expression', () => {
  assert.match(groupExpr, /&& 'content-sync-hem' \|\| 'content-sync'$/);
  assert.equal(groupExpr, `(${hemExpr}) && 'content-sync-hem' || 'content-sync'`);
});

const cases = [
  ['push', '', 'content-sync', true, true],
  ['workflow_dispatch', '', 'content-sync', true, true],
  ['repository_dispatch', 'HEM-Multimedia-Master/internetmusic', 'content-sync-hem', false, true],
  ['repository_dispatch', 'hem-multimedia-master/InternetMusic', 'content-sync-hem', false, true],
  ['repository_dispatch', 'https://github.com/HEM-Multimedia-Master/internetmusic.git', 'content-sync-hem', false, true],
  ['repository_dispatch', 'HEM-Multimedia-Master/internetmusic-archive', 'content-sync', true, false],
  ['repository_dispatch', 'musikiorg/some-materia', 'content-sync', true, false],
  ['repository_dispatch', '', 'content-sync', true, false],
];

for (const [event, repo, group, musiki, hem] of cases) {
  test(`scope: ${event} ${repo || '(no repo)'} -> ${group} musiki=${musiki} hem=${hem}`, () => {
    const r = scope(event, repo);
    assert.deepEqual(r, { group, musiki, hem });
    // Invariant: musiki deploys only ever run in the musiki group.
    if (r.musiki) assert.equal(r.group, 'content-sync');
  });
}
