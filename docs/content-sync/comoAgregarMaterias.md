# Como agregar materias a Musiki

Manual operativo para sumar una materia nueva al circuito:

- repo/vault de Obsidian por materia
- GitHub repo con Actions
- `musiki/framework` como ensamblador y deployer
- VPS con `content-bus`

Si sigues este orden, la primera corrida ya deberia publicar la materia correcta sin quedar un commit atras.

## 0. Preflight

Antes de crear nada, define estas piezas:

- `subject-slug`: por ejemplo `i2`, `cym`, `s123`
- nombre de la materia
- visibilidad del repo: publico o privado
- team docente que va a quedar en `CODEOWNERS`
- si la materia va a vivir en `cursos/<slug>/`

Checklist minimo:

- el repo remoto debe llamarse `musiki/<slug>`
- la rama principal debe ser `main`
- el framework debe poder leer ese repo si es privado
- la materia debe tener un `_index.md` con `type: course` e `id: <slug>`

## 1. Crear el repo local de materia

Desde `framework/`, usa el scaffold:

```bash
npm run repo:materia:new -- \
  --target ../i2 \
  --subject-name "Instrumento II" \
  --subject-slug i2 \
  --course-title "Instrumento II" \
  --course-id i2 \
  --org musiki \
  --platform-owner musiki \
  --platform-repo framework \
  --teachers-team @musiki/docentes-i2 \
  --editorial-team @musiki/editorial \
  --devs-team @musiki/devs
```

El scaffold deja:

- `README.md`
- `CODEOWNERS`
- `.github/workflows/notify-platform-on-content-change.yml`
- `.github/pull_request_template.md`
- `cursos/<slug>/`
- `public/`
- `draft/`
- `.obsidian/`

Si ya tienes un vault existente, no hace falta recrearlo entero: basta con copiar o adaptar esos archivos de gobernanza y dejar la estructura compatible.

## 2. Preparar el vault en Obsidian

Abre el repo como vault de Obsidian y verifica:

- `cursos/<slug>/_index.md` existe
- `public/` existe para material publico
- `draft/` existe para incubacion y aportes estudiantiles
- `.obsidian/` queda versionado solo en lo que realmente quieras compartir

Frontmatter minimo recomendado en `cursos/<slug>/_index.md`:

```md
---
type: course
title: "Instrumento II"
description: Breve descripcion
id: i2
public: false
coverImage: https://...
---
```

Reglas del contenido:

- `cursos/**`: material de aula, privado o autenticado
- `public/**`: material publicable y editorializado
- `draft/**`: borradores, pruebas, trabajos estudiantiles

Si quieres promocionar algo desde `cursos/**` a `public/**`, usa los flags del flujo actual:

- `visibility: public`
- `public_status: approved`
- `public_path: ruta/del/archivo.md`

## 3. Crear el repo en GitHub y subirlo

### En browser

1. GitHub -> `musiki` -> `New repository`
2. Nombre: el slug de la materia, por ejemplo `i2`
3. Elige publico o privado
4. No hace falta inicializar con README si ya tienes el repo local
5. Crea el repo

### Desde terminal

Dentro del repo de materia:

```bash
git init
git branch -M main
git remote add origin https://github.com/musiki/i2.git
git add .
git commit -m "Bootstrap materia"
git push -u origin main
```

## 4. Workflow de Actions de la materia

El archivo vive en:

- `.github/workflows/notify-platform-on-content-change.yml`

Que hace:

- se dispara en `push` a `main`
- escucha cambios en `cursos/**`, `public/**`, `draft/**`, `CODEOWNERS` y en el propio workflow
- manda un `POST` a `https://www.musiki.org.ar/api/webhook/content-update`
- envia `source_repo`, `source_sha` y `source_ref`
- eso despierta el `content-bus` del VPS, que vuelve a correr `content:pull`, `content:assemble`, build y reload del framework

Hoy este es el flujo canonico. `repository_dispatch` queda como opcion legacy, no como camino principal.

## 5. Registrar la materia en framework

Editar [config/sources.manifest.json](/Users/zztt/projects/26-musiki/framework/config/sources.manifest.json) y agregar o activar una entrada asi:

```json
{
  "id": "i2",
  "enabled": true,
  "repo": "musiki/i2",
  "branch": "main",
  "contentRoot": ".",
  "localPath": "../i2"
}
```

Notas:

- `enabled: true` la mete en el sync real
- `repo` es lo que usa el VPS y GitHub Actions
- `localPath` sirve para desarrollo local con repos hermanos
- si el repo es privado, el token lector del framework tiene que incluirlo

Orden recomendado:

1. push de `framework` con el manifest actualizado
2. push del repo de materia con workflow y contenido

Asi, la primera notificacion del `content-bus` ya encuentra la materia activada.

## 6. Secrets necesarios

### A. `CONTENT_BUS_SECRET`

Es el secret principal del repo de materia.

Se usa en:

- `.github/workflows/notify-platform-on-content-change.yml`
- `scripts/vps/content-bus.mjs` en el framework

Debe coincidir entre:

- repo de materia
- `/opt/musiki/framework/.env` en el VPS

### Cargarlo con `gh`

Desde `framework/`:

```bash
SECRET=$(node -e "const fs=require('fs');const line=fs.readFileSync('.env','utf8').split(/\\r?\\n/).find(l=>l.startsWith('CONTENT_BUS_SECRET='));process.stdout.write((line||'').split('=').slice(1).join('=').replace(/^['\\\"]|['\\\"]$/g,''));")
gh secret set CONTENT_BUS_SECRET -R musiki/i2 -b"$SECRET"
```

Para varias materias:

```bash
SECRET=$(node -e "const fs=require('fs');const line=fs.readFileSync('.env','utf8').split(/\\r?\\n/).find(l=>l.startsWith('CONTENT_BUS_SECRET='));process.stdout.write((line||'').split('=').slice(1).join('=').replace(/^['\\\"]|['\\\"]$/g,''));")
for repo in musiki/i1 musiki/i2 musiki/cym musiki/s123; do
  gh secret set CONTENT_BUS_SECRET -R "$repo" -b"$SECRET"
done
```

### Cargarlo en browser

1. Abrir el repo de materia en GitHub
2. `Settings`
3. `Secrets and variables`
4. `Actions`
5. `New repository secret`
6. Nombre: `CONTENT_BUS_SECRET`
7. Pegar el mismo valor que usa el VPS
8. Guardar

### B. `CONTENT_SOURCE_READ_TOKEN`

Es el token que usa `musiki/framework` para leer repos de materias durante `content:pull`.

Cuando hace falta tocarlo:

- cuando agregas una materia privada nueva
- cuando rotas el PAT fine-grained

Permiso minimo recomendado:

- Fine-grained PAT del usuario `zzigo`
- `Resource owner`: `musiki`
- acceso al repo `musiki/framework`
- acceso a cada repo de materia privada que el framework tenga que leer
- `Contents: Read`
- opcional `Actions: Read`

### Crear o renovar el PAT en browser

1. GitHub avatar -> `Settings`
2. `Developer settings`
3. `Personal access tokens`
4. `Fine-grained tokens`
5. `Generate new token`
6. `Resource owner`: `musiki`
7. `Repository access`: `Only select repositories`
8. Seleccionar `framework` y las materias privadas activas
9. Permisos: `Contents: Read`
10. Guardar y copiar el token

### Guardarlo como secret en `musiki/framework` con `gh`

```bash
gh secret set CONTENT_SOURCE_READ_TOKEN -R musiki/framework
```

`gh` te pedira pegar el token por stdin, o puedes pasarlo con `-b`.

### Guardarlo en browser

1. Abrir `musiki/framework`
2. `Settings`
3. `Secrets and variables`
4. `Actions`
5. `New repository secret`
6. Nombre: `CONTENT_SOURCE_READ_TOKEN`
7. Pegar el PAT
8. Guardar

Si tambien usas fallback manual en el VPS, actualiza `/opt/musiki/framework/.env`.

### C. `PLATFORM_DISPATCH_TOKEN`

Opcional. Solo hace falta si decides mantener un workflow legacy por `repository_dispatch`.

Si no hay un workflow que le pegue a la API de GitHub para disparar `repository_dispatch`, puedes omitirlo.

## 7. Archivos de gobernanza que no conviene olvidar

- `README.md`: explica estructura y secrets
- `CODEOWNERS`: define revisores de `public/`, `cursos/`, `draft/` y automation
- `.github/pull_request_template.md`: baja el margen de error editorial

Si duplicas una materia existente para arrancar rapido, revisa estos campos para no dejar basura copiada:

- nombre real de la materia
- `cursos/<slug>/`
- team docente en `CODEOWNERS`
- slug del repo
- referencias a `musiki/framework`

## 8. Validacion local antes del push final

Desde `framework/`:

```bash
npm run content:pull -- --clean
npm run content:assemble:dry
```

Esto confirma:

- que el manifest esta bien
- que el framework puede leer el repo
- que el contenido ensambla sin romper `src/content`

## 9. Verificacion en GitHub y produccion

Despues del push del repo de materia:

1. mirar el workflow `Notify Platform Content Sync (Content Bus)` en ese repo
2. confirmar que termine en `success`
3. revisar el beacon publico:

```bash
curl -s https://www.musiki.org.ar/api/internal/build-status
```

Esperado:

- durante el build: `state=running`, `mode=content-bus`
- al terminar: `state=ok`

Para revisar desde `gh`:

```bash
gh run list -R musiki/i2 --workflow "Notify Platform Content Sync (Content Bus)" --limit 5
gh run list -R musiki/framework --workflow "Sync Content Sources" --limit 5
```

## 10. Checklist corto

- repo creado en `musiki/<slug>`
- `cursos/<slug>/_index.md` listo
- workflow `.github/workflows/notify-platform-on-content-change.yml` presente
- `CONTENT_BUS_SECRET` cargado en el repo
- si la materia es privada, `CONTENT_SOURCE_READ_TOKEN` del framework incluye ese repo
- `config/sources.manifest.json` activado en `framework`
- `content:assemble:dry` pasa localmente
- push de `framework`
- push de la materia
- workflow de la materia en `success`
- beacon publico en `ok`
