# Content Collective Pattern

Este documento describe la arquitectura de "Contenido Vivo" (Live Content) implementada en Musiki para permitir actualizaciones instantáneas de los repositorios de materias sin necesidad de reconstruir (rebuild) el framework completo.

## 1. El Problema Estructural

Astro, por defecto, compila las colecciones de contenido durante el tiempo de construcción (`build-time`). Esto significa que:
- El Markdown se transforma en HTML y se guarda en una base de datos interna (`dist/`).
- Cambiar un archivo `.md` en `src/content/` no tiene efecto en el sitio de producción hasta que se ejecuta un nuevo `astro build`.
- Los builds completos de Musiki tardan ~3 minutos, lo que genera tiempos de inactividad y lentitud en el feedback pedagógico.

## 2. La Solución: Arquitectura Híbrida

Hemos separado el **Framework** (Astro Core) del **Contenido** (Markdown) mediante un renderizador dinámico en tiempo de ejecución.

### Flujo de Datos
1.  **Repositorio de Materia (i1, cym, etc.):** El profesor hace un `push`.
2.  **GitHub Action:** Detecta el cambio y envía un webhook seguro a Musiki.
3.  **Astro Bridge:** El framework recibe el webhook en `/api/webhook/content-update` y lo reenvía internamente al Content Bus.
4.  **Content Bus (Worker):** Un proceso independiente (Node.js) recibe la señal, descarga los cambios (`git pull`) y los ensambla en `src/content/cursos/`.
5.  **Runtime Rendering:** Cuando un alumno visita una lección, Astro lee el archivo `.md` directamente del disco y lo procesa al vuelo usando el mismo pipeline de plugins (LilyPond, Mermaid, Dataview).

## 3. Componentes Técnicos

### A. El Motor Dinámico (`src/lib/runtime-content.ts`)
Usa el stack `unified / remark / rehype` para replicar exactamente el procesamiento que Astro hace en el build, pero en cada petición SSR. Esto permite que el contenido sea "fresco" sin tocar la carpeta `dist/`.

### B. El Content Bus (`scripts/vps/content-bus.mjs`)
Es un orquestador de eventos que corre en el puerto `4322` bajo PM2. 
- **Estado en memoria:** Mantiene un objeto de estatus para el beacon visual del logo.
- **Request Coalescing:** Si recibe múltiples señales seguidas, las encola para no saturar el sistema con pulls simultáneos.
- **Atomicidad:** Usa el script `assemble-content.mjs` para mover los archivos de forma segura.

### C. El Beacon de Estado (`/api/internal/build-status`)
Este endpoint ahora consulta primero al Content Bus local. El logo de la plataforma refleja en tiempo real:
- `running`: Sincronización en curso.
- `ok`: Todo actualizado.
- `error`: Fallo en la última sincronización.

## 4. Beneficios Pedagógicos y Técnicos
- **Feedback Inmediato:** El profesor ve sus cambios en la web en < 5 segundos tras el push.
- **Cero Downtime:** El sitio nunca se cae por "building", ya que Astro siempre está corriendo.
- **Escalabilidad:** Podemos tener miles de documentos sin que el build del framework se vuelva pesado.
- **Estabilidad OAuth:** Al correr el framework en modo producción, los protocolos de seguridad (HTTPS/WWW) son consistentes.

## 5. Mantenimiento
Para actualizar el Framework (cambios en componentes o estilos), se requiere `npm run build`.
Para actualizar el Contenido (lecciones o tareas), no se requiere ninguna acción manual; el sistema es totalmente automático.
