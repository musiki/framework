# Dashboard Tabulator RFC

## Estado

Decision tomada para planificacion previa a implementacion.

- Grid elegido: `Tabulator`
- Licencia: `MIT`
- Restriccion operativa: sin watermark, sin dependencia de features pagas
- Plan de ejecucion: [dashboard-tabulator-implementation-plan.md](/Users/zztt/projects/26-musiki/framework/docs/dashboard-tabulator-implementation-plan.md)

## Contexto real de Musiki

El dashboard actual no parte de un esquema clasico `students / grades / attendance`.
Parte de un nucleo ya existente:

- `User`
- `Enrollment`
- `Assignment`
- `Submission`
- `LiveClassSession`
- `LiveClassAttendance`

Ademas, hoy existen metadatos de curso guardados como submissions especiales:

- `course_student_profile`
- `course_attendance_config`
- `course_attendance_manual`

La decision de este RFC es **evolucionar** ese modelo con una capa de proyeccion mejor, no reemplazarlo de golpe con un esquema nuevo paralelo.

## Decision de arquitectura

Se adopta un patron de **gradebook reactivo por proyeccion**:

- la base canonica sigue en `Assignment`, `Submission` y tablas live;
- el dashboard muestra vistas dinamicas por tab;
- `Tabulator` resuelve interaccion, layout, filtros, export y persistencia local;
- la reactividad viene de `Supabase Realtime` mas invalidacion/refetch por scope, no de un patch fino de cada celda en la primera etapa.

## Objetivos

- Unificar `grading`, `attendance`, `comments` y `admin` sobre una misma base de roster.
- Mantener siempre visibles columnas congeladas de identidad.
- Permitir columnas dinamicas por actividad, sesion o vista.
- Tener `search box` global por tab, con filtrado en tiempo real.
- Persistir orden, ancho, sorting y filtros por usuario y por tab.
- Soportar highlights y comentarios de trabajo docente.
- Mantener export CSV simple.
- Preparar futura sincronizacion bidireccional con Google Sheets sin hacerla requisito de fase 1.

## No objetivos

- No migrar todo a un modelo EAV generico tipo `event_properties(key,value,type)` para el core.
- No introducir React solo para el dashboard.
- No duplicar `students`, `grades` y `attendance` en tablas nuevas paralelas.
- No empezar con sincronizacion por celda exacta en realtime.

## Base canonica

### Entidades base

- `User`: identidad global
- `Enrollment`: pertenencia y rol por curso
- `Assignment`: actividad evaluable visible en dashboard
- `Submission`: respuesta o estado evaluativo del estudiante
- `LiveClassSession`: sesion sincrona
- `LiveClassAttendance`: eventos crudos de asistencia

### Lectura conceptual

- `Assignment` ya cumple el rol de `activity`
- `Submission` ya cumple el rol de `evaluation event` para notas y entregas
- `LiveClassAttendance` es el evento crudo para asistencia
- el dashboard no necesita otra tabla de notas en fase 1; necesita mejores vistas

## Proyeccion del dashboard

La UI deja de pensarse como una tabla unica gigante y pasa a ser una familia de vistas sobre el mismo roster.

### Columnas fijas del roster

Estas columnas deben poder congelarse en todos los tabs:

- `name`
- `email`
- `group`
- `turno`
- `status`

### Tabs propuestos

#### `Overview`

Vista sintetica para deteccion rapida de riesgo.

Columnas sugeridas:

- `attendance_rate`
- `deliveries_done`
- `deliveries_pending`
- `average_score`
- `risk_level`
- `last_activity_at`

#### `Gradebook`

Vista de evaluaciones por actividad.

Columnas dinamicas:

- una columna por `Assignment` visible dentro del scope actual
- columna final derivada: `average_score`
- opcionalmente columnas agregadas por modulo o unidad

#### `Attendance`

Vista por sesion o por semana de cursada.

Columnas dinamicas:

- una columna por fecha de sesion o fecha de grilla semanal
- columna final derivada: `absence_units` o `attendance_rate`

#### `Comments`

Vista dedicada a observaciones operativas.

No reemplaza el feedback academico en `Submission.feedback`.
Muestra:

- highlights activos
- comentarios docentes
- anotaciones por estudiante o por celda

#### `Admin`

Vista administrativa orientada a docentes y coordinacion.

Columnas sugeridas:

- rol global
- rol en curso
- inscripcion
- ultima actividad
- permisos
- observaciones internas

## Search box dinamico

Cada tab del dashboard debe tener su propio `search box` global.

### Reglas

- filtrado en tiempo real con debounce corto (`120-180ms`)
- el search box filtra sobre la vista actual, no sobre todo el dashboard
- debe incluir columnas visibles y ciertos campos ocultos de soporte:
  - `name`
  - `email`
  - `group`
  - `turno`
  - ids relevantes
- el resultado del search debe convivir con filtros por columna y sorting
- el estado del search debe persistirse por tab y por usuario

### Implementacion esperada en Tabulator

- input externo al grid
- binding a filtro global o busqueda global del grid
- persistencia local por `courseId + year + tab + user`

## Highlights

Se amplía la escala original a `8` colores.

### Paleta

| key | label | hex | uso sugerido |
| --- | --- | --- | --- |
| `red` | Red | `#d84b45` | riesgo fuerte, urgente |
| `coral` | Coral | `#e96a4a` | problema puntual |
| `orange` | Orange | `#f08c2e` | seguimiento |
| `yellow` | Yellow | `#d9b93b` | observacion |
| `lime` | Lime | `#9bbb3f` | mejora leve |
| `green` | Green | `#52a95a` | ok / logrado |
| `cyan` | Cyan | `#3ea8b8` | dato informativo |
| `blue` | Blue | `#4c78d0` | referencia / contexto |

### Decision

- los nuevos tres colores son `coral`, `lime` y `cyan`
- el sistema no debe depender solo del color:
  - tooltip
  - clase CSS semantica
  - etiqueta accesible

## Comentarios y anotaciones

Se separan dos cosas distintas:

### Feedback academico

Permanece en:

- `Submission.feedback`

### Anotacion operativa del dashboard

Se propone una entidad nueva:

`GradebookAnnotation`

Campos sugeridos:

```sql
create table if not exists public."GradebookAnnotation" (
  "id" uuid primary key default gen_random_uuid(),
  "courseId" text not null,
  "studentId" uuid not null references public."User" ("id") on delete cascade,
  "scopeType" text not null,
  "scopeRef" text not null,
  "color" text,
  "text" text not null default '',
  "visibility" text not null default 'teachers',
  "authorUserId" uuid not null references public."User" ("id") on delete cascade,
  "createdAt" timestamptz not null default timezone('utc', now()),
  "updatedAt" timestamptz not null default timezone('utc', now())
);
```

### Semantica de scope

- `student`: anotacion general del estudiante
- `assignment`: anotacion de una actividad
- `attendance_day`: anotacion de una fecha
- `submission`: anotacion ligada a entrega especifica
- `overview`: anotacion agregada

## Realtime

La estrategia inicial no sera parchear una celda exacta apenas llega un cambio.

### Fase 1

- escuchar cambios en:
  - `Assignment`
  - `Submission`
  - `Enrollment`
  - `LiveClassSession`
  - `LiveClassAttendance`
  - `GradebookAnnotation`
- invalidar el scope actual
- refetch de fila o bloque del tab activo

### Motivo

Este enfoque es mas robusto para:

- columnas dinamicas
- agregados derivados
- overrides de asistencia
- comentarios compartidos

El patch fino por celda puede venir despues si realmente hace falta.

## Persistencia local

Cada tab debe persistir layout de forma separada.

### Namespace recomendado

```text
musiki:dashboard:<userId>:<courseId>:<year>:<tab>
```

### Estado a persistir

- column order
- column width
- sorting
- filters
- search query
- page size
- columnas congeladas si aplica

## Integracion con Google Sheets

No entra en fase 1 del rediseño, pero debe quedar preparada.

### Camino recomendado

- export CSV desde `Tabulator`
- import/export administrado desde API propia
- sincronizacion con Sheets mas adelante via job o edge function

No conviene atar el dashboard al modelo de Sheets como fuente canonica.

## Implementacion por etapas

### Etapa 1: Capa de vista

- reemplazar tablas manuales por `Tabulator`
- tabs: `Overview`, `Gradebook`, `Attendance`, `Comments`, `Admin`
- search box por tab
- persistencia local por usuario

### Etapa 2: Proyecciones limpias

- consolidar builders server-side por tab
- normalizar scope de `courseId`, `year`, `lesson`
- separar mejor metadatos de curso

### Etapa 3: Anotaciones

- crear `GradebookAnnotation`
- context menu
- highlights
- comentarios compartidos entre docentes

### Etapa 4: Realtime

- invalidacion por scope
- refetch incremental
- optimizacion puntual si hace falta

## Riesgos conocidos

- El dashboard actual mezcla datos canonicos con metadatos guardados como submissions especiales.
- La asistencia combina evento crudo live con override manual.
- Un grid reactivo demasiado agresivo puede generar flicker o inconsistencias si no se define bien el scope.

## Criterio de exito

El rediseño se considera exitoso si logra esto:

- roster estable con columnas congeladas
- `Gradebook` y `Attendance` utilizables sin scroll caotico
- search box global por tab
- highlights y comments operativos
- persistencia de layout por usuario
- export CSV
- base canonica intacta

## Decision final

Musiki adopta:

- `Tabulator` como grid del dashboard
- tabs especializados sobre una misma base de roster
- modelo canonico existente como fuente de verdad
- anotaciones operativas en entidad separada
- search box dinamico como feature obligatoria en todas las tablas del dashboard
