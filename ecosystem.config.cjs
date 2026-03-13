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

module.exports = {
  apps: [
    {
      name: 'musiki-framework',
      cwd: __dirname,
      script: 'dist/server/entry.mjs',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '4321',
        // FORZADO DE ENTORNO
        AUTH_URL: 'https://www.musiki.org.ar',
        AUTH_TRUST_HOST: 'true',
        ...dotEnv
      },
    },
    {
      name: 'musiki-content-bus',
      cwd: __dirname,
      script: 'scripts/vps/content-bus.mjs',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        CONTENT_BUS_PORT: '4322',
        ...dotEnv,
        CONTENT_BUS_SECRET: dotEnv.CONTENT_BUS_SECRET || 'musiki-local-secret'
      },
    },
  ],
};
