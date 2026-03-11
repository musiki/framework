# Persistencia de Base de Datos - Astro DB

## Problema: Pérdida de datos al reiniciar el servidor en desarrollo

### ¿Por qué sucede esto?

Astro DB en **modo desarrollo local** tiene un comportamiento específico:

1. **Cuando cambias `db/config.ts`** (schema de la base de datos), Astro DB detecta el cambio y **recrea completamente la base de datos**
2. Esto significa que **todos los datos se pierden**, excepto lo que el archivo `db/seed.ts` vuelve a crear
3. Este es el comportamiento esperado en desarrollo para mantener la consistencia del esquema

### Evidencia en los logs

Cuando ves este mensaje:
```
[astro:db] New local database created.
```

Significa que la base de datos fue recreada desde cero.

## Solución 1: No modificar db/config.ts frecuentemente

Una vez que tienes tu esquema definido, **evita hacer cambios** en `db/config.ts` durante el desarrollo activo.

Si necesitas hacer cambios:
1. Haz un backup primero: `npm run db:backup`
2. Modifica `db/config.ts`
3. Restaura si es necesario: `npm run db:restore`

## Solución 2: Mejorar el seed file

El archivo `db/seed.ts` ya está configurado para:
- ✅ Preservar el usuario teacher
- ✅ Crear Course y Assignments necesarios
- ❌ **NO preserva:** Users adicionales, Enrollments, Submissions

### Para preservar más datos

Puedes extender `db/seed.ts` para recrear datos importantes:

```javascript
// Ejemplo: preservar enrollments del teacher
const teacherEnrollments = [
  { userId: teacherUser.id, courseId: 'ejemplo-generative-art', roleInCourse: 'teacher' }
];

for (const enrollment of teacherEnrollments) {
  const existing = await db.select().from(Enrollment)
    .where(and(
      eq(Enrollment.userId, enrollment.userId),
      eq(Enrollment.courseId, enrollment.courseId)
    ));
  
  if (existing.length === 0) {
    await db.insert(Enrollment).values({
      id: crypto.randomUUID(),
      ...enrollment,
      enrolledAt: new Date()
    });
  }
}
```

## Solución 3: Usar backups frecuentes

Scripts ya disponibles:

```bash
# Hacer backup
npm run db:backup

# Restaurar backup más reciente
npm run db:restore
```

Los backups se guardan en `db/backups/` con timestamp.

## En Producción

En producción (deployment), Astro DB funciona diferente:

- ✅ Los datos **SÍ persisten** entre deploys
- ✅ Las migraciones se manejan automáticamente
- ✅ No se recrea la base de datos por cambios de esquema

Para deployment, usar:
- Astro Studio (recomendado)
- O una base de datos externa (PostgreSQL, etc.)

## Mejores Prácticas

1. **Desarrollo inicial**: Cambia el esquema libremente, los datos de prueba se pierden (está bien)
2. **Desarrollo avanzado**: 
   - Congela el esquema en `db/config.ts`
   - Usa backups si necesitas preservar datos de prueba
   - Crea usuarios y datos de prueba vía UI, no seed
3. **Producción**: Usa Astro Studio o base de datos externa

## Estado Actual

Tu base de datos actualmente preserva:
- ✅ Teacher user (lucianoazzigotti@gmail.com)
- ✅ Course "ejemplo-generative-art"
- ✅ 4 Assignments para eval blocks
- ❌ Otros usuarios (se pierden en restart)
- ❌ Enrollments (se pierden en restart)  
- ❌ Submissions (se pierden en restart)

## Solución Inmediata

Si necesitas persistencia completa **ahora mismo** en desarrollo:

1. **No toques `db/config.ts`** - el esquema está completo
2. Usa el sistema normalmente - crea usuarios, enrollments, submissions
3. Los datos persistirán **mientras no reinicies el servidor**
4. Si reinicias: usa `npm run db:backup` antes y `npm run db:restore` después

## Recursos

- [Astro DB Docs](https://docs.astro.build/en/guides/astro-db/)
- [Seeding Data](https://docs.astro.build/en/guides/astro-db/#seed-your-database)
- Scripts de backup: `scripts/db-backup.sh`, `scripts/db-restore.sh`
