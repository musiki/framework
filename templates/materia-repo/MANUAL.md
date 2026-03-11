# MANUAL

## `course`

`type`
- `course`

`required`
- `title`
- `id`

`optional`
- `subtitle`
- `description`
- `summary`
- `instructor`
- `year`
- `duration`
- `coverImage`
- `tags`
- `public`

## `lesson`

`type`
- `lesson`

`required`
- `title`
- `chapter`
- `order`

`recommended`
- `summary`
- `slug`

`optional`
- `status`
- `theme`

## `assignment`

Pendiente.

## `form`

Pendiente.

## `slug`

- customiza la URL
- se normaliza para web
- si no existe, se deriva del título o del filename

## `visibility`

- no usar `visibility: enrolled-only` dentro de `cursos/`
- usar sólo `visibility: public` cuando una note de `cursos/` se quiere promover a `public/`

## `status`

- sin `status` o `status: published`: visible normal
- `status: draft`: visible con badge “Material en preparación”
- `status: nonshown`: reservado para ocultar una note a estudiantes

## `theme`

- habilita vista slides
- `theme: zztt` busca `/inc/reveal/css-themes/zztt.css`
- también acepta otros nombres o una ruta CSS completa
