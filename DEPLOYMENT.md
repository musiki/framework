# Deploy — Musiki Framework

Un solo camino. Si algo en otro documento contradice este, manda este.

## Regla corta

- **Framework**: `git push origin main`. El push deploya solo.
- **Contenido de un course** (s123, i1, i2, cym…): push al repo del course. Su workflow
  avisa al framework (`repository_dispatch`) y el framework se redeploya con el contenido nuevo.
- **Deploy manual** (sin commit nuevo): `./scripts/vps/deploy-framework.sh`.
- **Nunca** buildear ni reiniciar a mano en el VPS mientras puede estar corriendo un deploy.

## Cómo funciona

```
push framework/main ─┐
push de un course ───┼─▶ .github/workflows/sync-content-sources.yml
deploy-framework.sh ─┘       (runner self-hosted en el VPS, Node 24)
                             │
                             ├─ validate: npm ci + content:pull + assemble en seco
                             └─ deploy:  rsync del repo a /opt/musiki/framework
                                         └─▶ scripts/vps/deploy-framework-local.sh
```

`scripts/vps/deploy-framework-local.sh` es **el único script que deploya**. En orden:

1. Toma un lock (`flock /tmp/musiki-framework-deploy.lock`): dos deploys nunca corren a la vez.
2. `git reset --hard origin/main` en `/opt/musiki/framework`. Cambios hechos a mano en el
   VPS sobre archivos versionados **se pierden**.
3. `npm ci`, sólo si cambió `package-lock.json`.
4. **Migraciones**: `scripts/vps/db-migrate.sh`. Si fallan, corta acá y la build anterior sigue
   sirviendo. Emergencia: `VPS_SKIP_MIGRATIONS=1`.
5. Contenido: `content:pull --clean` + `content:assemble`.
6. Build en `dist_tmp/`. Si falla, `dist/` no se toca y producción sigue como estaba.
7. Swap `dist_tmp/` → `dist/` y `pm2 reload ecosystem.config.cjs`.

El workflow tiene `concurrency: content-sync` con `cancel-in-progress`: un push nuevo cancela
el deploy en curso y empieza otro.

## Ver qué pasó

```bash
gh run list --workflow sync-content-sources.yml --limit 5
gh run view <id> --log-failed
```

## Producción

| Qué | Dónde |
|---|---|
| VPS | `zz@46.225.154.68` (shell fish: usar `bash -lc '...'` por ssh) |
| Código | `/opt/musiki/framework` |
| App | proceso PM2 **`musiki-framework`**, puerto 4321 (`dist/server/entry.mjs`) |
| Otros procesos | `musiki-framework-dev` (4325), `musiki-content-bus` (4322) |
| Base | Postgres en Docker, contenedor `authentik-postgresql`, base `musiki26`, usuario `app` |
| Registro de migraciones | tabla `SchemaMigration` en `musiki26` |

No hay contenedor de la app: `docker restart devmusiki-app` no existe.

## Migraciones

Van en `postgres-patches/migrations/`, con nombre `AAAAMMDDhhmmss_descripcion.sql`, y las aplica
el deploy. Para mirarlas o repararlas a mano, desde tu máquina:

```bash
./scripts/db-migrate.sh --status            # aplicadas · pendientes
./scripts/db-migrate.sh --dry-run           # ensaya y revierte
./scripts/db-migrate.sh --unmark <archivo>  # vuelve a marcarla pendiente
```

## Emergencia: deploy sin GitHub

Sólo si GitHub Actions no anda. Usa el mismo script y el mismo lock:

```bash
ssh zz@46.225.154.68 "bash -lc 'cd /opt/musiki/framework && git fetch origin && git reset --hard origin/main && bash scripts/vps/deploy-framework-local.sh'"
```

## Problema conocido

Entre el 2026-10-18 y el 2026-11-07 el build fallaba seguido con `Maximum call stack size
exceeded` en `@shiguredo/rnnoise-wasm` (rollup, `commonjs--resolver`). El stack apuntaba a un
filtro regex de un hook de Vite (`pattern.test(code)`) corriendo sobre los 4,8 MB de ese archivo
(wasm en base64); por eso `--stack-size` no lo curaba. Desde entonces `RnnoiseProcessor.ts` lo
importa con `?url`: se copia tal cual como asset y no pasa por la cadena de transformación.
Si un paquete similar (un solo .js enorme) vuelve a romper el build, mismo remedio.
Cuando el build falla, producción sigue con la build anterior.
