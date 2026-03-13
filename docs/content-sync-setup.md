# Content Sync Setup (Repos por Materia -> Framework -> VPS)

Este setup permite que cada equipo docente trabaje en su repo de materia y que `musiki/framework` valide el ensamblado y luego reconstruya el sitio en tu VPS.

## 0) Crear el repo de materia

Si todavia no existe el repo de materia, usar primero el scaffold documentado en [docs/materia-repo-bootstrap.md](/Users/zztt/projects/26-musiki/framework/docs/materia-repo-bootstrap.md).

## 1) Configurar fuentes en framework

Editar `config/sources.manifest.json`:

- activar cada fuente con `"enabled": true`
- definir `"repo"` y `"branch"`
- durante bootstrap local se puede agregar tambien `"localPath": "../i1"` o `"../cym"` para usar el repo hermano antes de que exista el remoto
- usar `"contentRoot": "."` para repos de materia con el vault en la raiz del repo

Estructura esperada por repo de materia:

- `cursos/**` para contenido con login
- `public/**` para contenido publico
- `draft/**` para incubadora y materiales en preparacion

Reglas de promoción desde cursos a público:

- `visibility: public`
- `public_status: approved`
- `public_path: tema/ruta-del-articulo.md`
- `type: assignment`, `eval`, `lesson-presentation` y `app-dataviewjs` quedan excluidos del público aunque tengan flags

## 2) Workflow de framework (push/dispatch -> validate -> deploy en runner self-hosted)

Ya está agregado en `.github/workflows/sync-content-sources.yml`.

Se dispara en dos casos:

- `push` a `main` en `framework`
- `repository_dispatch` desde repos de materia como `i1`

Configuracion requerida en `musiki/framework`:

- `CONTENT_SOURCE_READ_TOKEN`: token con acceso de lectura a repos de materia (si son privados).
- runner self-hosted Linux con labels: `self-hosted`, `linux`, `x64`, `musiki-framework`
- `VPS_FRAMEWORK_DIR`: repo variable. Path del checkout productivo en el VPS.
- `VPS_GIT_BRANCH`: repo variable. Opcional, default `main`.
- `VPS_INSTALL_COMMAND`: repo variable. Opcional, default `npm ci`.
- `VPS_BUILD_COMMAND`: repo variable. Opcional, default `npm run build`.
- `VPS_RELOAD_COMMAND`: repo variable. Opcional. Ejemplo: `pm2 reload ecosystem.config.cjs --only musiki-framework --update-env && pm2 save`
- `VPS_CONTENT_SOURCE_STRATEGY`: repo variable o secret. Opcional, default `remote-only`.

Comandos usados por el workflow:

- `npm run content:pull -- --clean`
- `npm run content:assemble:dry`

Runtime del workflow:

- `Node 22`

El workflow no commitea `src/content`: valida el ensamblado en GitHub-hosted runner y luego ejecuta el deploy dentro del VPS mediante un runner self-hosted.

Notas importantes para el VPS:

- el workflow reenvia `CONTENT_SOURCE_READ_TOKEN` al proceso local del runner para que `content:pull` pueda leer repos privados durante el build
- por default usa `CONTENT_SOURCE_STRATEGY=remote-only` en el VPS para ignorar `localPath` y no copiar un repo hermano desactualizado como `../i1`
- el deploy automático ya no depende de abrir SSH desde internet hacia el VPS

## 3) Workflow en cada repo de materia (push -> dispatch)

Si no usaste el scaffold de materia, copiar `docs/templates/notify-platform-on-content-change.yml` a:

- `.github/workflows/notify-platform-on-content-change.yml`

Secret requerido en cada repo de materia:

- `PLATFORM_DISPATCH_TOKEN`: token con permiso para ejecutar `repository_dispatch` sobre `musiki/framework`.

Nota de bootstrap:

- si la fuente usa `localPath`, el sync local funciona de inmediato;
- `localPath` toma el working tree local actual, incluso si todavia no hay commits en el repo de materia;
- el workflow en GitHub necesitara que el repo remoto configurado en `"repo"` exista y sea accesible.

## Comandos locales útiles (framework)

- `npm run content:pull`
- `npm run content:watch`
- `npm run content:assemble:dry`
- `npm run content:assemble`

`content:assemble:dry` genera `.tmp/assembled-content` y el reporte `.tmp/assemble-report.json` sin tocar `src/content`.

## Watch local de contenido

Para evitar correr `content:pull` + `content:assemble` a mano en cada guardado, el framework ahora incluye:

- `npm run content:watch`

Este watcher:

- se activa solo cuando lo lanzas manualmente
- observa las fuentes locales configuradas con `localPath` en `config/sources.manifest.json`
- reacciona a eventos de filesystem (save, rename, delete), no a cada tecla del editor
- agrupa cambios rapidos con debounce de `1200ms` antes de correr sync
- ejecuta `content:pull` y luego `content:assemble`
- si llegan mas cambios mientras sync esta corriendo, encola una sola corrida adicional al final

Flags utiles:

- `npm run content:watch -- --no-initial` para no hacer el primer sync al arrancar
- `npm run content:watch -- --debounce 2000` para esperar 2 segundos de silencio antes de sincronizar
- `npm run content:watch -- --sources i1,cym` para vigilar solo algunas fuentes

Workflow local recomendado:

1. editar contenido en el repo de materia, por ejemplo `../i1/cursos/**`
2. en otra terminal, correr `npm run content:watch`
3. levantar Astro con `npm run dev`

De ese modo `src/content` sigue siendo generado, pero la regeneracion queda automatizada mientras trabajas.

Para el VPS:

- el build del framework corre `content:pull` + `content:assemble` antes de `astro build`
- el VPS necesita sus propios secrets/env para leer repos privados y hablar con Supabase/Auth
- cada cambio en `i1`, `i2`, `cym` o `s123` puede despachar al workflow del framework para disparar un nuevo sync
