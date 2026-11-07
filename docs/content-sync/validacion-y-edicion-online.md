# Validación de contenido y edición online

Cómo llega al sitio un cambio hecho por un docente que no usa git.

## El recorrido

1. El docente edita una nota en el editor de musiki.
2. `POST /api/content-admin/publish` agrega al frontmatter `updatedAt`, `updatedBy`
   (`Nombre <email>`) y `editSummary`, y commitea a GitHub con `author` = el docente
   y `committer` = el bot de musiki. El `sha` del archivo funciona como bloqueo
   optimista: si alguien lo tocó mientras tanto, responde 409 y pide recargar.
3. El push dispara el workflow del repo de la materia, que valida, recompila lo que
   haga falta y avisa al Content Bus.
4. `sync-content-sources.yml` sincroniza y el logo del header late mientras corre.

El framework nunca se redespliega por un cambio de contenido.

## `publicPublishMode`: el detalle que confundía

En `config/sources.manifest.json`, cada materia puede declarar cómo llegan al repo
las ediciones bajo `public/`:

| Valor | Qué hace |
|---|---|
| `pr` (default) | abre una rama `editor/<docente>/<timestamp>` y un pull request |
| `direct` | commitea derecho a la rama, igual que ya hacían las ediciones bajo `cursos/` |

El default histórico es `pr` para todo lo que está en `public/`. Eso está bien cuando
hay alguien que mergea, y es una trampa cuando no lo hay: el editor dice que publicó,
el PR queda abierto y el sitio nunca cambia. Una materia cuyos docentes editan online
sin paso de revisión quiere `direct`.

`s123` está en `direct`. Las demás siguen en `pr`, sin cambios.

## Validador global y validador local

El validador vive en el framework, en `scripts/content/validar-notas.py`, y lo llaman
los repos de las materias a través del workflow reutilizable
`.github/workflows/validar-contenido.yml`. Ninguna materia necesita su copia.

Desde el repo de una materia:

```yaml
jobs:
  validar:
    uses: musiki/framework/.github/workflows/validar-contenido.yml@main
```

Si una materia necesita reglas propias, deja su `tools/validar-notas.py` y el workflow
lo prefiere sobre el global. Global primero; local sólo cuando haga falta.

### Qué valida

Contra lo que se publica, no contra lo que hay en disco. Las carpetas ignoradas por
git —`draft/` entre ellas— no existen para el sitio, así que un enlace desde `public/`
hacia una nota de `draft/` está roto aunque en Obsidian se vea bien. Esa diferencia
era la que hacía que una validación local en verde fallara en CI.

Errores: frontmatter sin cerrar, wikilink que no resuelve, nota de `public/` sin `def`,
rastros de aparatos normativos archivados. Avisos: falta `status`, `def` muy larga.

### Qué corrige solo

Con `--arreglar`: saca de `hypo`/`hyper`/`connect` las relaciones que no resuelven,
pasa a texto plano los wikilinks colgados del cuerpo y agrega `status: draft` donde
falta. No toca lo que pide criterio: una `def` faltante la escribe una persona.

```bash
python3 scripts/content/validar-notas.py --vault ../s123
python3 scripts/content/validar-notas.py --vault ../s123 --arreglar
```
