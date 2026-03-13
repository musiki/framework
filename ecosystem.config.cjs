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
        // Esto debería coincidir con el token configurado en los GitHub Actions de las materias
        CONTENT_BUS_SECRET: process.env.CONTENT_BUS_SECRET || 'mwlEL5avF0SDrK4s3kgt4oZBpSSLisra'
      },
    },
  ],
};
