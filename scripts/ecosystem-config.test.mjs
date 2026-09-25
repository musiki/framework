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
