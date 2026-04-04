# GitHub tokens and secrets

Inventario operativo de tokens, secrets y variables ligados al sync de contenido, Actions y runtime de `musiki/framework`.

Este documento separa dos circuitos que hoy conviven:

- `repository_dispatch` hacia `musiki/framework`
- webhook al `content-bus` vía `/api/webhook/content-update`

La mayor fuente de confusión venía de mezclar ambos como si usaran los mismos secrets. No los usan.

## Diagnóstico actual

Al 3 de abril de 2026, la foto útil es esta:

- El `gh auth status` del shell local está roto: el `GITHUB_TOKEN` cargado para `gh` ya no es válido.
- El `CONTENT_SOURCE_READ_TOKEN` del `.env` local responde bien contra `musiki/framework`, `musiki/i1`, `musiki/i2`, `musiki/s123`, `musiki/cym` y lectura de runs del workflow del framework.
- El `PLATFORM_DISPATCH_TOKEN` del `.env` local responde bien contra `musiki/framework`. Eso es suficiente para `repository_dispatch`; no necesita ver `i1` o `s123`.
- En el VPS existe otra copia de `CONTENT_SOURCE_READ_TOKEN` dentro de `/opt/musiki/framework/.env`.
- `scripts/pull-sources.mjs` estaba cargando `.env` de forma agresiva y pisando variables inyectadas por GitHub Actions. Eso ya quedó corregido para respetar primero `process.env`.
- El `content-bus` está online en `127.0.0.1:4322`.
- La bridge pública `POST /api/webhook/content-update` responde y reenvía correctamente al `content-bus`.
- Los workflows de materias que usan el `content-bus` aparecen en `success`, asi que el problema no esta en que GitHub Actions de esos repos no arranque.

## Tabla de secretos

### 1. `CONTENT_SOURCE_READ_TOKEN`

Uso:

- `scripts/pull-sources.mjs`
- workflow `framework/.github/workflows/sync-content-sources.yml`
- `src/lib/github-app.ts`
- editor docente cuando lee/escribe en repos fuente

Dónde debe existir:

- secret del repo `musiki/framework` en GitHub Actions
- `.env` local de `framework`
- `.env` del VPS si quieres fallback manual fuera de Actions

Permisos mínimos recomendados:

- fine-grained PAT
- repos permitidos: `musiki/framework`, `musiki/i1`, `musiki/i2`, `musiki/s123`, `musiki/cym` y cualquier otra materia activa
- `Contents: Read`
- opcional: `Actions: Read` si también lo reutilizas para auditorías con `gh`

Notas:

- este es el token crítico para que `content:pull` pueda clonar o actualizar repos privados de materias
- si el runner inyecta un token nuevo pero el `.env` del VPS conserva uno viejo, el loader antiguo podía terminar usando el viejo

### 2. `PLATFORM_DISPATCH_TOKEN`

Uso:

- solo cuando un repo de materia dispara `repository_dispatch` sobre `musiki/framework`

Dónde debe existir:

- secret en cada repo de materia que use el flujo `repository_dispatch`

Permisos mínimos recomendados:

- fine-grained PAT
- repo permitido: `musiki/framework`
- `Contents: Write`

Notas:

- no necesita acceso a `i1`, `i2`, `s123` o `cym`
- sirve para el flujo GitHub -> GitHub, no para el `content-bus`

### 3. `CONTENT_BUS_SECRET`

Uso:

- workflow `notify-platform-on-content-change.yml` de los repos de materia
- `scripts/vps/content-bus.mjs`
- bridge pública `POST /api/webhook/content-update`

Dónde debe existir:

- secret en cada repo de materia que notifique al `content-bus`
- `.env` del VPS donde corre `musiki-framework` y `musiki-content-bus`

Permisos mínimos recomendados:

- no es un token de GitHub
- es solo un bearer secret compartido

Notas:

- este es el secret correcto para el template actual de `notify-platform-on-content-change.yml`
- si falta o no coincide entre repo de materia y VPS, el workflow va a pegar `401` o `403`

### 4. `GITHUB_STATUS_TOKEN`

Uso:

- fallback de `src/pages/api/internal/build-status.ts` cuando el `content-bus` local no responde

Dónde debe existir:

- `.env` local o del VPS de `framework`

Permisos mínimos recomendados:

- repo `musiki/framework`
- `Actions: Read`

Notas:

- es opcional
- el circuito principal del beacon hoy debería salir del `content-bus` local

### 5. `GITHUB_TOKEN` y `GH_TOKEN`

Uso:

- shell local
- `gh` CLI

Notas:

- hoy no conviene confiar en `GITHUB_TOKEN` del shell porque el `gh auth status` reportó token inválido
- para trabajos manuales con `gh`, usa `GH_TOKEN=<token-válido> gh ...` o reautentica `gh`

## Qué usa cada flujo

### A. Full CI / deploy del framework

Camino:

- push a `musiki/framework`
- o `repository_dispatch` hacia `musiki/framework`
- workflow `sync-content-sources.yml`
- runner self-hosted en VPS

Necesita:

- `CONTENT_SOURCE_READ_TOKEN`
- variables del runner VPS: `VPS_FRAMEWORK_DIR`, `VPS_GIT_BRANCH`, `VPS_INSTALL_COMMAND`, `VPS_CONTENT_SOURCE_STRATEGY`

Opcionales:

- `GITHUB_STATUS_TOKEN`

### B. Hot-sync de contenido y beacon

Camino:

- push a `musiki/i1`, `musiki/s123`, etc.
- workflow `notify-platform-on-content-change.yml`
- `POST https://www.musiki.org.ar/api/webhook/content-update`
- bridge Astro
- `content-bus` local en `127.0.0.1:4322`

Necesita:

- `CONTENT_BUS_SECRET`

No necesita:

- `PLATFORM_DISPATCH_TOKEN`
- `CONTENT_SOURCE_READ_TOKEN` en el repo de materia

## Variables y secrets que hoy sobran o generan ruido

- `VERCEL_DEPLOY_HOOK_URL`: no aparece en el workflow actual self-hosted de `sync-content-sources.yml`; quedó más bien como resto del circuito anterior hacia Vercel.
- `GITHUB_TOKEN` en el shell local: hoy mete ruido porque `gh` lo toma primero y está vencido/inválido.
- `PLATFORM_DISPATCH_TOKEN` en repos que solo usan el webhook del `content-bus`: no rompe nada, pero no participa del flujo real.

## Auditoría automática

Desde `framework/`:

```bash
npm run github:tokens:audit
```

Ese script:

- indica si `gh` local está autenticado o roto
- verifica si existen `CONTENT_SOURCE_READ_TOKEN`, `PLATFORM_DISPATCH_TOKEN`, `GITHUB_STATUS_TOKEN` y `GITHUB_TOKEN`
- prueba contra la API de GitHub qué repos y workflows puede leer cada token
- no imprime los valores de los tokens

## Rotación con `gh`

Primero, arreglar el login del CLI:

```bash
gh auth logout -h github.com
gh auth login
```

Si prefieres no tocar el login global:

```bash
GH_TOKEN="<token-con-permisos-admin-en-los-repos>" gh auth status
```

### Actualizar el secret lector del framework

```bash
TOKEN=$(node -e "const fs=require('fs');const line=fs.readFileSync('.env','utf8').split(/\\r?\\n/).find(l=>l.startsWith('CONTENT_SOURCE_READ_TOKEN='));process.stdout.write((line||'').split('=').slice(1).join('=').replace(/^['\\\"]|['\\\"]$/g,''));")
gh secret set CONTENT_SOURCE_READ_TOKEN -R musiki/framework -b"$TOKEN"
```

### Actualizar el secret del `content-bus` en materias

```bash
SECRET=$(node -e "const fs=require('fs');const line=fs.readFileSync('.env','utf8').split(/\\r?\\n/).find(l=>l.startsWith('CONTENT_BUS_SECRET='));process.stdout.write((line||'').split('=').slice(1).join('=').replace(/^['\\\"]|['\\\"]$/g,''));")
for repo in musiki/i1 musiki/i2 musiki/cym musiki/s123; do
  gh secret set CONTENT_BUS_SECRET -R "$repo" -b"$SECRET"
done
```

### Actualizar el token de `repository_dispatch` en materias

Solo si realmente usas ese flujo:

```bash
TOKEN=$(node -e "const fs=require('fs');const line=fs.readFileSync('.env','utf8').split(/\\r?\\n/).find(l=>l.startsWith('PLATFORM_DISPATCH_TOKEN='));process.stdout.write((line||'').split('=').slice(1).join('=').replace(/^['\\\"]|['\\\"]$/g,''));")
for repo in musiki/i1 musiki/i2 musiki/cym musiki/s123; do
  gh secret set PLATFORM_DISPATCH_TOKEN -R "$repo" -b"$TOKEN"
done
```

## Recomendación de orden

1. Reautenticar `gh` o exportar un `GH_TOKEN` válido para administración.
2. Rotar `CONTENT_SOURCE_READ_TOKEN` en `musiki/framework` si quieres unificar lo que usa local, GitHub Actions y VPS.
3. Confirmar que `CONTENT_BUS_SECRET` coincida entre VPS e `i1`/`i2`/`cym`/`s123`.
4. Dejar `PLATFORM_DISPATCH_TOKEN` solo donde realmente se use.
5. Correr `npm run github:tokens:audit` después de cada cambio.
