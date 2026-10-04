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

// Instance-level settings: .env first, then the calling process env (the deploy
// workflow exports MUSIKI_INSTANCE=hem), then per-instance defaults.
const setting = (key) => String(dotEnv[key] ?? process.env[key] ?? '').trim();
const instance = setting('MUSIKI_INSTANCE') || 'musiki';
if (!['musiki', 'hem'].includes(instance)) {
  throw new Error(`[ecosystem] Unknown MUSIKI_INSTANCE "${instance}" (expected musiki or hem)`);
}
const isHem = instance === 'hem';

const appName = setting('PM2_APP_NAME') || (isHem ? 'hem-engine' : 'musiki-framework');
// PORT only from .env: a stray PORT in the pm2/runner env must not move the app.
const appPort = String(dotEnv.PORT ?? '').trim() || (isHem ? '4333' : '4321');
// hem has no dev app unless PM2_DEV_APP_NAME is set explicitly.
const devAppName = setting('PM2_DEV_APP_NAME') || (isHem ? '' : 'musiki-framework-dev');
const devPort = setting('PM2_DEV_PORT') || '4325';
const busAppName = setting('PM2_BUS_APP_NAME') || (isHem ? 'hem-engine-content-bus' : 'musiki-content-bus');
const busPort = setting('CONTENT_BUS_PORT') || (isHem ? '4334' : '4322');

// Defaults that keep a hem deploy (from the app or its content bus) off the
// musiki lock, LilyPond store and pm2 apps. .env values still win.
const hemDefaults = isHem
  ? {
      MUSIKI_INSTANCE: 'hem',
      LILYPOND_ASSET_DIR: '/opt/hem/data/lily',
      VPS_DEPLOY_LOCK_FILE: '/tmp/hem-engine-deploy.lock',
      VPS_RELOAD_COMMAND: `pm2 reload ecosystem.config.cjs --only ${appName} --update-env || pm2 start ecosystem.config.cjs --only ${appName} --update-env`,
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
      ...hemDefaults,
      ...dotEnv,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: appPort,
      // FORZADO DE ENTORNO
      AUTH_URL: isHem ? (dotEnv.AUTH_URL || 'https://hem.zztt.org') : 'https://musiki.org.ar',
      AUTH_TRUST_HOST: 'true',
      ...(isHem ? { MUSIKI_INSTANCE: 'hem', CONTENT_BUS_PORT: busPort } : {}),
    },
  },
];

if (devAppName) {
  apps.push({
    name: devAppName,
    cwd: __dirname,
    script: 'node_modules/.bin/astro',
    args: `dev --host 0.0.0.0 --port ${devPort}`,
    interpreter: 'node',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    env: {
      ...hemDefaults,
      ...dotEnv,
      DATABASE_URL: stagingDatabaseUrl,
      NODE_ENV: 'development',
      AUTH_URL: isHem ? (dotEnv.DEV_AUTH_URL || 'https://dev.hem.zztt.org') : 'https://dev.musiki.org.ar',
      AUTH_TRUST_HOST: 'true',
      ...(isHem ? { MUSIKI_INSTANCE: 'hem', CONTENT_BUS_PORT: busPort } : {}),
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
    ...hemDefaults,
    ...dotEnv,
    ...(isHem ? { MUSIKI_INSTANCE: 'hem', CONTENT_BUS_PORT: busPort } : {}),
    CONTENT_BUS_SECRET: dotEnv.CONTENT_BUS_SECRET || 'musiki-local-secret'
  },
});

module.exports = { apps };
