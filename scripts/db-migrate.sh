#!/usr/bin/env bash
#
# Corre una migración contra la base remota, abriendo y cerrando el túnel solo.
#
#   ./scripts/db-migrate.sh postgres-patches/migrations/20261107120000_cohorts.sql
#   ./scripts/db-migrate.sh --dry-run postgres-patches/migrations/...sql
#
# Existe porque el camino manual tiene tres trampas:
#   · db-tunnel.sh se queda en primer plano, así que el psql de la línea siguiente
#     nunca llega a correr
#   · DATABASE_URL vive en .env y no está exportada en la shell, así que psql se
#     va al socket local y falla con un error que no dice nada del túnel
#   · si el túnel tarda en levantar, psql corre antes de tiempo
#
# El archivo .sql tiene que traer su propio BEGIN/COMMIT.

set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  shift
fi

MIGRATION="${1:-}"
if [ -z "$MIGRATION" ] || [ ! -f "$MIGRATION" ]; then
  echo "Uso: $0 [--dry-run] <archivo.sql>" >&2
  exit 1
fi

command -v psql >/dev/null || { echo "[ERROR] psql no está instalado." >&2; exit 1; }

# La URL sale de .env, pero apuntada al puerto local del túnel.
if [ ! -f .env ]; then
  echo "[ERROR] No hay .env con DATABASE_URL." >&2
  exit 1
fi
DB_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'' | tr -d '[:space:]')
if [ -z "$DB_URL" ]; then
  echo "[ERROR] No encontré DATABASE_URL en .env." >&2
  exit 1
fi

LOCAL_PORT=$(printf '%s' "$DB_URL" | sed -nE 's#.*:([0-9]+)/[^/]*$#\1#p')
LOCAL_PORT="${LOCAL_PORT:-5433}"

TUNNEL_PID=""
cleanup() {
  if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "[INFO] Cerrando el túnel."
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Si el puerto ya responde, alguien dejó el túnel abierto: se reutiliza.
if nc -z localhost "$LOCAL_PORT" 2>/dev/null; then
  echo "[INFO] El túnel ya está abierto en localhost:${LOCAL_PORT}."
else
  echo "[INFO] Abriendo el túnel en segundo plano..."
  ./scripts/db-tunnel.sh >/tmp/musiki-db-tunnel.log 2>&1 &
  TUNNEL_PID=$!
  for _ in $(seq 1 30); do
    nc -z localhost "$LOCAL_PORT" 2>/dev/null && break
    sleep 0.5
  done
  if ! nc -z localhost "$LOCAL_PORT" 2>/dev/null; then
    echo "[ERROR] El túnel no levantó. Log en /tmp/musiki-db-tunnel.log:" >&2
    tail -5 /tmp/musiki-db-tunnel.log >&2 || true
    exit 1
  fi
  echo "[INFO] Túnel listo."
fi

echo "[INFO] Base: $(printf '%s' "$DB_URL" | sed -E 's#//[^@]*@#//***@#')"
echo "[INFO] Migración: ${MIGRATION}"

if [ "$DRY_RUN" = "1" ]; then
  # Se corre dentro de una transacción que se revierte: valida la sintaxis y los
  # permisos sin dejar nada escrito.
  echo "[INFO] Ensayo: se aplica y se revierte."
  psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
    -c 'BEGIN;' -f "$MIGRATION" -c 'ROLLBACK;' \
    && echo "[OK] La migración corre limpia. No se escribió nada."
else
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION" \
    && echo "[OK] Migración aplicada."
fi
