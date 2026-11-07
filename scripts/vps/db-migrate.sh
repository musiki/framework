#!/usr/bin/env bash
#
# Aplica las migraciones pendientes. Corre EN EL VPS, donde la base es local.
#
#   ./scripts/vps/db-migrate.sh             # aplica lo que falte
#   ./scripts/vps/db-migrate.sh --status    # sólo informa, no toca nada
#   ./scripts/vps/db-migrate.sh --dry-run   # aplica y revierte, para validar
#   ./scripts/vps/db-migrate.sh --baseline <hasta>  # marca como aplicado HASTA ese archivo
#   ./scripts/vps/db-migrate.sh --unmark <archivo>  # desmarca una, para volver a correrla
#
# Reemplaza al par db-tunnel + psql desde la laptop. Ese esquema venía de cuando
# se desarrollaba local contra la base remota; hoy el camino local → github → vps
# es directo y el túnel sólo agregaba un punto de falla silencioso: un forward de
# SSH acepta conexiones locales aunque el otro extremo esté caído, así que
# cualquier chequeo de puerto daba verde y psql moría después.
#
# Lo que agrega además: hasta ahora las 37 migraciones del repo no tenían ningún
# registro de cuáles se habían aplicado. Se sabía de memoria. Ahora hay tabla.

set -euo pipefail

cd "$(dirname "$0")/../.."

DB_USER="${DB_USER:-app}"
DB_NAME="${DB_NAME:-musiki26}"
MIGRATIONS_DIR="postgres-patches/migrations"

# El nombre del contenedor estaba hardcodeado como 'devmusiki-db' y no es el que
# corre. Antes de inventar otro nombre fijo, que lo busque: cualquier contenedor
# cuya imagen sea postgres sirve, y si hay más de uno se elige el que tenga la
# base que buscamos.
descubrir_contenedor() {
  if [ -n "${DB_CONTAINER:-}" ]; then
    printf '%s' "$DB_CONTAINER"
    return
  fi
  local candidatos
  candidatos=$(docker ps --format '{{.Names}}\t{{.Image}}' 2>/dev/null \
    | awk -F'\t' 'tolower($2) ~ /postgres|postgis/ { print $1 }')
  # si hay varios, nos quedamos con el que tenga la base
  for c in $candidatos; do
    if docker exec "$c" psql -U "$DB_USER" -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
      printf '%s' "$c"
      return
    fi
  done
  # Sin verificación no se elige nada. Antes esto devolvía el primer candidato
  # "porque era la mejor apuesta", y en un VPS donde conviven varias bases la
  # mejor apuesta puede ser la base de otro sistema.
  printf ''
}

DB_CONTAINER="$(descubrir_contenedor)"

MODE="apply"
ARG2="${2:-}"
case "${1:-}" in
  --status)   MODE="status" ;;
  --dry-run)  MODE="dry-run" ;;
  --baseline) MODE="baseline" ;;
  --unmark)   MODE="unmark" ;;
  "")         ;;
  *) echo "Uso: $0 [--status|--dry-run|--baseline <hasta>|--unmark <archivo>]" >&2; exit 1 ;;
esac

# --baseline sin corte marcaba TODO, incluida la migración nueva que todavía no
# corrió: el sistema quedaba creyendo que estaba aplicada y la tabla sin crear.
# Ahora el corte es obligatorio y explícito.
if [ "$MODE" = "baseline" ] && [ -z "$ARG2" ]; then
  echo "[ERROR] --baseline necesita hasta dónde marcar." >&2
  echo "" >&2
  echo "        Marca como aplicadas las migraciones HASTA ese archivo inclusive," >&2
  echo "        y deja pendientes las posteriores, que son las que sí hay que correr." >&2
  echo "" >&2
  echo "        Para ver la lista:  $0 --status" >&2
  echo "        Ejemplo:            $0 --baseline 20261028220000_amigx_criticx.sql" >&2
  exit 1
fi
if [ "$MODE" = "unmark" ] && [ -z "$ARG2" ]; then
  echo "[ERROR] --unmark necesita el nombre del archivo a desmarcar." >&2
  exit 1
fi

if [ -z "$DB_CONTAINER" ] || ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "[ERROR] No encuentro ningún contenedor de PostgreSQL." >&2
  echo "" >&2
  echo "Contenedores corriendo ahora:" >&2
  docker ps --format '  {{.Names}}  ({{.Image}})' >&2 || echo "  (docker ps falló)" >&2
  echo "" >&2
  echo "Si el que corresponde está en la lista, indicalo:" >&2
  echo "  DB_CONTAINER=<nombre> $0 ${1:-}" >&2
  exit 1
fi

# psql dentro del contenedor: sin red, sin túnel, sin contraseña en el comando.
psql_run() { docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }
psql_quiet() { psql_run -tAq "$@"; }

echo "[INFO] Base ${DB_NAME} en el contenedor ${DB_CONTAINER}."

# Que la base se llame musiki26 y acepte al usuario app no alcanza para saber que
# es la nuestra: en este VPS conviven varias bases en el mismo Postgres, y el
# contenedor se llama authentik-postgresql por razones históricas. Antes de
# escribir una sola línea, comprobamos que estén las tablas del LMS.
CENTINELAS="${CENTINELAS:-User Enrollment}"
for tabla in $CENTINELAS; do
  existe=$(psql_quiet -c "SELECT to_regclass('public.\"${tabla}\"') IS NOT NULL;" 2>/dev/null | tr -d '[:space:]')
  if [ "$existe" != "t" ]; then
    echo "" >&2
    echo "[ERROR] En ${DB_CONTAINER}/${DB_NAME} no está la tabla \"${tabla}\"." >&2
    echo "        Esta no parece la base del LMS. No se toca nada." >&2
    echo "" >&2
    echo "        Para ver qué hay:" >&2
    echo "          docker exec ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -c '\\dt'" >&2
    echo "        Para apuntar a otra:" >&2
    echo "          DB_CONTAINER=<nombre> DB_NAME=<base> \$0 ${1:-}" >&2
    exit 1
  fi
done
echo "[INFO] Verificada: están las tablas del LMS (${CENTINELAS})."

# La tabla de registro se crea sola la primera vez.
psql_quiet -c '
  CREATE TABLE IF NOT EXISTS public."SchemaMigration" (
    "name"      text PRIMARY KEY,
    "appliedAt" timestamptz NOT NULL DEFAULT now()
  );' >/dev/null

aplicadas=$(psql_quiet -c 'SELECT "name" FROM public."SchemaMigration";' || true)

# --unmark va acá arriba, antes de calcular pendientes. Si va después, la salida
# temprana de «no hay nada que aplicar» lo come: desmarcar sólo hace falta
# cuando el registro dice que todo está aplicado, que es justo el caso en que el
# script se iba antes de llegar a esta rama. Desmarcar no necesita la lista de
# pendientes; necesita exactamente lo contrario.
if [ "$MODE" = "unmark" ]; then
  if [ ! -f "${MIGRATIONS_DIR}/${ARG2}" ]; then
    echo "[ERROR] No existe ${MIGRATIONS_DIR}/${ARG2}" >&2
    exit 1
  fi
  if ! printf '%s\n' "$aplicadas" | grep -Fxq "$ARG2"; then
    echo "[INFO] ${ARG2} no figura como aplicada. No hay nada que desmarcar."
    exit 0
  fi
  psql_quiet -c "DELETE FROM public.\"SchemaMigration\" WHERE \"name\" = '${ARG2}';" >/dev/null
  echo "[OK] ${ARG2} desmarcada. Vuelve a figurar como pendiente."
  exit 0
fi

pendientes=()
for archivo in "${MIGRATIONS_DIR}"/*.sql; do
  [ -e "$archivo" ] || continue
  nombre=$(basename "$archivo")
  if ! printf '%s\n' "$aplicadas" | grep -Fxq "$nombre"; then
    pendientes+=("$archivo")
  fi
done

total_aplicadas=$(printf '%s\n' "$aplicadas" | grep -c . || true)
echo "[INFO] Aplicadas: ${total_aplicadas} · pendientes: ${#pendientes[@]}"

if [ "${#pendientes[@]}" -eq 0 ]; then
  echo "[OK] No hay nada que aplicar."
  exit 0
fi

for archivo in "${pendientes[@]}"; do
  echo "       pendiente · $(basename "$archivo")"
done

if [ "$MODE" = "status" ]; then
  exit 0
fi

# Marca las pendientes como aplicadas sin ejecutarlas. Es para la primera vez,
# cuando el repo trae migraciones que ya se corrieron a mano antes de que
# existiera la tabla de registro.
if [ "$MODE" = "baseline" ]; then
  if [ ! -f "${MIGRATIONS_DIR}/${ARG2}" ]; then
    echo "[ERROR] No existe ${MIGRATIONS_DIR}/${ARG2}" >&2
    exit 1
  fi
  marcadas=0
  for archivo in "${pendientes[@]}"; do
    nombre=$(basename "$archivo")
    # Orden lexicográfico: los nombres empiezan con la fecha, así que alcanza.
    if [[ "$nombre" > "$ARG2" ]]; then
      echo "       QUEDA PENDIENTE · ${nombre}"
      continue
    fi
    psql_quiet -c "INSERT INTO public.\"SchemaMigration\" (\"name\") VALUES ('${nombre}')
                   ON CONFLICT (\"name\") DO NOTHING;" >/dev/null
    echo "       marcada sin ejecutar · ${nombre}"
    marcadas=$((marcadas + 1))
  done
  echo "[OK] ${marcadas} marcadas hasta ${ARG2}. Las posteriores siguen pendientes."
  exit 0
fi

# La primera corrida es el caso delicado: el repo trae 37 migraciones que
# probablemente ya estén aplicadas a mano, y volver a correrlas puede fallar o,
# peor, duplicar datos. Se marca todo lo viejo como aplicado sin ejecutarlo y se
# corre sólo lo nuevo.
if [ "$total_aplicadas" -eq 0 ] && [ "${#pendientes[@]}" -gt 1 ]; then
  echo ""
  echo "[AVISO] La tabla de registro está vacía y hay ${#pendientes[@]} migraciones."
  echo "        Probablemente ya estén aplicadas a mano. Volver a correrlas es riesgoso."
  echo ""
  echo "        Para marcar como aplicadas las VIEJAS sin ejecutarlas, indicando"
  echo "        hasta dónde llega lo ya aplicado a mano (la última de la lista de"
  echo "        arriba que sepas que ya corrió):"
  echo "          $0 --baseline <archivo>"
  echo ""
  echo "        Las posteriores a ese archivo quedan pendientes, que es lo que"
  echo "        querés: son las nuevas y sí hay que correrlas."
  echo ""
  echo "        Para forzar la ejecución de todas:"
  echo "          FORCE_ALL=1 $0"
  echo ""
  if [ "${FORCE_ALL:-0}" != "1" ]; then
    exit 1
  fi
fi

for archivo in "${pendientes[@]}"; do
  nombre=$(basename "$archivo")
  echo "[INFO] Aplicando ${nombre}..."
  if [ "$MODE" = "dry-run" ]; then
    { echo 'BEGIN;'; cat "$archivo"; echo 'ROLLBACK;'; } | psql_run >/dev/null
    echo "       ensayo OK, revertido"
  else
    psql_run < "$archivo" >/dev/null
    psql_quiet -c "INSERT INTO public.\"SchemaMigration\" (\"name\") VALUES ('${nombre}')
                   ON CONFLICT (\"name\") DO NOTHING;" >/dev/null
    echo "       aplicada y registrada"
  fi
done

echo "[OK] Listo."
