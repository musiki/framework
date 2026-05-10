# RECURSOS Course, Class, Session Model

Date: 2026-05-10

## Goal

RECURSOS should be editable from both surfaces:

- the live room `RECURSOS` pod
- the normal course view `80 RECURSOS` / resource editor

Both surfaces should operate on the same conceptual tree:

```text
Curso
  Recursos generales del curso
  Clase / capitulo
    Recursos generales de la clase
    Sesion
      Carpeta
        Recurso
```

The normal course selector already defines the course. The editor should not ask for, or visually expose, a room/sala when the user is preparing course resources.

## Terminology

- `Curso`: the top-level course, such as `s123`, `i1`, `i2`, or `cym`. This is selected by the course page and should be implicit in the resource editor.
- `Clase / capitulo`: a pedagogical grouping derived from course content, usually the YAML `chapter` concept or, in the current room implementation, the active Reveal/presentation entry. In the database this is currently stored in `claseId`.
- `Sesion`: an event/history layer under a class. In the database this is `ResourceSession` and resource rows can point to it through `sessionId`.
- `Carpeta`: the user-facing folder inside a session or class, such as `DOC`, `media`, `compartidos`, or a custom folder.
- `Sala`: live-room transport context. This is currently stored as `roomName`, but it should be treated as implementation plumbing in the resource editor.

## Current Implementation Notes

The database names are usable but semantically overloaded:

- `LiveClassResource.claseId` is not always a course id. In the room it is populated from the active presentation/lesson context.
- `LiveClassResource.sessionId` already exists and should become the shared link between room sessions and normal-view editing.
- `LiveClassResource.roomName` is still required by existing room APIs and autosave, but the editor can default it to `${courseId}-stage`.
- `ResourceSession` already stores `roomName`, `courseId`, `claseId`, `name`, and `createdAt`.
- `courseRootId` was added to the room save payload because `claseId` alone cannot reliably identify the course root for markdown projection.

## Editor UX Contract

The `Vincular URL a RECURSOS` form should expose:

- `URL`
- `Nombre`
- `Carpeta`
- `Clase / capitulo`
- `Sesion`

It should not expose:

- `Sala`
- low-level room identifiers

Rules:

- Empty `Clase / capitulo` means course-level resource.
- Empty `Sesion` means not tied to a session.
- A selected `Sesion` must be compatible with the selected class/chapter when possible.
- The course is implicit from the current page.

## Shared Editing Contract

Both the room pod and normal-view editor should read/write:

- the same `ResourceSession` rows
- the same `LiveClassResource.sessionId`
- the same folders and resource metadata

The room pod can remain optimized for live use, while the normal editor can be optimized for preparation and cleanup.

## Implemented Surface

- Normal editor lists discovered sessions for the current course and allows renaming them.
- Normal editor can create sessions and attach a linked resource to a session.
- Normal editor resource rows expose `Nombre`, `Carpeta`, `Clase / capitulo`, and `Sesion`.
- Room `RECURSOS` sessions created from the pod now store `courseId` in addition to `roomName` and `claseId`.
- Room `RECURSOS` session context menu can rename the active session, writing through the same `/api/live/session` endpoint.
- Normal editor resource saves persist both `claseId` and `sessionId`, then refresh the markdown projection.
- Room `RECURSOS` session list renders files under each session and lazy-loads session resources from the database when needed.
- Room file-drop, paste, chat, and external-media resources now attach to the active session.
- Normal editor groups resources directly under each session and supports dragging rows between sessions.
- Course sidebar `80 RECURSOS` renders a session/resource tree from Postgres; markdown projection remains as a background compatibility layer.

## Migration Direction

Short term:

- Keep database column names unchanged.
- Hide `roomName` in the editor.
- Add session list/create support to the normal editor.
- Store `sessionId` when linking resources from normal view.
- Continue projecting resources into `80 RECURSOS` markdown for course navigation.

Medium term:

- Make room resource loading explicitly aware of `sessionId`, with an "all/current session" mode.
- Add richer editor filtering by `Clase / capitulo`, `Sesion`, and `Carpeta`.
- Consider using chapter identifiers consistently instead of active lesson ids for `claseId`.

Long term:

- Consider a schema cleanup where `courseId`, `chapterId`, and `sessionId` are first-class fields.
- Keep `roomName` only for live transport/session compatibility.
