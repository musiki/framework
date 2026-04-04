# 2026-03-13

## Estado del Sistema

- **CPU:** Load Average `3.09, 3.58, 3.76` (Carga alta durante despliegue).
- **RAM:** 7.8GiB Total | 5.3GiB Usada | 1.5GiB Libre. (Astro consume picos de 2GiB en build).
- **Disco:** 96G Total | 51G Usado (54% de ocupación).
- **Ports:** Caddy (80/443), SSH (22), Ollama (11434), LilyPond (4543), Fastify (8787).

## Servicios Críticos

| Servicio | Estado | Nota |
| :--- | :--- | :--- |
| Caddy | Running | Proxy reverso OK. |
| PM2 | Stopped/Missing | `musiki-framework` no aparece en `pm2 status`. |
| Ollama | Running | Servicio local activo. |
| GitHub Runner | Running | `musiki-vps-runner` activo y conectado. |

## Análisis de Performance

### ### PRO
- **Memoria amplia:** 8GB es generoso para un sitio Astro + Ollama, permite picos de procesamiento.
- **HD saludable:** 54% de uso deja margen para logs y backups de base de datos.
- **Redundancia:** Swap de 8GB configurado para evitar crashes fatales por Out-Of-Memory.

### ### CONS (Mejoras)
- **Zero Downtime:** El despliegue actual corre `npm run build` directamente en el VPS, lo que bloquea el sistema.
- **PM2 Context:** Hay una inconsistencia entre el runner y el usuario de sistema; el runner no está levantando PM2 correctamente.
- **Node/Action Warnings:** Warnings de deprecación en los runners de GitHub (ajustar a Node 22+).

---
*Trackeo ##2026-03-13: Migración exitosa a Self-Hosted Runner. Despliegue funcional pero con alto tiempo de inactividad durante la construcción.*

# 2026-04-04

## Estado del Sistema

- **Host:** `vps2`
- **CPU:** Load Average `1.21, 1.51, 1.69` (estable, sin saturacion visible).
- **RAM:** `15GiB` total | `3.7GiB` usada | `1.2GiB` libre | `11GiB` available.
- **Swap:** `0B` configurada.
- **Disco:** `/` con `150G` total | `72G` usado | `73G` disponible (`50%`).
- **Puertos:** Caddy (`80/443`), SSH (`22`), Ollama (`11434`), LilyPond (`4543`), Fastify (`8787`), Musiki (`4321/4322`), Trawun (`4000`).
- **App actual:** `/opt/trawun` sirviendo `HTTP 200` en `127.0.0.1:4000` bajo PM2.

## Servicios Criticos

| Servicio | Estado | Nota |
| :--- | :--- | :--- |
| Caddy | Running | Proxy reverso activo en `80/443`. |
| PM2 | Running | `pm2-zz.service` esta `enabled` y `active`. |
| Trawun | Running | `trawun` corre bajo PM2 (`online`, restart count `0` tras limpieza del supervisor duplicado). |
| `trawun.service` | Disabled | Se deshabilito para evitar `EADDRINUSE` en `:4000` contra PM2. |
| Ollama | Running | Servicio local activo en `11434`. |
| GitHub Runner (`trawun`) | Running | `actions.runner.zzigo-trawun.trawun-vps-runner.service` quedo `enabled` y `active`; la run `23975376155` completo `success`. |
| GitHub Runner (`musiki`) | Degradado | La sesion legacy sigue viva via `./run.sh`, mientras la unidad `actions.runner.musiki-framework.musiki-vps-runner.service` queda `inactive` por `SessionConflictException`. |

## Analisis de Performance

### ### PRO
- **Capacidad holgada:** RAM y disco tienen margen suficiente para `trawun` y los servicios ya alojados.
- **Supervisor unificado:** `trawun` ya no compite entre `systemd` y PM2; el puerto `4000` pertenece al proceso gestionado por PM2.
- **Persistencia tras reboot:** `pm2-zz.service` esta activo y habilitado, asi que el dump de PM2 deberia restaurar `trawun`.

### ### CONS (Mejoras)
- **Sin swap:** el servidor no tiene swap configurada; si coinciden builds, PM2 y procesos pesados, el margen ante picos baja.
- **Deuda tecnica en runners legacy:** `trawun` ya tiene runner dedicado y funcional, pero el runner viejo de `musiki` sigue fuera de `systemd`.
- **Conflicto heredado en musiki:** la unidad `actions.runner.musiki-framework.musiki-vps-runner.service` continua inactiva por `SessionConflictException`, asi que conviene normalizarla para evitar sorpresas tras reboot.

---
*Trackeo ##2026-04-04: Trawun quedo estabilizado bajo PM2, sin vulnerabilidades npm activas y con runner self-hosted propio en estado operativo. La deuda pendiente queda acotada al runner legacy de `musiki`.*
