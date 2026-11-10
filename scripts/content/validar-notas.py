#!/usr/bin/env python3
"""Valida y corrige el contenido publicable de un course de musiki.

Uso:
    python3 tools/validar-notas.py              # valida
    python3 tools/validar-notas.py --arreglar   # corrige lo mecánico y vuelve a validar
    python3 tools/validar-notas.py --aviso      # informa sin fallar
    python3 tools/validar-notas.py --vault RUTA # valida otro course

Principio: se valida contra lo que se publica, no contra lo que hay en disco.
Las carpetas ignoradas por git —`draft/` entre ellas— no existen para el sitio,
así que un enlace desde `public/` hacia una nota de `draft/` está roto aunque
en Obsidian se vea bien. Es la diferencia que hacía que local y CI no coincidieran.

Qué chequea:

  ERROR   frontmatter que se abre y no cierra
  ERROR   wikilink que no resuelve en el material publicable
  ERROR   tags escalar donde el esquema de Astro pide lista
  ERROR   nota de public/ sin campo def
  ERROR   rastro del aparato normativo archivado
  AVISO   nota de public/ sin status
  AVISO   def demasiado larga para el índice
  AVISO   nota con el slug de un servicio: se muestra plegada dentro de él

Qué corrige con --arreglar:

  · saca de hypo/hyper/connect las relaciones que no resuelven
  · convierte a texto plano los wikilinks colgados del cuerpo
  · envuelve tags en lista
  · agrega status: draft donde falta

No corrige lo que requiere criterio: una def faltante o un rastro normativo
se informan y los resuelve una persona.
"""
import argparse
import json
import os
import re
import unicodedata
import sys

CARPETAS_PUBLICABLES = ('public', 'cursos')


def servicios_con_concepto():
    """slug de nota → servicio que la muestra plegada (service-routes.json, al lado)."""
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'service-routes.json')
    try:
        servicios = json.load(open(ruta, encoding='utf-8')).get('services', [])
    except (OSError, ValueError):
        return {}
    return {s['conceptSlug']: s for s in servicios if s.get('conceptSlug')}


SERVICIOS_CON_CONCEPTO = servicios_con_concepto()
IGNORAR_SIEMPRE = {'.git', '.obsidian', '.trash', 'node_modules', '.github', 'tools'}
RELACIONES = ('hypo', 'hyper', 'connect')

RASTRO_NORMATIVO = re.compile(
    r'§\d|Rúbrica de Evaluación|rúbrica de evaluación|caducidad de la regularidad|'
    r'contrato pedagógico|solicitud de excepción',
)
# §N precedido de un año o de "cap./p." es una cita legítima a un manual,
# por ejemplo (Popper, 1959, §20) o "Notas al pie: §2.13" del manual de APA.
CITA_LEGITIMA = re.compile(r'\d{4}\s*,?\s*§\d|(?:cap\.|p\.|pp\.)[^§]{0,30}§\d|APA|Chicago')


def carpetas_ignoradas_por_git(raiz):
    """Lee .gitignore y devuelve los directorios de primer nivel que se ignoran."""
    ignoradas = set()
    gi = os.path.join(raiz, '.gitignore')
    if os.path.exists(gi):
        for linea in open(gi, encoding='utf-8'):
            linea = linea.strip()
            if not linea or linea.startswith('#'):
                continue
            if linea.endswith('/'):
                ignoradas.add(linea.rstrip('/').lstrip('/'))
    return ignoradas


def archivos_md(raiz, base=None, excluir=frozenset()):
    inicio = os.path.join(raiz, base) if base else raiz
    if not os.path.isdir(inicio):
        return
    for d, subd, fs in os.walk(inicio):
        subd[:] = [s for s in subd if s not in IGNORAR_SIEMPRE and s not in excluir]
        for f in sorted(fs):
            if f.endswith('.md'):
                yield os.path.join(d, f)


def partir(texto):
    """Devuelve (frontmatter_crudo, cuerpo, fin_del_frontmatter)."""
    m = re.match(r'^---\n(.*?)\n---\n?', texto, re.S)
    if not m:
        return None, texto, 0
    return m.group(1), texto[m.end():], m.end()


def campos(fm_crudo):
    d = {}
    if not fm_crudo:
        return d
    for linea in fm_crudo.split('\n'):
        mm = re.match(r'^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$', linea)
        if mm:
            d[mm.group(1)] = mm.group(2).strip()
    return d


def sin_bloques_de_codigo(texto):
    return re.sub(r'^```.*?^```', '', texto, flags=re.S | re.M)


def slug_de(nombre):
    """El mismo slug que arma remark-wiki-link a partir del nombre de archivo."""
    v = unicodedata.normalize('NFD', str(nombre or '').strip().lower())
    v = ''.join(c for c in v if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', '-', v).strip('-')


def enlaces(texto):
    return [m.strip() for m in re.findall(r'\[\[([^\]|#]+)', texto) if m.strip()]


def tags_sin_lista(valor):
    """True si `tags` trae un escalar donde el esquema espera una lista.

    Vacío no es error: el campo es opcional. `[...]` ya es lista en línea, y una
    lista en bloque (`tags:` y guiones abajo) deja el valor vacío en esta línea.
    """
    v = (valor or '').strip()
    return bool(v) and not v.startswith('[')


# --------------------------------------------------------------------------- #

def arreglar(raiz, publicables, en_draft):
    """Corrige lo mecánico. Devuelve la lista de cambios hechos."""
    hechos = []
    for base in CARPETAS_PUBLICABLES:
        for p in archivos_md(raiz, base):
            rel = os.path.relpath(p, raiz)
            texto = open(p, encoding='utf-8').read()
            original = texto
            fm_crudo, cuerpo, fin = partir(texto)

            # 1. relaciones colgadas en el frontmatter
            if fm_crudo:
                nuevo_fm = fm_crudo
                for rel_campo in RELACIONES:
                    # formato en línea: connect: ["[[a]]", "[[b]]"]
                    m = re.search(rf'^{rel_campo}:\s*\[(.*?)\]\s*$', nuevo_fm, re.M)
                    if m:
                        items = re.findall(r'"\[\[([^\]]+)\]\]"', m.group(1))
                        quedan = [i for i in items if i.split('|')[0].strip() in publicables]
                        if len(quedan) != len(items):
                            for i in items:
                                if i.split('|')[0].strip() not in publicables:
                                    hechos.append(f'{rel}: saqué {rel_campo} [[{i}]]')
                            valor = ', '.join(f'"[[{i}]]"' for i in quedan)
                            nuevo_fm = nuevo_fm[:m.start()] + f'{rel_campo}: [{valor}]' + nuevo_fm[m.end():]
                    # formato en lista:
                    #   connect:
                    #     - "[[a]]"
                    m2 = re.search(rf'^{rel_campo}:\s*$\n((?:\s+-\s+.*\n?)*)', nuevo_fm, re.M)
                    if m2:
                        lineas = m2.group(1).rstrip('\n').split('\n')
                        quedan_l = []
                        for ln in lineas:
                            mm = re.search(r'\[\[([^\]]+)\]\]', ln)
                            if mm and mm.group(1).split('|')[0].strip() not in publicables:
                                hechos.append(f'{rel}: saqué {rel_campo} [[{mm.group(1)}]]')
                            else:
                                quedan_l.append(ln)
                        bloque = ('\n'.join(quedan_l) + '\n') if quedan_l else ''
                        nuevo_fm = nuevo_fm[:m2.start()] + f'{rel_campo}:\n' + bloque + nuevo_fm[m2.end():]

                # 2. slug desalineado del nombre de archivo
                ms = re.search(r'^slug:[ \t]*(\S.*)$', nuevo_fm, re.M)
                if ms and base == 'public':
                    esperado = slug_de(os.path.basename(p)[:-3])
                    if ms.group(1).strip().strip('"').strip("'") != esperado:
                        nuevo_fm = nuevo_fm[:ms.start(1)] + esperado + nuevo_fm[ms.end(1):]
                        hechos.append(f'{rel}: alineé el slug con el nombre de archivo')
                elif ms and base == 'cursos':
                    nuevo_fm = re.sub(r'^slug:[^\n]*\n?', '', nuevo_fm, count=1, flags=re.M)
                    hechos.append(f'{rel}: saqué el slug (en cursos/ reemplaza el id)')

                # 3. tags escalar donde el esquema pide lista
                mt = re.search(r'^tags:[ \t]*(\S.*)$', nuevo_fm, re.M)
                if mt and tags_sin_lista(mt.group(1)):
                    nuevo_fm = nuevo_fm[:mt.start(1)] + f'[{mt.group(1).strip()}]' + nuevo_fm[mt.end(1):]
                    hechos.append(f'{rel}: puse tags como lista')

                # 4. status faltante
                if not re.search(r'^status:\s*\S', nuevo_fm, re.M) and base == 'public':
                    nuevo_fm = nuevo_fm.rstrip('\n') + '\nstatus: draft'
                    hechos.append(f'{rel}: agregué status: draft')

                if nuevo_fm != fm_crudo:
                    # sacar relaciones puede dejar líneas en blanco sueltas
                    nuevo_fm = re.sub(r'\n\s*\n', '\n', nuevo_fm)
                    texto = '---\n' + nuevo_fm.rstrip('\n') + '\n---\n' + cuerpo

            # 3. wikilinks colgados en el cuerpo → texto plano
            fm2, cuerpo2, _ = partir(texto)
            def a_texto(m):
                destino = m.group(1).split('|')[0].strip()
                if destino in publicables:
                    return m.group(0)
                visible = m.group(1).split('|')[-1].strip()
                hechos.append(f'{rel}: pasé a texto plano [[{destino}]]')
                return visible
            cuerpo_nuevo = re.sub(r'\[\[([^\]#]+?)\]\]', a_texto, cuerpo2)
            if cuerpo_nuevo != cuerpo2:
                texto = ('---\n' + fm2.rstrip('\n') + '\n---\n' + cuerpo_nuevo) if fm2 else cuerpo_nuevo

            if texto != original:
                open(p, 'w', encoding='utf-8').write(texto)
    return hechos


def visible(base, fm):
    """Si la nota tiene página propia en el sitio.

    En public/ la ruta exige status: public, cualquier otro valor la deja sin URL.
    En cursos/ se ve todo lo que no sea draft ni private.
    """
    status = (fm.get('status') or '').strip().strip('"').strip("'").lower()
    if base == 'public':
        return status == 'public'
    return status not in ('draft', 'private')


def validar(raiz, publicables, en_draft, sin_ruta=frozenset()):
    errores, avisos = [], []
    for base in CARPETAS_PUBLICABLES:
        for p in archivos_md(raiz, base):
            rel = os.path.relpath(p, raiz)
            texto = open(p, encoding='utf-8').read()

            if texto.startswith('---\n') and '\n---' not in texto[4:]:
                errores.append(f'{rel}: el frontmatter se abre y no se cierra')
                continue

            fm_crudo, cuerpo, _ = partir(texto)
            fm = campos(fm_crudo)

            # tags es el único campo que el esquema de Astro exige como lista:
            # z.array(z.string()). Un valor pelado rompe el build entero —no la
            # nota, el build— y el error aparece recién en el VPS, después del
            # pull y del npm ci, con el deploy a medias.
            if tags_sin_lista(fm.get('tags')):
                errores.append(
                    f'{rel}: tags: {fm["tags"]} tiene que ser lista — '
                    f'tags: [{fm["tags"]}]. Así como está, rompe el build')

            for destino in enlaces(texto):
                # Existe, pero en public/ sin status: public no tiene URL: el
                # enlace termina en /cursos. Sólo importa si quien enlaza se ve.
                if destino in sin_ruta and visible(base, fm):
                    errores.append(
                        f'{rel}: [[{destino}]] está en public/ sin status: public, así que '
                        f'no tiene página y el enlace termina en /cursos')
                    continue
                if destino in publicables:
                    continue
                if destino in en_draft:
                    errores.append(
                        f'{rel}: [[{destino}]] existe en draft/, que no se publica. '
                        f'Publicá la nota o sacá el enlace')
                else:
                    errores.append(f'{rel}: enlace roto [[{destino}]]')

            for n, linea in enumerate(sin_bloques_de_codigo(texto).split('\n'), 1):
                if not RASTRO_NORMATIVO.search(linea):
                    continue
                if 'Reglamento de Estudios' in linea or CITA_LEGITIMA.search(linea):
                    continue
                errores.append(f'{rel}:{n}: rastro normativo archivado — {linea.strip()[:70]}')

            # En cursos/ el slug del frontmatter no es un alias: Astro lo toma como
            # id de la entrada y la nota deja de ser s123/..., así que la materia
            # no la encuentra por ninguna URL. Alinearlo no alcanza; tiene que irse.
            if base == 'cursos' and (fm.get('slug') or '').strip():
                errores.append(
                    f'{rel}: slug "{fm["slug"].strip()}" en una nota de curso. Saca la '
                    f'nota de la materia y todo enlace a ella termina en /cursos')

            if base != 'public':
                continue

            d = (fm.get('def') or '').strip().strip('"').strip("'")
            if not d:
                errores.append(f'{rel}: falta el campo def (no va a aparecer en el índice)')
            elif len(d) > 320:
                avisos.append(f'{rel}: def de {len(d)} caracteres, el índice la va a cortar')

            if not fm.get('status'):
                avisos.append(f'{rel}: sin status (se publica como visible normal)')

            # Los wikilinks se resuelven por nombre de archivo, no por el slug del
            # frontmatter. Si no coinciden, [[la nota]] apunta a una URL que no existe.
            declarado = (fm.get('slug') or '').strip().strip('"').strip("'")
            esperado = slug_de(os.path.basename(p)[:-3])
            if declarado and declarado != esperado:
                errores.append(
                    f'{rel}: slug "{declarado}" no coincide con el nombre de archivo '
                    f'("{esperado}"). Los [[enlaces]] a esta nota van a romperse')

            # La URL es del servicio (la que tienen los alumnos); la nota no tiene
            # página propia y se ve plegada al pie del servicio, en #concepto.
            servicio = SERVICIOS_CON_CONCEPTO.get(esperado)
            if servicio:
                avisos.append(
                    f'{rel}: comparte la URL con el servicio {servicio["id"]} de '
                    f'{servicio["courseId"]}; se muestra plegada dentro de él (#concepto)')

    return errores, avisos


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('--vault', default=None, help='raíz del course a validar')
    ap.add_argument('--arreglar', action='store_true', help='corrige lo mecánico')
    ap.add_argument('--aviso', action='store_true', help='informa sin fallar')
    args = ap.parse_args()

    raiz = os.path.abspath(args.vault) if args.vault \
        else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    ignoradas = carpetas_ignoradas_por_git(raiz)

    # lo que ve el sitio
    publicables = set()
    for base in CARPETAS_PUBLICABLES:
        if base in ignoradas:
            continue
        for p in archivos_md(raiz, base):
            publicables.add(os.path.basename(p)[:-3])
    # lo que existe sólo en disco, para dar un mensaje útil
    en_draft = set()
    for carpeta in ignoradas:
        for p in archivos_md(raiz, carpeta):
            en_draft.add(os.path.basename(p)[:-3])

    if args.arreglar:
        hechos = arreglar(raiz, publicables, en_draft)
        for h in hechos:
            print(f'  arreglado · {h}')
        if not hechos:
            print('  no había nada mecánico para arreglar')
        print()

    # notas de public/ que existen pero no tienen página
    sin_ruta = set()
    if 'public' not in ignoradas:
        for p in archivos_md(raiz, 'public'):
            fm, _, _ = partir(open(p, encoding='utf-8').read())
            if not visible('public', campos(fm)):
                sin_ruta.add(os.path.basename(p)[:-3])

    errores, avisos = validar(raiz, publicables, en_draft, sin_ruta)

    for a in avisos:
        print(f'  aviso · {a}')
    for e in errores:
        print(f'  ERROR · {e}')

    print()
    print(f'{len(errores)} errores · {len(avisos)} avisos '
          f'· {len(publicables)} notas publicables')

    if errores and not args.aviso:
        print()
        print('No se publica así.')
        print('  · enlace a draft/  → publicá la nota, o corré --arreglar para sacar el enlace')
        print('  · enlace roto      → la nota se renombró o se borró; --arreglar lo limpia')
        print('  · sin status public → la nota de public/ no tiene página: status: public, '
              'o sacá el enlace')
        print('  · falta def        → la escribe una persona: una a tres oraciones autocontenidas')
        print('  · rastro normativo → sacar la remisión al aparato archivado')
        print('  · slug ≠ archivo   → los [[enlaces]] resuelven por nombre de archivo; '
              '--arreglar lo alinea')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
