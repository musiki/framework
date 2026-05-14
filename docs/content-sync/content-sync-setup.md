# Content Collective Pattern & Sync Setup

_Última actualización: 2026-04-16_

> Actualizacion estrategica 2026-05-14: este documento describe el flujo vigente basado en repos/vaults Markdown y GitHub Actions. Para el refactor de workspace, este flujo pasa a ser un mecanismo de autoría, espejo, export/import y backup. La fuente de verdad futura para recursos, snapshots y texto de cursos sera Postgres, con Markdown/YAML como mirror portable para Obsidian. Ver [Musiki Class Workspace Refactor](../architecture/class-workspace-refactor.md).

Este documento describe la arquitectura de sincronización de contenido implementada en Musiki para que los repositorios de materias actualicen la producción de forma automatizada, sin pasos manuales sobre el VPS. 

Este setup asegura que el entorno de despliegue principal (`framework`) orqueste los contenidos (los `cursos`) independientemente.

---

## 1. El Problema Estructural y la Solución Vigente

Astro, por defecto, compila las colecciones de contenido durante el tiempo de construcción (`build-time`). Esto significa que:
- El Markdown se transforma en HTML y se guarda en una base de datos interna o carpeta estática (`dist/`).
- Cambiar un archivo `.md` en `src/content/` no tiene efecto en el sitio de producción hasta que se ejecuta un nuevo `astro build`.
- Los builds completos de Musiki tardan algunos minutos, lo que genera interrupciones si no se maneja correctamente.

**La Solución: Orquestación Híbrida y Cero Downtime**
Hemos separado la **autoría** del contenido (repos de materias) del **runtime** del framework y orquestado las notificaciones a través de un bus en el servidor.

Esta solucion sigue siendo valida para el contenido que todavia vive como Markdown en repositorios de materia. No debe ampliarse como fuente de verdad para el nuevo workspace. El nuevo contrato sera:

- Postgres: identidad canonica, texto, metadata, permisos, versiones y relaciones.
- R2: blobs y artifacts pesados.
- Markdown/YAML: mirror legible para Obsidian, import/export y backup.
- GitHub Actions: respaldo/deploy/export, no runtime live-state.

**Flujo de Datos (Workflow):**
1. **Repositorio de Materia (p.ej: i1, cym, s123):** El profesor aprueba y hace un `push` a su repositorio.
2. **GitHub Action:** Detecta el cambio y envía un webhook seguro a Musiki.
3. **Astro Bridge:** El framework (público) recibe el webhook en `/api/webhook/content-update` y lo reenvía internamente al Content Bus (privado).
4. **Content Bus (Worker):** Un proceso independiente (Node.js) recibe la señal localmente y ejecuta el deploy del framework (`content:pull`, `content:assemble`, `astro build`, y un swap atómico de `dist`).
5. **Producción:** El sitio queda actualizado sin `ssh` manual ni `git pull` interactivo.

---

## 2. Componentes Técnicos Principales

### A. El Content Bus (`scripts/vps/content-bus.mjs`)
Es un orquestador de eventos remoto que corre en el puerto `4322` bajo PM2.
- **Estado en memoria:** Mantiene un objeto de estatus que se consume desde la plataforma cliente (`/api/internal/build-status`).
- **Request Coalescing:** Si recibe múltiples notificaciones seguidas, encola las corridas para no saturar al VPS con builds paralelos.
- **Deploy y Atomicidad:** Construye siempre en el directorio `dist_tmp` y recién cuando la compilación es exitosa intercambia `dist` y recarga PM2.

### B. El Beacon de Estado Visual
Los estudiantes y profesores ven el estado de sincronización directamente en el logo principal de la Navbar (Brand Icon):
- 🟣 **Violeta pulsante:** Sincronización en curso disparada por una actualización de **curso** (Materia).
- 🟡 **Amarillo pulsante:** Actualización estructural en curso disparada por el **framework**.
- 🟢 **Verde lumínico:** Todo actualizado (Build Exitoso o `ok`).
- 🔴 **Rojo lumínico:** Fallo en la sincronización del contenido (`error`).

---

## 3. Configuración para Nuevas Materias

Si vas a agregar una nueva materia a este ecosistema, seguí estos pasos:

### 3.1 Crear el repositorio y Vault
Si el repositorio aún no existe, usar primero el scaffold detallado en [docs/materia-repo-bootstrap.md](./materia-repo-bootstrap.md). 
La estructura esperada es:
- `cursos/**` (contenido privado/login requiredo)
- `public/**` (contenido desprotegido)
- `draft/**` (no incluido, incubadora)

### 3.2 Configurar fuentes en Framework
Editar `config/sources.manifest.json` y agregar tu materia:
```json
{
  "id": "s123",
  "enabled": true,
  "repo": "musiki/s123",
  "branch": "main",
  "contentRoot": ".",
  "localPath": "../s123"
}
```

### 3.3 GitHub Action en la Materia (Notifier)
Dentro del repositorio del curso, crear `.github/workflows/notify-platform-on-content-change.yml` (se puede copiar desde `docs/templates/`).
Debe inyectar como mínimo tu secret `CONTENT_BUS_SECRET`.

> [!WARNING]
> En la llamada de `curl`, es **obligatorio** el uso del parámetro `-L` para seguir las redirecciones HTTP por Caddy en el VPS. Si no está, el build fallará de forma silenciosa (verbleshooting abajo).

---

## 4. Configuración del VPS (Framework Runtime)

### Secretos Necesarios:
- `CONTENT_SOURCE_READ_TOKEN`: Token (Fine-grained PAT) con lectura sobre los repositorios de las materias.
- `VPS_FRAMEWORK_DIR`, `VPS_INSTALL_COMMAND`, `VPS_CONTENT_SOURCE_STRATEGY`.

Este workflow (disparado con un Action de Push al framework) tampoco modifica `src/content`: el runner self-hosted sincroniza el checkout por `rsync`. En el VPS, `CONTENT_SOURCE_STRATEGY` en `remote-only` se asegura de que descarguemos directo desde Github sin buscar rutas locales (`../i1`).

### Comandos Locales / Modo Desarrollo
Cuando escribas notas localmente, no tenes que esperar al Github Action.
- `npm run content:pull`: Descarga todos los repositorios hermanos en `.content-sources`.
- `npm run content:assemble`: Arma la carpeta `.tmp/assembled-content`.
- **`npm run content:watch`**: (Recomendado). Agrupa re-ensamblados de guardados sucesivos con "debounce" para experiencia de autoría instantánea en tu PC. 

---

## 5. Historial de Problemas Conocidos (Troubleshooting)

### 2026-04-16: El Webhook de clase devolvía Success pero en el VPS no se veían cambios
**Síntoma:** El Github Action del repositorio del curso marcaba éxito ("notify-platform succeeded in 3s") usando el comando inicial `curl https://www.musiki.org.ar/api/...`. Sin embargo el VPS nunca iniciaba la compilación en el servidor, y localmente no se reportaba error.

**Causa:** Caddy interceptaba la request hacia subdominio `www.` y respondía con código `301 Moved Permanently` redireccionando hacia el dominio raíz `musiki.org.ar`. Como el comando `curl` original no tenía el flag `-L` de *siguiente redirección*, procesaba el `301` simplemente como exitoso y terminaba el script botando el paquete POST JSON antes de llegar verdaderamente a Astro.

**Solución:** Se corrigió en los templates ubicados en `/framework/docs/templates/notify-platform-on-content-change.yml` haciendo dos cosas:
1. Usando explícitamente `https://musiki.org.ar/api...` (Dominio sin WWW).
2. Agregando explícitamente `-L` al comando `curl` dentro del Action de GitHub (`curl -sS -L --fail-with-body ...`) para que siga consistentemente cualquier configuración de red en el futuro y entregue sí o sí el Payload.

### 2026-04-16: PM2 no levantaba `musiki-content-bus` y Astro arrojaba HTTP 500
**Síntoma:** Aunque el Curl con `-L` empezó a llegar a la API de Astro `/api/webhook/content-update`, la API respondía `HTTP 500: Internal Bridge Error (TypeError: fetch failed)`. Al verificar `pm2 status` en el VPS, `musiki-content-bus` estaba desaparecido de la tabla de procesos.

**Causa:** Un error de tipo "Temporal Dead Zone" (ZTD) en Node.js ES Modules. En `scripts/vps/content-bus.mjs` se intentaba invocar `getFrameworkCommit()` dentro de la inicialización de la variable `let status = { ... }`, pero la función estaba declarada más abajo bajo un contexto de constante (`const getFrameworkCommit = () => {}`). En ES Modules, esto lanza una excepción `ReferenceError: Cannot access 'X' before initialization`, matando el proceso de pm2 de forma instantánea al reinicio.

**Solución:** Se movió la declaración funcional de `getFrameworkCommit` arriba del objeto `status` en `content-bus.mjs` para garantizar que la ejecución top-level la encuentre ya inicializada en memoria. Luego se reinició el servicio localmente con `pm2 start ecosystem.config.cjs --only musiki-content-bus`.
