# VPS EVAL - 2026-03-13

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
