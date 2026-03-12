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
      },
    },
  ],
};
