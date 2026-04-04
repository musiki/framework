# Content Collective Pattern

Este documento describe la arquitectura de sincronización de contenido implementada en Musiki para que los repositorios de materias actualicen producción sin pasos manuales sobre el VPS.

## 1. El Problema Estructural

Astro, por defecto, compila las colecciones de contenido durante el tiempo de construcción (`build-time`). Esto significa que:
- El Markdown se transforma en HTML y se guarda en una base de datos interna (`dist/`).
- Cambiar un archivo `.md` en `src/content/` no tiene efecto en el sitio de producción hasta que se ejecuta un nuevo `astro build`.
- Los builds completos de Musiki tardan ~3 minutos, lo que genera tiempos de inactividad y lentitud en el feedback pedagógico.

## 2. La Solución: Orquestación Híbrida

Hemos separado la **autoría** del contenido (repos de materias) del **runtime** del framework, y automatizado el deploy local del VPS para que el rebuild ocurra sin intervención manual.

### Flujo de Datos
1.  **Repositorio de Materia (i1, cym, etc.):** El profesor hace un `push`.
2.  **GitHub Action:** Detecta el cambio y envía un webhook seguro a Musiki.
3.  **Astro Bridge:** El framework recibe el webhook en `/api/webhook/content-update` y lo reenvía internamente al Content Bus.
4.  **Content Bus (Worker):** Un proceso independiente (Node.js) recibe la señal y ejecuta el deploy local del framework: `content:pull`, `content:assemble`, sync de base, `astro build`, swap atómico de `dist` y `pm2 reload`.
5.  **Producción:** El sitio queda actualizado sin `ssh` manual ni `git pull` interactivo dentro del directorio vivo.

## 3. Componentes Técnicos

### A. El Motor de Build y Runtime
Musiki sigue necesitando `astro build` para materializar cambios en colecciones, índices y bundles. La diferencia es que ese build ahora queda automatizado tanto para pushes de `framework` como para pushes de repos de materia.

### B. El Content Bus (`scripts/vps/content-bus.mjs`)
Es un orquestador de eventos que corre en el puerto `4322` bajo PM2. 
- **Estado en memoria:** Mantiene un objeto de estatus para el beacon visual del logo.
- **Request Coalescing:** Si recibe múltiples señales seguidas, las encola para no saturar el sistema con pulls simultáneos.
- **Deploy unificado:** Invoca el mismo script local de deploy que usa el workflow del framework.
- **Atomicidad:** El deploy construye en `dist_tmp` y recién al final intercambia directorios y recarga PM2.

### C. El Beacon de Estado (`/api/internal/build-status`)
Este endpoint ahora consulta primero al Content Bus local. El logo de la plataforma refleja en tiempo real:
- `running`: Sincronización en curso.
- `ok`: Todo actualizado.
- `error`: Fallo en la última sincronización.

## 4. Beneficios Pedagógicos y Técnicos
- **Sin pasos manuales:** El profesor no necesita entrar al VPS para disparar pulls o rebuilds.
- **Cero Downtime:** El sitio sigue sirviendo mientras el nuevo build se prepara en `dist_tmp`.
- **Un solo camino operativo:** Cursos y framework comparten el mismo script de deploy local.
- **Estabilidad OAuth:** Al correr el framework en modo producción, los protocolos de seguridad (HTTPS/WWW) son consistentes.

## 5. Mantenimiento
Para actualizar el Framework (cambios en componentes o estilos), alcanza con `push` a `main`: el runner self-hosted despliega el checkout ya recibido por GitHub Actions.
Para actualizar el Contenido (lecciones o tareas), el webhook de materias dispara el mismo deploy local automáticamente.
