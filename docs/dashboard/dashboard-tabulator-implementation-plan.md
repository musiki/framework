# Dashboard Tabulator Implementation Plan

## Estado

Plan de implementación derivado de [dashboard-tabulator-rfc.md](/Users/zztt/projects/26-musiki/framework/docs/dashboard-tabulator-rfc.md).

Objetivo: pasar del dashboard actual a un dashboard por tabs con `Tabulator`, sin romper el modelo canónico existente.

## Principios de ejecución

- No rehacer el dominio antes de tener una vista nueva funcionando.
- Reducir el tamaño y responsabilidad de [dashboard.astro](/Users/zztt/projects/26-musiki/framework/src/pages/dashboard.astro).
- Mover lógica de proyección a `src/lib/dashboard/**`.
- Mantener el primer corte usable antes de sumar realtime.
- Separar:
  - feedback académico
  - anotación operativa del dashboard

## Definition of Done global

El rediseño se considera operativo cuando:

- `Overview`, `Gradebook` y `Attendance` existen como tabs reales
- cada tab usa `Tabulator`
- cada tab tiene `search box` global con filtrado en tiempo real
- cada tab persiste orden/ancho/sort/filtros/search por usuario
- existen highlights y comments operativos en celdas o scopes equivalentes
- `Attendance` sigue soportando override manual
- el dashboard deja de depender de tablas HTML manuales grandes

## Fase 1: Base Tabulator

Meta: reemplazar la capa visual manual del dashboard por una base de `Tabulator` estable, sin introducir todavía anotaciones compartidas ni realtime.

### Ticket 1.1: Instalar y cablear Tabulator

**Objetivo**

Agregar `Tabulator` al framework y cargar sus estilos sin romper el tema actual.

**Archivos**

- [package.json](/Users/zztt/projects/26-musiki/framework/package.json)
- [dashboard.astro](/Users/zztt/projects/26-musiki/framework/src/pages/dashboard.astro)
- opcionalmente [global.css](/Users/zztt/projects/26-musiki/framework/src/styles/global.css)

**Tareas**

- agregar dependencia `tabulator-tables`
- definir estrategia de CSS:
  - import completo del tema base
  - overrides locales para respetar `--c-bg`, `--c-fg`, `--c-border`
- dejar una shell visual mínima para tabs con grid

**Aceptación**

- build pasa
- no hay watermark
- dark/light theme siguen legibles

### Ticket 1.2: Extraer builders server-side del dashboard

**Objetivo**

Sacar de [dashboard.astro](/Users/zztt/projects/26-musiki/framework/src/pages/dashboard.astro) la lógica de armado de filas/columnas.

**Archivos nuevos propuestos**

- `/Users/zztt/projects/26-musiki/framework/src/lib/dashboard/roster.ts`
- `/Users/zztt/projects/26-musiki/framework/src/lib/dashboard/overview-projection.ts`
- `/Users/zztt/projects/26-musiki/framework/src/lib/dashboard/gradebook-projection.ts`
- `/Users/zztt/projects/26-musiki/framework/src/lib/dashboard/attendance-projection.ts`
- `/Users/zztt/projects/26-musiki/framework/src/lib/dashboard/shared.ts`

**Tareas**

- centralizar normalización de:
  - `courseId`
  - `year`
  - roster de estudiantes
  - assignments visibles
  - submissions visibles
  - attendance visible
- definir tipos TS para cada tab

**Aceptación**

- `dashboard.astro` baja claramente de complejidad
- cada proyección se puede testear de manera aislada

### Ticket 1.3: Definir shell de tabs nueva

**Objetivo**

Pasar de `users / deliveries / attendance` a tabs de proyección coherentes.

**Tabs fase 1**

- `Overview`
- `Gradebook`
- `Attendance`

**Archivos**

- [dashboard.astro](/Users/zztt/projects/26-musiki/framework/src/pages/dashboard.astro)

**Tareas**

- mantener sidebar con `course` y `year`
- rehacer navegación teacher de tabs
- dejar student dashboard intacto por ahora, salvo si comparte shell fácilmente

**Aceptación**

- tabs nuevos visibles
- navegación estable con query params

### Ticket 1.4: Montaje Tabulator en cliente

**Objetivo**

Montar la interacción del grid en un módulo dedicado y no en un script gigante inline.

**Archivos nuevos propuestos**

- `/Users/zztt/projects/26-musiki/framework/src/scripts/dashboard-tabulator.ts`
- opcional `/Users/zztt/projects/26-musiki/framework/src/lib/dashboard/tabulator-config.ts`

**Tareas**

- crear helper de creación de grid
- definir columnas congeladas base
- montar instancias por tab
- desacoplar boot del dashboard del render del grid

**Aceptación**

- cada tab crea su grid desde un módulo único
- no se reinyecta toda la lógica en inline script

### Ticket 1.5: Search box dinámico por tab

**Objetivo**

Todos los grids del dashboard deben tener su propio input de búsqueda externa.

**Archivos**

- [dashboard.astro](/Users/zztt/projects/26-musiki/framework/src/pages/dashboard.astro)
- `/Users/zztt/projects/26-musiki/framework/src/scripts/dashboard-tabulator.ts`

**Tareas**

- input externo por tab
- debounce `120-180ms`
- persistencia de query por usuario y por tab
- integración con filtros y sorting del grid

**Aceptación**

- el filtrado se ve en tiempo real
- al recargar, la query vuelve en el tab correspondiente

### Ticket 1.6: Persistencia local de layout

**Objetivo**

Guardar orden, ancho, sorting, filtros, page size y search en `localStorage`.

**Namespace**

```text
musiki:dashboard:<userId>:<courseId>:<year>:<tab>
```

**Tareas**

- definir serialización única
- persistir:
  - column order
  - column width
  - sorters
  - filters
  - search query
  - page size
- restaurar layout al montar el tab

**Aceptación**

- mover columnas y cambiar width sobrevive a reload
- cada tab recuerda su layout

## Fase 2: Comentarios, highlights y admin

Meta: agregar la capa docente de anotaciones y ampliar el dashboard a `Comments` y `Admin`.

### Ticket 2.1: Crear `GradebookAnnotation`

**Objetivo**

Persistir highlights y comentarios operativos de dashboard en base y no solo en local.

**Archivos nuevos propuestos**

- `/Users/zztt/projects/26-musiki/framework/supabase/migrations/<timestamp>_gradebook_annotations.sql`
- `/Users/zztt/projects/26-musiki/framework/src/lib/dashboard/annotations.ts`

**Tareas**

- crear tabla
- índices por:
  - `courseId`
  - `studentId`
  - `scopeType + scopeRef`
  - `authorUserId`
- RLS o acceso por service role según el patrón vigente

**Aceptación**

- la tabla existe y se puede consultar por curso/scope

### Ticket 2.2: API de anotaciones

**Objetivo**

Tener CRUD mínimo para comentarios e highlights.

**Archivos nuevos propuestos**

- `/Users/zztt/projects/26-musiki/framework/src/pages/api/dashboard/annotations.ts`
- opcional `/Users/zztt/projects/26-musiki/framework/src/pages/api/dashboard/annotations/[id].ts`

**Operaciones**

- `GET` por `courseId`, `year`, `scopeType`, `scopeRef`
- `POST` crear
- `PATCH` editar color/texto/visibility
- `DELETE` borrar

**Aceptación**

- teacher puede crear y editar anotaciones
- otro teacher del mismo curso las ve si `visibility = teachers`

### Ticket 2.3: Highlights en 8 colores

**Objetivo**

Implementar highlights operativos dentro del grid.

**Paleta**

- `red`
- `coral`
- `orange`
- `yellow`
- `lime`
- `green`
- `cyan`
- `blue`

**Tareas**

- context menu o action menu por celda
- clases CSS semánticas
- tooltip y `aria-label`
- render consistente en dark/light

**Aceptación**

- una celda puede quedar resaltada con cualquiera de los 8 colores
- el highlight sobrevive a recarga y cambio de tab

### Ticket 2.4: Comments con shortcut

**Objetivo**

Agregar comentario rápido de teacher sobre scope seleccionado.

**Shortcut**

- `Cmd + Alt + M` en mac
- `Ctrl + Alt + M` como fallback

**Tareas**

- definir selección activa de celda o scope
- abrir modal/dialog mínimo
- guardar anotación
- mostrar indicador de comentario en la celda o en columna derivada

**Aceptación**

- con el shortcut se abre comentario sobre la selección actual
- el comentario queda persistido y visible al volver

### Ticket 2.5: Tab `Comments`

**Objetivo**

Crear una vista docente de observaciones operativas.

**Contenido**

- estudiante
- scope
- color
- comentario
- autor
- fecha

**Tareas**

- proyección nueva en `src/lib/dashboard/comments-projection.ts`
- grid nuevo en dashboard
- search box propio

**Aceptación**

- se puede buscar y filtrar comentarios operativos del curso

### Ticket 2.6: Tab `Admin`

**Objetivo**

Agregar tab administrativo para coordinación y teachers.

**Contenido mínimo**

- nombre
- email
- rol global
- rol en curso
- estado de inscripción
- última actividad

**Tareas**

- reusar `User + Enrollment`
- excluir ruido no útil
- permitir ver también docentes del curso

**Aceptación**

- el tab muestra roster administrativo mixto
- soporta sort, search y export CSV

## Fase 3: Realtime, attendance util y overview final

Meta: volver el dashboard reactivo en serio, pero sobre una base ya estable.

### Ticket 3.1: Restituir edición útil de asistencia en Tabulator

**Objetivo**

La migración a `Tabulator` no puede perder overrides manuales de asistencia.

**Archivos**

- [course-attendance-manual.ts](/Users/zztt/projects/26-musiki/framework/src/pages/api/grade/course-attendance-manual.ts)
- [course-attendance-config.ts](/Users/zztt/projects/26-musiki/framework/src/pages/api/grade/course-attendance-config.ts)
- `/Users/zztt/projects/26-musiki/framework/src/lib/dashboard/attendance-projection.ts`
- `/Users/zztt/projects/26-musiki/framework/src/scripts/dashboard-tabulator.ts`

**Tareas**

- columnas editables para días
- persistir override manual
- recomputar ausencia total
- conservar config de rango

**Aceptación**

- editar una celda de asistencia actualiza la vista y persiste

### Ticket 3.2: Tab `Overview`

**Objetivo**

Construir una vista de riesgo académico útil.

**Métricas mínimas**

- `attendance_rate`
- `deliveries_done`
- `deliveries_pending`
- `average_score`
- `last_activity_at`
- `risk_level`

**Regla inicial de riesgo**

- `red`: baja asistencia + entregas pendientes + score bajo
- `yellow`: señales mixtas
- `green`: situación estable

**Aceptación**

- el teacher puede ordenar por riesgo y detectar casos rápidamente

### Ticket 3.3: Realtime por invalidación de scope

**Objetivo**

Hacer que cambios de evaluaciones/asistencia/anotaciones se reflejen en vivo.

**Tablas a escuchar**

- `Assignment`
- `Submission`
- `Enrollment`
- `LiveClassSession`
- `LiveClassAttendance`
- `GradebookAnnotation`

**Estrategia**

- no parchear celda exacta en fase inicial
- invalidar scope
- refetch de:
  - fila
  - bloque del tab
  - tab completo si hace falta

**Aceptación**

- dos docentes ven los cambios relevantes sin recargar la página

### Ticket 3.4: Export coherente por tab

**Objetivo**

Export CSV real por tab, respetando columnas visibles y orden actual.

**Tareas**

- export desde `Tabulator`
- nombre de archivo consistente:
  - `musiki-gradebook-<course>-<year>.csv`
  - `musiki-attendance-<course>-<year>.csv`
  - etc.

**Aceptación**

- la exportación respeta el layout del usuario

### Ticket 3.5: Google Sheets bridge

**Objetivo**

Dejar lista la capa de integración sin volverla dependencia crítica.

**Primera implementación**

- export CSV manual
- especificación de import/export posterior

**Segunda implementación opcional**

- API o edge job para sincronización con Sheets

**Aceptación**

- el dashboard no depende de Sheets
- existe camino limpio para integrarlo después

## Orden recomendado de implementación

### Sprint A

- `1.1`
- `1.2`
- `1.3`
- `1.4`

### Sprint B

- `1.5`
- `1.6`
- `3.1`

### Sprint C

- `2.1`
- `2.2`
- `2.3`
- `2.4`

### Sprint D

- `2.5`
- `2.6`
- `3.2`

### Sprint E

- `3.3`
- `3.4`
- `3.5`

## Riesgos y mitigación

### Riesgo 1: `dashboard.astro` sigue creciendo

**Mitigación**

- sacar proyecciones a `src/lib/dashboard/**`
- sacar cliente a `src/scripts/dashboard-tabulator.ts`

### Riesgo 2: asistencia pierde capacidad respecto de la tabla vieja

**Mitigación**

- cerrar `Ticket 3.1` antes de dar por terminada la migración

### Riesgo 3: comments/highlights quedan como feature linda pero no útil

**Mitigación**

- persistirlos en base con `GradebookAnnotation`
- no dejarlos solo en `localStorage`

### Riesgo 4: realtime demasiado fino rompe consistencia

**Mitigación**

- invalidación por scope primero
- patch fino solo si se demuestra necesario

## Primer corte recomendado

Si hay que elegir el corte de mayor valor con menor riesgo, el orden debería ser:

1. `Overview`, `Gradebook`, `Attendance` con `Tabulator`
2. `search box` global por tab
3. persistencia local de layout
4. edición útil de asistencia
5. comments/highlights
6. realtime

## Decisión operativa

La próxima implementación debe comenzar por:

- instalar `Tabulator`
- extraer builders de [dashboard.astro](/Users/zztt/projects/26-musiki/framework/src/pages/dashboard.astro)
- montar `Overview`, `Gradebook` y `Attendance`
- agregar `search box` dinámico y persistencia de layout por usuario

Ese es el camino más corto hacia un dashboard nuevo realmente utilizable.
