import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load the ecosystem config from the root
const config = require(path.resolve(__dirname, '../ecosystem.config.cjs'));

test('ecosystem config: dev DB isolation', async (t) => {
  const prodApp = config.apps.find(a => a.name === 'musiki-framework');
  const devApp = config.apps.find(a => a.name === 'musiki-framework-dev');

  assert(prodApp, 'musiki-framework app exists');
  assert(devApp, 'musiki-framework-dev app exists');

  const prodDbUrl = prodApp.env.DATABASE_URL || '';
  const devDbUrl = devApp.env.DATABASE_URL || '';

  // Prod DB should never contain musiki_staging
  const prodSafe = !/musiki_staging/.test(prodDbUrl);
  assert(prodSafe, 'Production DATABASE_URL does not contain musiki_staging');

  // Dev DB should either point to musiki_staging or be unreachable
  const devPointsToStaging = /\/musiki_staging(\?|$)/.test(devDbUrl);
  const devDisabled = /\.invalid/.test(devDbUrl);
  const devSafe = devPointsToStaging || devDisabled;
  assert(devSafe, 'Development DATABASE_URL points to staging or is disabled');

  // Dev and prod should not be identical
  const devNotProd = devDbUrl !== prodDbUrl;
  assert(devNotProd, 'Development DATABASE_URL differs from production');
});

// Load a copy of the config next to a temp .env so instance settings can be
// exercised without touching the real .env.
function loadConfigWithEnv(envText, processEnv = {}) {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecosystem-'));
  fs.copyFileSync(path.resolve(__dirname, '../ecosystem.config.cjs'), path.join(dir, 'ecosystem.config.cjs'));
  if (envText !== null) fs.writeFileSync(path.join(dir, '.env'), envText);
  const keys = ['MUSIKI_INSTANCE', 'PORT', 'CONTENT_BUS_PORT', 'PM2_APP_NAME', 'PM2_DEV_APP_NAME', 'PM2_BUS_APP_NAME'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, processEnv);
  try {
    return require(path.join(dir, 'ecosystem.config.cjs'));
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// [name, port]: the server's PORT, the dev app's CLI args, the bus's CONTENT_BUS_PORT.
const summary = (cfg) => cfg.apps.map((a) => [
  a.name,
  a.script === 'scripts/vps/content-bus.mjs' ? a.env.CONTENT_BUS_PORT : a.args || a.env.PORT,
]);

test('ecosystem config: musiki defaults are unchanged', () => {
  const cfg = loadConfigWithEnv('DATABASE_URL=postgresql://u:p@h:5432/musiki26\n');
  assert.deepStrictEqual(summary(cfg), [
    ['musiki-framework', '4321'],
    ['musiki-framework-dev', 'dev --host 0.0.0.0 --port 4325'],
    ['musiki-content-bus', '4322'],
  ]);
  assert.strictEqual(cfg.apps[0].env.AUTH_URL, 'https://musiki.org.ar');
  assert.strictEqual(cfg.apps[0].env.MUSIKI_INSTANCE, undefined);
  assert.strictEqual(cfg.apps[2].env.VPS_RELOAD_COMMAND, undefined);
});

test('ecosystem config: MUSIKI_INSTANCE=hem in .env selects hem names and ports', () => {
  const cfg = loadConfigWithEnv('MUSIKI_INSTANCE=hem\nDATABASE_URL=postgresql://u:p@h:5432/hem\n');
  assert.deepStrictEqual(summary(cfg), [
    ['hem-engine', '4333'],
    ['hem-engine-content-bus', '4334'],
  ]);
  const [app, bus] = cfg.apps;
  assert.strictEqual(app.env.MUSIKI_INSTANCE, 'hem');
  assert.strictEqual(app.env.CONTENT_BUS_PORT, '4334');
  assert.strictEqual(app.env.AUTH_URL, 'https://hem.zztt.org');
  assert.strictEqual(bus.env.MUSIKI_INSTANCE, 'hem');
  assert.strictEqual(bus.env.LILYPOND_ASSET_DIR, '/opt/hem/data/lily');
  assert.strictEqual(bus.env.VPS_DEPLOY_LOCK_FILE, '/tmp/hem-engine-deploy.lock');
  assert.match(bus.env.VPS_RELOAD_COMMAND, /--only hem-engine --update-env/);
  for (const a of cfg.apps) {
    assert(!/^(musiki|hem-framework|hem-content-bus)/.test(a.name), `${a.name} does not collide`);
    for (const port of ['4321', '4322', '4325', '4328', '4329']) {
      assert.notStrictEqual(a.env.PORT, port);
      assert.notStrictEqual(a.env.CONTENT_BUS_PORT, port);
      assert(!String(a.args || '').includes(port));
    }
  }
});

test('ecosystem config: MUSIKI_INSTANCE from the process env and explicit overrides', () => {
  const cfg = loadConfigWithEnv(null, { MUSIKI_INSTANCE: 'hem' });
  assert.deepStrictEqual(cfg.apps.map((a) => a.name), ['hem-engine', 'hem-engine-content-bus']);
  const custom = loadConfigWithEnv('PM2_APP_NAME=x-app\nPORT=5000\nPM2_BUS_APP_NAME=x-bus\nCONTENT_BUS_PORT=5001\nPM2_DEV_APP_NAME=x-dev\n');
  assert.deepStrictEqual(summary(custom), [
    ['x-app', '5000'],
    ['x-dev', 'dev --host 0.0.0.0 --port 4325'],
    ['x-bus', '5001'],
  ]);
});

test('ecosystem config: unknown instance fails loudly', () => {
  assert.throws(() => loadConfigWithEnv('MUSIKI_INSTANCE=nope\n'), /Unknown MUSIKI_INSTANCE/);
});
