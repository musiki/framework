# Estrategias de URL — Musiki Framework

Especificación técnica del sistema de enrutamiento, permisos y resolución de contenido.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | Astro 6, SSR (`prerender = false`) |
| Autenticación | Supabase Auth + middleware de sesión |
| Contenido | Astro Content Layer API (`glob` loader) |
| Slugificación | `githubSlug()` (Astro interno) + `toCoursePathSlug()` (custom) |
| Enrutamiento | Un único catch-all `[...slug].astro` |

---

## Colecciones de contenido

```
src/content/
  content/          # Contenido wiki general (conceptos, referencias)
  cursos/
    i1/             # Curso "Instrumento I"
      _index.md     # Metadatos del curso (id, nombre, public, etc.)
      01-cap/
        Lección.md  # Lección con type: lesson
    s123/           # Otro curso
      _index.md
  public/           # Acceso directo sin login (concepts, glossary, etc.)
```

### Cómo Astro genera entry IDs

El loader `glob` asigna `entry.id` así:

1. Si el frontmatter tiene `slug:` → ese valor se usa directamente como ID
2. Si no → `githubSlug()` sobre los segmentos de path relativos al directorio de la colección
   - Normaliza acentos, espacios → guiones, minúsculas

```
Introducción a la Organología.md  →  i1/03-organología/introducción-a-la-organología
(sin slug en frontmatter)
```

```
acustica.md  +  slug: acustica-c1  →  acustica-c1
```

---

## Arquitectura de URL

### URL pública (sin login)

```
/{slug}
```

Ejemplos:
- `/objetodesonidomovimiento` → concepto público
- `/introduccion-a-la-organologia` → redirige a `/i1/introduccion-a-la-organologia`

### URL de curso (con login o curso público)

```
/{coursePathSegment}/{lessonSlug}
```

Ejemplos:
- `/i1/introduccion-a-la-organologia`
- `/i1/foro`
- `/i1` → raíz del curso

### URL de slides (presentaciones Reveal.js)

```
/slides/{slug}                           # contenido general
/slides/{coursePathSegment}/{lessonSlug} # lección de curso
```

### URL legacy (redirección automática)

```
/cursos/{anything}  →  /{anything}   # prefijo /cursos/ eliminado
```

---

## Mapa de permisos

| URL pattern | Sin sesión | Con sesión (inscripto) | Admin |
|-------------|-----------|----------------------|-------|
| `/{slug}` (content público) | ✅ acceso | ✅ acceso | ✅ |
| `/{slug}` (concepto/glossary en `cursos/`) | ✅ si `status: public\|published` | ✅ | ✅ |
| `/{courseId}` (curso con `public: true`) | ✅ | ✅ | ✅ |
| `/{courseId}` (curso privado) | ↩ `/cursos` | ✅ si inscripto | ✅ |
| `/{courseId}/{lessonSlug}` | según curso | ✅ | ✅ |
| `/{courseId}/foro` | según curso | ✅ | ✅ |
| `/slides/{slug}` | ✅ si entry público | ✅ | ✅ |

La comprobación de sesión ocurre en `[...slug].astro` vía `Astro.locals.session` (inyectado por middleware de Supabase).

---

## Pipeline de resolución — `[...slug].astro`

```
GET /{slug}
     │
     ▼
1. Decodificar segmentos URL → slug normalizado
     │
     ├─ slug.startsWith('cursos/') → redirect(/{rest})
     │
     ▼
2. Intentar identificar curso
   canonicalizeCourseId(parts[0])
   getEntry('cursos', `${id}/_index`)
   → canonicalCourseId | null
     │
     ▼
3. Buscar en índice de rutas públicas (getPublicContentStaticPaths)
   normalizedRequestedSlug = normalizeContentSlug(slug)
   normalizedLessonPath    = normalizeContentSlug(parts.slice(1))
   
   routeMatch = find by normalizedRequestedSlug
              || (parts.length > 1) find by normalizedLessonPath
     │
     ├─ route.kind === 'redirect'
     │     └─ normalize(redirectTo) !== normalize(currentPath) → redirect()
     │        (guarda anti-bucle: si redirige a sí mismo, ignorar)
     │
     └─ route.kind === 'content' && (!canonicalCourseId || parts.length > 1)
           → publicEntry = getEntry(route.collection, route.entryId)
             render() → PublicContent
     │
     ▼
4. Resolver contexto de curso final
   requestedCourseId = canonicalCourseId
                     || (session && publicEntry?.data.project)
   
   courseIndex = getEntry('cursos', `${finalId}/_index`)
     │
     ├─ !publicEntry && !courseIndex → redirect('/cursos')
     │
     ▼
5. Construir path index de lecciones
   buildCourseLessonPathIndex(canonicalCourseId, courseData, lessons)
     │
     ▼
6. Resolver lección solicitada (si hay path)
   findLessonByCoursePath(lessonPathPart, pathIndex)
   → { entry, shortPath, isLegacyPath }
     │
     ├─ isLegacyPath → redirect(/{courseSegment}/{shortPath})
     │
     └─ encontrado → render lección
     │
     ▼
7. Renderizar layout con todos los datos resueltos
```

---

## Sistema de slugs para contenido público

### `buildContentRouteIndex()` (public-content-routes.ts)

Construye un índice de todas las rutas públicas en el momento del primer request (cacheado en módulo).

**Para cada entrada en `content/`** con `status: public|published` (o sin status):

Tres estrategias de slug en orden de prioridad, registrando sólo matches únicos (`registerUniqueMatches`):

1. `getContentFrontmatterSlug(entry)` → campo `slug` del frontmatter
2. `getContentFilenameSlug(entry)` → nombre de archivo sin extensión, normalizado
3. `getContentTitleSlug(entry)` → campo `title` slugificado

El slug ganador es el **canonical**. Los demás se registran como **redirects** al canonical.

**Para cada lección de cursos** (`type: lesson`):

Se generan entradas `{ kind: 'redirect', redirectTo: '/{courseSegment}/{lessonSlug}' }` para los slugs de filename y title. Esto permite llegar a `/i1/introduccion-a-la-organologia` escribiendo solo `/introduccion-a-la-organologia`.

> **Bug conocido (resuelto):** Si el slug de la lección coincide exactamente con `{courseSegment}/{lessonSlug}`, el redirect apuntaba a sí mismo → bucle infinito 302. Solucionado en `[...slug].astro` con guarda de normalización antes de ejecutar cualquier redirect.

---

## Sistema de slugs para lecciones de cursos

### `buildCourseLessonPathIndex()` (course-routing.ts)

Para cada lección, genera tres tipos de paths:

| Tipo | Descripción | Uso |
|------|-------------|-----|
| `entryByShortPath` | Slug limpio derivado del título/slug/filename | URL canónica |
| `entryByLegacyPath` | Path completo relativo al directorio del curso | Compatibilidad backward |
| `entryByAliasPath` | Slugs alternativos (filename si el primario es del título) | Redirects silenciosos |

**`getLessonBaseSlug(entry)`** — algoritmo de prioridad:

1. Frontmatter `slug` (leído del FS con gray-matter, cacheado)
2. Frontmatter `shortSlug`
3. Frontmatter `title`
4. Nombre de archivo fuente

Todo pasa por `toCoursePathSlug()`: NFD normalización → strip diacríticos → minúsculas → `[^a-z0-9]+` → guiones.

**Desambiguación de duplicados:** si dos lecciones generan el mismo slug base, la segunda usa el slug del filename, y si también colisiona, agrega sufijo numérico (`-2`, `-3`, …).

### `findLessonByCoursePath()` — orden de búsqueda

1. `entryByLegacyPath` (si encontrado → redirige al shortPath canónico)
2. `entryByShortPath` (URL canónica)
3. `entryByAliasPath` (si encontrado → redirige al shortPath canónico)

---

## `getPreferredCoursePathSegment()`

Determina el segmento URL del curso (`i1`, `s123`, etc.):

1. `getCourseFrontmatterId(courseData, canonicalCourseId)` → campo `id` del `_index.md`
2. Si no hay `id` en frontmatter → `canonicalCourseId` (nombre del directorio)

Resultado pasa por `toCoursePathSlug()`.

---

## Normalización de slugs

### `toCoursePathSlug(value)` — usado para lecciones y cursos

```
NFD decompose → strip [\u0300-\u036f] → toLowerCase → [^a-z0-9]+ → '-' → trim '-'
```

Ejemplos:
- `"Introducción a la Organología"` → `"introduccion-a-la-organologia"`
- `"objeto de sonido-movimiento"` → `"objeto-de-sonido-movimiento"`

### `normalizeContentSlug(slug)` — usado en el router

```
decodeURIComponent → toLowerCase → normalize spaces/separators → trim
```

### `encodePathSegments(value)` — usado al construir hrefs

```
split('/') → encodeURIComponent por segmento → rejoin('/')
```

Garantiza que slugs con caracteres especiales sean válidos en URLs.

---

## Slides (`/slides/`)

Una ruta separada (`slides/[...slug].astro` o similar) sirve presentaciones Reveal.js.

- Solo disponible para entries con `theme:`, `slideTheme:`, o `revealTheme:` en frontmatter
- El slug de slides es el mismo canonical slug que el de content
- Para lecciones de cursos: `/slides/{courseSegment}/{lessonSlug}`
- Listado de rutas generado por `getPublicSlidesStaticPaths()` (mismo `buildContentRouteIndex()`, separado en `slidePaths`)

---

## Alias de cursos — `canonicalizeCourseId()`

Permite que un curso responda a múltiples slugs (por ej. `instrumento-i` → `i1`).

- Tabla de alias en `course-alias.ts`
- `getCourseAliases()` devuelve `Map<alias, canonicalId>`
- Siempre se trabaja con el ID canónico internamente

---

## Diagrama de permisos y flujo completo

```
Usuario anónimo
  │
  ├─ GET /objetodesonidomovimiento
  │    → routeMatch kind:'content', collection:'cursos', entryId:'...'
  │    → getEntry + render → WikiLayout (sin sidebar de curso)
  │
  ├─ GET /introduccion-a-la-organologia
  │    → routeMatch kind:'redirect', redirectTo:'/i1/introduccion-a-la-organologia'
  │    → normalize check: distinto → 302
  │
  └─ GET /i1
       → canonicalCourseId = 'i1'
       → courseIndex.data.public = true → acceso
       → no lessonPath → render curso raíz

Usuario autenticado (inscripto en i1)
  │
  └─ GET /i1/introduccion-a-la-organologia
       → canonicalCourseId = 'i1'
       → routeMatch kind:'redirect', redirectTo:'/i1/introduccion-a-la-organologia'
       → normalize check: MISMO path → skip redirect (anti-bucle)
       → session existe → courseIndex cargado
       → findLessonByCoursePath('introduccion-a-la-organologia', pathIndex)
       → found via entryByShortPath
       → render lección
```

---

## Archivos clave

| Archivo | Responsabilidad |
|---------|----------------|
| `src/pages/[...slug].astro` | Router principal, resolución de sesión y renderizado |
| `src/lib/public-content-routes.ts` | Índice de rutas públicas (redirects + content entries) |
| `src/lib/course-routing.ts` | Path index de lecciones, slugificación, hrefs canónicos |
| `src/lib/content-slug.ts` | Normalización y extracción de slugs de entries |
| `src/lib/course-alias.ts` | Tabla de aliases de IDs de cursos |
| `src/lib/course-metadata.ts` | Lectura de metadatos del `_index.md` de cada curso |
| `src/content.config.ts` | Definición de colecciones Astro (glob loader) |

---

## Patrones de diseño

### Single catch-all router
Todo el contenido pasa por `[...slug].astro`. Evita multiplicidad de rutas Astro y centraliza la lógica de permisos.

### Índice cacheado en módulo
`buildContentRouteIndex()` se ejecuta una sola vez por proceso (warm cache) gracias a `routeIndexPromise`. Apropiado para SSR donde cada worker reutiliza el módulo.

### Redirect-first para aliases
En vez de resolver aliases directamente, se emiten `{ kind: 'redirect' }`. El browser actualiza la URL, evitando contenido duplicado y preservando la URL canónica en historial.

### Guarda anti-bucle de redirect
Antes de ejecutar cualquier redirect, se normaliza `redirectTo` y `currentPath` y se compara. Si son iguales, el redirect se ignora y la resolución continúa con el contexto de curso. Previene bucles 302 cuando el slug público coincide con la URL de la lección de curso.

### `registerUniqueMatches` — resolución sin colisiones
Solo se registra un slug si apunta a exactamente un entry. Si dos entries comparten slug (filename/title), ninguna de las dos gana ese slug — se evitan redirects ambiguos.
