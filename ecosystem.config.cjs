const fs = require('node:fs');
const path = require('node:path');

const envPath = path.resolve(__dirname, '.env');
const dotEnv = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value.length > 0) {
      dotEnv[key.trim()] = value.join('=').trim().replace(/^["']|["']$/g, '');
    }
  });
}

// Instance: .env first, then the calling process env (the deploy workflow
// exports MUSIKI_INSTANCE=hem). An empty value (`MUSIKI_INSTANCE=`) counts as unset.
const setting = (key) => String(dotEnv[key] ?? process.env[key] ?? '').trim();
const instance = setting('MUSIKI_INSTANCE') || 'musiki';
if (!['musiki', 'hem'].includes(instance)) {
  throw new Error(`[ecosystem] Unknown MUSIKI_INSTANCE "${instance}" (expected musiki or hem)`);
}
const isHem = instance === 'hem';

// Names and ports are fixed per instance and never read from .env: musiki keeps
// its historical values, and hem's .env is copied from the old fork, whose
// PORT/PM2_*/VPS_* keys must not move the hem apps onto the fork's.
const appName = isHem ? 'hem-engine' : 'musiki-framework';
const appPort = isHem ? '4333' : '4321';
const devAppName = isHem ? '' : 'musiki-framework-dev'; // hem has no dev app
const busAppName = isHem ? 'hem-engine-content-bus' : 'musiki-content-bus';
const busPort = isHem ? '4334' : '4322';

// Values that define the hem instance. Spread AFTER ...dotEnv so a key copied
// from the fork's .env cannot point hem at the fork (or at musiki's lock,
// LilyPond store or pm2 apps). Empty for musiki, whose env stays as before.
const hemPinned = isHem
  ? {
      MUSIKI_INSTANCE: 'hem',
      PORT: appPort,
      CONTENT_BUS_PORT: busPort,
      VPS_FRAMEWORK_DIR: __dirname,
      VPS_DEPLOY_LOCK_FILE: '/tmp/hem-engine-deploy.lock',
      VPS_RELOAD_COMMAND: `pm2 reload ecosystem.config.cjs --only ${appName} --update-env || pm2 start ecosystem.config.cjs --only ${appName} --update-env`,
      LILYPOND_ASSET_DIR: '/opt/hem/data/lily',
      PM2_APP_NAME: appName,
      PM2_BUS_APP_NAME: busAppName,
    }
  : {};

// Dev/staging must never touch production data. If the swap cannot be derived,
// point dev at an unreachable URL (never empty: src/lib/db/pool.ts falls back to .env on '').
const prodDatabaseUrl = dotEnv.DATABASE_URL || '';
const derivedStagingUrl = prodDatabaseUrl.replace(/\/musiki26(\?|$)/, '/musiki_staging$1');
const stagingDatabaseUrl = derivedStagingUrl !== prodDatabaseUrl && /\/musiki_staging(\?|$)/.test(derivedStagingUrl)
  ? derivedStagingUrl
  : 'postgresql://staging-url-not-derived.invalid:5432/musiki_staging';
if (devAppName && stagingDatabaseUrl.includes('.invalid')) {
  console.warn(`[ecosystem] ${devAppName}: could not derive staging DATABASE_URL; dev DB disabled`);
}

const apps = [
  {
    name: appName,
    cwd: __dirname,
    script: 'dist/server/entry.mjs',
    interpreter: 'node',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G',
    env: {
      ...dotEnv,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: appPort,
      // FORZADO DE ENTORNO
      AUTH_URL: isHem ? (dotEnv.AUTH_URL || 'https://hem.zztt.org') : 'https://musiki.org.ar',
      AUTH_TRUST_HOST: 'true',
      ...hemPinned,
    },
  },
];

// Dev app: musiki only.
if (devAppName) {
  apps.push({
    name: devAppName,
    cwd: __dirname,
    script: 'node_modules/.bin/astro',
    args: 'dev --host 0.0.0.0 --port 4325',
    interpreter: 'node',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    env: {
      ...dotEnv,
      DATABASE_URL: stagingDatabaseUrl,
      NODE_ENV: 'development',
      AUTH_URL: 'https://dev.musiki.org.ar',
      AUTH_TRUST_HOST: 'true'
    },
  });
}

apps.push({
  name: busAppName,
  cwd: __dirname,
  script: 'scripts/vps/content-bus.mjs',
  interpreter: 'node',
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  max_memory_restart: '200M',
  env: {
    NODE_ENV: 'production',
    CONTENT_BUS_PORT: busPort,
    VPS_FRAMEWORK_DIR: __dirname,
    PATH: `/Users/zztt/.local/share/nvm/v24.14.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH}`,
    ...dotEnv,
    ...hemPinned,
    CONTENT_BUS_SECRET: dotEnv.CONTENT_BUS_SECRET || 'musiki-local-secret'
  },
});

module.exports = { apps };
