# VPS runtime para musiki/framework

Objetivo:

- servir `musiki.org.ar` y `www.musiki.org.ar` desde Caddy -> Astro Node
- correr Astro con PM2 en una sola instancia
- dejar Ollama y LilyPond como servicios locales del mismo VPS
- tener deploy manual por Fish y deploy automático por GitHub Actions

## 1. DNS

Para `www` no va una IPv6.

- Si usas `CNAME`, el valor debe ser un hostname.
- Recomendado en Hostinger: `www` -> `musiki.org.ar`
- Si Hostinger acepta `@` como target del `CNAME`, también sirve, pero `musiki.org.ar` suele ser más claro.
- Si ya existe un `A`, `AAAA` o `CNAME` para `www`, bórralo antes de crear el nuevo.

Si quieres IPv6 en el dominio principal:

- `@` puede tener `AAAA` con la IPv6 del VPS
- `www` puede seguir como `CNAME` a `musiki.org.ar`

## 2. GitHub Actions

`i1` ya está listo para disparar al framework:

- [notify-platform-on-content-change.yml](/Users/zztt/projects/26-musiki/i1/.github/workflows/notify-platform-on-content-change.yml)

Sólo asegúrate de tener este secret en `i1`:

- `PLATFORM_DISPATCH_TOKEN`

En `framework`, el workflow espera:

- `CONTENT_SOURCE_READ_TOKEN`
- `VPS_SSH_HOST`
- `VPS_SSH_PORT`
- `VPS_SSH_USER`
- `VPS_SSH_KEY`
- `VPS_FRAMEWORK_DIR`
- `VPS_GIT_BRANCH`
- `VPS_INSTALL_COMMAND`
- `VPS_BUILD_COMMAND`
- `VPS_RELOAD_COMMAND`

Valores recomendados:

- `VPS_GIT_BRANCH=main`
- `VPS_INSTALL_COMMAND=npm ci`
- `VPS_BUILD_COMMAND=npm run build`
- `VPS_RELOAD_COMMAND=pm2 reload ecosystem.config.cjs --only musiki-framework --update-env && pm2 save`

## 3. PM2

Usa el archivo:

- [ecosystem.config.cjs](/Users/zztt/projects/26-musiki/framework/ecosystem.config.cjs)

Importante:

- dejar `instances: 1`

Razón:

- el sitio usa estado en memoria para live/class activity
- con varias instancias de PM2 ese estado se partiría entre procesos

Comandos:

```bash
cd /opt/musiki/framework
npm ci
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## 4. Caddy

Archivo de referencia:

- [ops/caddy/Caddyfile.example](/Users/zztt/projects/26-musiki/framework/ops/caddy/Caddyfile.example)

Instalación típica:

```bash
sudo mkdir -p /etc/caddy
sudo cp /opt/musiki/framework/ops/caddy/Caddyfile.example /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 5. Fish

Deploy manual desde tu máquina:

- [scripts/vps/deploy-framework.sh](/Users/zztt/projects/26-musiki/framework/scripts/vps/deploy-framework.sh)

Función Fish sugerida:

```fish
function musiki-deploy
  env \
    VPS_HOST=musiki.org.ar \
    VPS_USER=deploy \
    VPS_PATH=/opt/musiki/framework \
    /Users/zztt/projects/26-musiki/framework/scripts/vps/deploy-framework.sh
end
```

Luego:

```bash
source ~/.config/fish/config.fish
musiki-deploy
```

## 6. Ollama local

Si Astro corre en el mismo VPS, no necesitas exponer la correction API públicamente.

Puedes dejar en el `.env` productivo de `framework`:

```env
CORRECTION_API_URL=http://127.0.0.1:8787
CORRECTION_API_TOKEN=<tu-token>
```

Así:

- el browser llama a `/api/ai/correct` en Astro
- Astro llama localmente a Fastify/Ollama por loopback
- no necesitas abrir otro subdominio salvo que quieras debugging externo

## 7. LilyPond local

Si `lilypond` ya está instalado en el VPS de `framework`, conviene usar render local primero.

Opciones:

- dejar sólo el binario local y no depender de un servicio HTTP aparte
- o, si mantienes el render service, usar:

```env
REMOTE_LILYPOND_RENDER_URL=http://127.0.0.1:4543/render
LILYPOND_RENDER_STRATEGY=local-first
```

Con eso el server usa el binario local cuando está disponible y sólo cae al servicio remoto si hace falta.
