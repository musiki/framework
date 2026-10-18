// The deploy workflow deploys all content dispatches (musiki and hem) and
// framework pushes into the single unified /opt/musiki/framework runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';

const workflowPath = new URL('../../.github/workflows/sync-content-sources.yml', import.meta.url);
const workflow = YAML.parse(fs.readFileSync(workflowPath, 'utf8'));

test('concurrency group is unified as content-sync', () => {
  assert.equal(workflow.concurrency.group, 'content-sync');
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
});

test('deploy job targets the unified /opt/musiki/framework runtime for all events', () => {
  const deploy = workflow.jobs.deploy;
  assert.ok(deploy, 'deploy job exists');
  assert.match(deploy.env.VPS_FRAMEWORK_DIR, /\/opt\/musiki\/framework/);
  assert.match(deploy.env.CONTENT_SOURCE_TARGET_REPO, /github\.event\.client_payload\.source_repo/);

  const stepNames = deploy.steps.map((s) => s.name);
  assert.ok(stepNames.includes('Sync checked-out framework into runtime dir'));
  assert.ok(stepNames.includes('Zero Downtime Deploy on VPS'));
  assert.ok(stepNames.includes('Reload Content Bus Sidecar'));
  assert.ok(!stepNames.some((n) => /\/opt\/hem|hem on VPS/i.test(n)), 'no separate /opt/hem deploy steps');
});

