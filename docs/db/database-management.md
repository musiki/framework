# Database Management — Musiki Framework

**Última actualización**: 2026-05-08

## Estado actual

El runtime depende de **PostgreSQL 16** auto-hospedado en el VPS Hetzner (`46.225.154.68`).  
No hay Supabase, no hay SQLite, no hay Docker local.

- **DB**: `musiki26`
- **User**: `app` (superuser, bypass RLS)
- **Container**: `devmusiki-db` (Docker en el VPS, no en local)
- **Host interno VPS**: `172.18.0.2:5432`
- **Dev local**: SSH tunnel → `localhost:5433` (ver sección Desarrollo local)

```
DATABASE_URL=postgresql://app:<password>@172.18.0.2:5432/musiki26   # en VPS
DATABASE_URL=postgresql://app:<password>@localhost:5433/musiki26     # local via tunnel
```

---

## Migraciones

Las migraciones viven en `postgres-patches/migrations/`. Se aplican manualmente a producción:

```bash
# Desde local — stdin al psql del container:
ssh hetzner "docker exec -i devmusiki-db psql -U app -d musiki26" < postgres-patches/migrations/<archivo>.sql

# O directamente en el VPS:
ssh hetzner
docker exec -i devmusiki-db psql -U app -d musiki26 < /opt/musiki/framework/postgres-patches/migrations/<archivo>.sql
```

Convención de nombres: `YYYYMMDDHHMMSS_descripcion.sql`.

Para verificar el schema de una tabla:
```bash
ssh hetzner "docker exec devmusiki-db psql -U app -d musiki26 -c '\d \"NombreTabla\"'"
```

---

## Desarrollo local

Abrir el SSH tunnel al VPS (hace forward del puerto 5432 del container al 5433 local):

```bash
# Con fish:
scripts/dev-db.fish

# O manualmente:
ssh -L 5433:172.18.0.2:5432 hetzner -N
```

Con el tunnel activo, el `.env` local usa `localhost:5433`.

---

## Backup / Restore

### Backup manual antes de deploy

```bash
# Desde local (crea dump en el VPS):
bash scripts/db-backup.sh --label pre-deploy

# O directo en VPS:
ssh hetzner "docker exec devmusiki-db pg_dump -U app musiki26 > /tmp/backup-$(date +%F).sql"
```

### Restore

```bash
bash scripts/db-restore.sh --input .tmp/db-backups/<bundle> --yes
```

Scripts disponibles:
- `scripts/db-backup.sh` — dump lógico
- `scripts/db-backup.fish` — variante Fish
- `scripts/db-restore.sh` — restore

---

## Inspección rápida

```bash
# Tablas existentes:
ssh hetzner "docker exec devmusiki-db psql -U app -d musiki26 -c '\dt'"

# Conteos básicos:
ssh hetzner "docker exec devmusiki-db psql -U app -d musiki26 -c 'SELECT count(*) FROM \"User\";'"

# Ver schema de tabla:
ssh hetzner "docker exec devmusiki-db psql -U app -d musiki26 -c '\d \"LiveClassResource\"'"
```

---

## Tablas principales (2026-05-08)

| Tabla | Descripción |
|-------|-------------|
| `User` | Usuarios del sistema |
| `Enrollment` | Inscripciones a cursos |
| `ForumBoard / Thread / Post` | Foro por curso |
| `LiveClassAttendance` | Registro de asistencia LiveKit |
| `LiveClassSession` | Sesiones LiveKit (attendance tracker) |
| `LiveClassNotes` | Notas colaborativas de clase |
| `LiveClassResource` | Recursos del pod RE (+ `sessionId` FK) |
| `ResourceSession` | Sesiones del pod RE (log de archivos compartidos) |
| `LiveRoomInvite` | Invitaciones a sala con código |
| `Submission` | Respuestas a evaluaciones |
| `LiveKitWebhookEvent` | Log de eventos LiveKit |

---

## Disciplina mínima antes de tocar producción

```bash
# 1. Backup
bash scripts/db-backup.sh --label pre-deploy

# 2. Aplicar migration si hay cambios de schema
ssh hetzner "docker exec -i devmusiki-db psql -U app -d musiki26" < postgres-patches/migrations/<nuevo>.sql

# 3. Deploy
```
