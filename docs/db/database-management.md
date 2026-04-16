# Database Management - CYMP LMS

## Estado actual 2026-03-28

El runtime activo de `framework` ya no depende solo de Astro DB local. La parte viva del LMS y del foro está hoy en **Supabase**.

Snapshot operativo confirmado el `2026-03-28`:

- `projectRef`: `dkybbahdecnqpwctxzit`
- `supabaseHost`: `dkybbahdecnqpwctxzit.supabase.co`
- backup manual real tomado antes del fix de recuperación del foro:
  - [20260328-175207Z-pre-forum-fix](/Users/zztt/projects/26-musiki/framework/.tmp/db-backups/20260328-175207Z-pre-forum-fix)
- artifacts del backup:
  - [schema.sql](/Users/zztt/projects/26-musiki/framework/.tmp/db-backups/20260328-175207Z-pre-forum-fix/schema.sql)
  - [data.sql](/Users/zztt/projects/26-musiki/framework/.tmp/db-backups/20260328-175207Z-pre-forum-fix/data.sql)
  - [metadata.json](/Users/zztt/projects/26-musiki/framework/.tmp/db-backups/20260328-175207Z-pre-forum-fix/metadata.json)
- método usado: `supabase-cli-dry-run`
- contexto de datos observado al momento del backup:
  - `ForumBoard=7`
  - `ForumThread=1`
  - `ForumPost=1`
  - `User=83`
  - `Enrollment=85`

Importante:

- el backup lógico actual vive en `.tmp/db-backups/` y no se commitea
- `PITR`/physical backups de Supabase estaban `false` al momento de este snapshot
- hasta activar PITR, estos dumps manuales son la red mínima de seguridad

## Persistencia de la Base de Datos

### ⚠️ Problema Anterior

La base de datos SQLite se borraba porque `.astro/` estaba en `.gitignore`, lo que causaba que:
- No se commiteara el archivo `.astro/content.db`
- Se perdiera al hacer git operations
- Se regenerara vacía cada vez

### ✅ Solución Implementada

**1. .gitignore Actualizado**
```gitignore
# generated types
.astro/
# BUT keep database file for persistence
!.astro/content.db
```

Esto mantiene la DB en git mientras ignora otros archivos de `.astro/`.

**2. Seed Script Automático**

Archivo: `db/seed.ts`

El seed se ejecuta **automáticamente** cada vez que:
- Inicias el servidor con `npm run dev`
- Ejecutas `npm run db:seed`
- El servidor detecta cambios en schema

El seed garantiza que:
- Tu usuario teacher siempre existe
- El rol se mantiene como 'teacher'
- No duplica si ya existe

**3. Sistema de Backups**

Scripts creados:
- `scripts/db-backup.sh` - Crear backup
- `scripts/db-restore.sh` - Restaurar backup

---

## Comandos Disponibles

### Desarrollo Diario

```bash
# Iniciar servidor (auto-seed incluido)
npm run dev

# Ver/editar DB en UI gráfica
npm run db:studio
```

### Gestión de Schema

```bash
# Aplicar cambios de schema a DB
npm run db:push

# Re-ejecutar seed manualmente
npm run db:seed
```

### Backups

```bash
# Crear backup lógico del runtime actual
npm run db:backup

# Restaurar desde backup lógico
npm run db:restore
```

### Inspección SQL Directa

```bash
# Ver todas las tablas
sqlite3 .astro/content.db ".tables"

# Ver usuarios
sqlite3 .astro/content.db "SELECT email, name, role FROM User;"

# Ver submissions
sqlite3 .astro/content.db "SELECT * FROM Submission;"

# Contar enrollments
sqlite3 .astro/content.db "SELECT COUNT(*) FROM Enrollment;"
```

---

## Sistema de Backups

### Crear Backup Manual

```bash
npm run db:backup
```

Por defecto crea un bundle timestamped en `.tmp/db-backups/`:

```text
.tmp/db-backups/20260328-175207Z-pre-forum-fix/
```

Contenido típico:

- `schema.sql`
- `data.sql`
- `metadata.json`

Opciones útiles:

```bash
# Etiqueta legible
bash scripts/db-backup.sh --label pre-deploy

# Ver sin ejecutar
bash scripts/db-backup.sh --dry-run

# Usar otro env
bash scripts/db-backup.sh --env-file .env.production
```

Resolución de conexión:

1. `DATABASE_URL`
2. `SUPABASE_DB_URL`
3. `SUPABASE_DB_PASSWORD` + `supabase/.temp/pooler-url`

Fallback actual:

- si no hay connection string directa, el script deriva un dump a partir de `supabase db dump --linked --dry-run`
- esto evitó depender de Docker Desktop en el backup de `2026-03-28`

Nota:

- el dump de datos puede advertir FK circular en `ForumPost` por replies encadenadas
- el restore ya contempla esto aplicando el `data.sql` con `session_replication_role = replica`

### Restaurar Backup

```bash
npm run db:restore
```

Restore explícito:

```bash
# Restore desde bundle de schema+data
bash scripts/db-restore.sh --input .tmp/db-backups/20260328-175207Z-pre-forum-fix --yes

# Restore desde .dump/.backup
bash scripts/db-restore.sh --input /ruta/al/backup.dump --clean --yes

# Ver comando sin ejecutar
bash scripts/db-restore.sh --input .tmp/db-backups/20260328-175207Z-pre-forum-fix --dry-run
```

Protecciones:

- `--yes` es obligatorio
- `--clean` solo aplica a restores con `pg_restore`
- para bundles de directorio, primero se aplica `schema.sql` y luego `data.sql`

### Backup Automático (Git)

Dado que `.astro/content.db` está en git:
```bash
# Commit de DB actual
git add .astro/content.db
git commit -m "db: backup before major changes"

# Restaurar desde commit anterior
git checkout HEAD~1 -- .astro/content.db
```

---

## Flujo de Trabajo Recomendado

### Inicio de Proyecto

```bash
# 1. Clonar repo
git clone <repo-url>
cd framework

# 2. Instalar dependencias
npm install

# 3. Iniciar servidor (auto-seed crea tu usuario)
npm run dev
```

✅ Tu usuario teacher está listo automáticamente.

### Desarrollo Regular

```bash
# Antes de cambios importantes o deploys
npm run db:backup

# Trabajar normalmente
npm run dev

# Si algo sale mal
npm run db:restore
```

### Cambios de Schema

```bash
# 1. Editar db/config.ts
# 2. Aplicar cambios
npm run db:push

# 3. Actualizar seed si necesario
# 4. Re-seed
npm run db:seed
```

### Antes de Deploy

```bash
# 1. Backup lógico de producción
npm run db:backup

# 2. Deploy
```

Checklist mínimo para Supabase:

- verificar que el backup nuevo exista en `.tmp/db-backups/`
- abrir `metadata.json` y confirmar `projectRef` correcto
- si el cambio toca foros, notas o enrollments, registrar conteos clave antes y después
- activar PITR en Supabase sigue siendo una tarea pendiente de prioridad alta

---

## Troubleshooting

### "Quiero verificar rápido el estado del foro antes de tocar algo"

Conteos orientativos usados en la incidencia del `2026-03-28`:

```bash
node --input-type=module <<'EOF'
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
for (const table of ['ForumBoard', 'ForumThread', 'ForumPost', 'User', 'Enrollment']) {
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
  console.log(table, count);
}
EOF
```

Si `ForumBoard` existe pero `ForumThread` / `ForumPost` están absurdamente bajos, no asumir primero un bug visual: verificar la base activa.

### "Mi usuario teacher desapareció"

**Solución rápida:**
```bash
npm run db:seed
```

El seed lo recreará automáticamente.

### "La DB se sigue borrando"

**Verifica:**
```bash
# 1. Confirma que .gitignore permite .astro/content.db
cat .gitignore | grep "content.db"

# Debería mostrar: !.astro/content.db

# 2. Confirma que DB está en git
git ls-files | grep content.db

# Debería mostrar: .astro/content.db
```

**Si no está trackeado:**
```bash
git add -f .astro/content.db
git commit -m "db: add database file"
```

### "Necesito empezar de cero"

```bash
# 1. Backup actual (por si acaso)
npm run db:backup

# 2. Borrar DB
rm .astro/content.db

# 3. Recrear (auto-seed incluido)
npm run dev
```

### "Error: Database is locked"

La DB está siendo usada por otro proceso.

**Solución:**
```bash
# 1. Detener servidor
# 2. Cerrar Astro Studio si está abierto
# 3. Reintentar
```

---

## Estructura de Directorios

```
framework/
├── .astro/
│   ├── content.db          ← DB principal (en git)
│   └── ...                 ← Otros (ignorados)
└── scripts/
    ├── db-backup.sh        ← Dump lógico Supabase / Postgres
    └── db-restore.sh       ← Restore lógico Supabase / Postgres
```

Runtime backup path actual:

```text
framework/.tmp/db-backups/
```

---

## Migración a PostgreSQL (Futuro)

Cuando migremos a producción con PostgreSQL:

### Paso 1: Exportar Data

```bash
# Export to SQL
sqlite3 .astro/content.db .dump > backup.sql

# O usar tool de migración
npm install -g sqlite-to-postgres
sqlite-to-postgres --source .astro/content.db --target postgres://...
```

### Paso 2: Configurar Astro DB

```typescript
// db/config.ts
export default defineDb({
  adapter: postgresAdapter({
    connectionString: process.env.DATABASE_URL
  }),
  tables: { ... }
});
```

### Paso 3: Re-seed

```bash
npm run db:push  # En PostgreSQL
npm run db:seed  # Crear usuario teacher
```

---

## Seguridad

### Datos Sensibles

⚠️ **No commitear passwords o datos personales reales en SQLite.**

La DB de desarrollo debe tener:
- Usuarios de prueba
- Data de ejemplo
- No datos de producción

### Producción

En producción:
- Usar PostgreSQL (no SQLite)
- DB fuera del repo
- Backups automatizados
- Encriptación en reposo

---

## Comandos de Mantenimiento

### Vacuuming (Optimización)

```bash
sqlite3 .astro/content.db "VACUUM;"
```

### Verificar Integridad

```bash
sqlite3 .astro/content.db "PRAGMA integrity_check;"
```

### Ver Tamaño

```bash
du -h .astro/content.db
```

### Compactar

```bash
sqlite3 .astro/content.db "PRAGMA auto_vacuum = FULL; VACUUM;"
```

---

## FAQ

**Q: ¿Por qué SQLite en desarrollo?**
A: Simplicidad. No requiere servidor DB externo. Perfecto para desarrollo local.

**Q: ¿Es seguro para producción?**
A: No recomendado. Migraremos a PostgreSQL para producción.

**Q: ¿Cuándo se ejecuta el seed?**
A: Automáticamente al iniciar servidor o manualmente con `npm run db:seed`.

**Q: ¿Los backups son automáticos?**
A: No. Usa `npm run db:backup` antes de cambios importantes.

**Q: ¿Puedo usar otro email?**
A: Sí, edita `db/seed.ts` y cambia `teacherEmail`.

---

## Próximos Pasos

Con la persistencia asegurada, podemos continuar con:

1. **Fase 2, Week 1**: MCQ System
   - Fix rendering issue
   - Complete submission flow
   - Test end-to-end

2. **Dashboard Integration**
   - View submissions
   - Grading interface
   - Analytics basic

3. **Short Answer**
   - Text input
   - Manual grading
   - Rubrics

---

**Última Actualización**: 13/12/2025
**Autor**: Luciano Azzigotti
