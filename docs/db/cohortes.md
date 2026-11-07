# Cohortes

Hasta noviembre de 2026, `Enrollment` no tenía ninguna dimensión de período: una
materia era una lista plana de inscriptos, para siempre. Al empezar 2027 los alumnos
de 2026 seguían adentro, no había forma de abrir una comisión 2, y las entregas se
acumulaban sin frontera de cuatrimestre.

## El modelo

```
Cohort(id, courseId, label, year, term, startsAt, endsAt, isActive, createdAt, createdBy)
Enrollment(... , cohortId → Cohort.id)
```

`label` es texto libre y visible —cada carrera nombra distinto— pero la sugerencia
sigue un formato único para que la lista quede ordenable a ojo:

```
2027
2027 · 2do cuatrimestre
2027 · Comisión 2
2027 · 1er cuatrimestre · Comisión 2
```

Dos índices sostienen las reglas: uno único sobre `(courseId, label)`, para que no
haya dos cohortes con el mismo nombre, y uno **parcial** sobre `(courseId) WHERE
isActive`, que garantiza una sola cohorte activa por materia sin impedir que haya
muchas inactivas.

## Por qué la migración es aditiva

Veintiséis archivos consultan `Enrollment` y ninguno sabe de cohortes. `cohortId` es
nullable, y la tabla no tenía ningún unique sobre `(userId, courseId)` que hubiera
que tocar —sólo PK en `id` y FK a `User`—, así que todas las consultas existentes
siguen devolviendo exactamente lo mismo.

El backfill crea una cohorte `Histórica` por materia, activa, y le asigna todo lo que
ya existía. Nada cambia el día que corre. El filtrado por cohorte se agrega después,
donde corresponda, y no de golpe.

Que un estudiante pueda estar en dos cohortes de la misma materia es deliberado: es
alguien que recursa.

## El botón

`POST /api/admin/cohorts`

```json
{ "courseId": "s123", "year": 2027, "term": "anual", "comision": null,
  "activate": true, "copyTeachers": true }
```

Qué hace:

- crea la cohorte y, si `activate`, la deja como la activa de la materia
- copia las inscripciones de staff de la cohorte que estaba activa
- **no toca las inscripciones viejas**: la cohorte anterior queda entera, con su gente
  y sus entregas. Esto no archiva ni borra nada

Esa es toda la gracia: los docentes se arrastran, los estudiantes no.

`activate: false` crea la cohorte sin activarla, para prepararla antes de que empiece
el cuatrimestre.

`GET /api/admin/cohorts?courseId=s123` lista las cohortes con el conteo de estudiantes
y de staff de cada una.

Ambos exigen `resolveLiveManageAccess`: sólo docentes de esa materia.

Como el índice parcial impide dos activas, el endpoint baja la anterior antes de
insertar la nueva. Si algo falla en el medio, repone la anterior para no dejar la
materia sin cohorte activa.

## Lo que falta probar contra una base real

Lo escrito acá se verificó leyendo el esquema del dump y con tests de la lógica pura
(13 casos en `src/lib/cohorts/cohort-labels.test.mjs`). **No se probó contra Postgres**,
porque esta sesión no tenía base. Antes de usarlo en producción conviene:

1. correr la migración sobre una copia del dump y comprobar el backfill
2. crear una cohorte de prueba en una materia de juguete y ver que el staff se copia
3. forzar un error después del `UPDATE ... isActive = false` y verificar que repone

El paso 3 es el único camino del endpoint que no tiene red de contención automática.

## Lo que viene

Cuando el itinerario sea un objeto de primera clase (etapa 4 del plan de itinerario),
la cohorte es su contraparte del lado de las personas: un cuatrimestre es un itinerario
más una cohorte. Ahí tiene sentido que duplicar el itinerario del año anterior y crear
la cohorte nueva sean el mismo botón.
