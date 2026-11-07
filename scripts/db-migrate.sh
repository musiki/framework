#!/usr/bin/env bash
#
# Corre las migraciones en el VPS, desde tu máquina. Sin túnel.
#
#   ./scripts/db-migrate.sh --status     # qué falta aplicar
#   ./scripts/db-migrate.sh --dry-run    # aplica y revierte, para validar
#   ./scripts/db-migrate.sh --baseline   # marca lo viejo como aplicado
#   ./scripts/db-migrate.sh              # aplica lo pendiente
#
# El trabajo real lo hace scripts/vps/db-migrate.sh, que corre allá, donde la
# base es local. Acá sólo se hace ssh y se pasa el argumento.
#
# Por qué ya no hay túnel: venía de cuando se desarrollaba local contra la base
# remota. Hoy el camino local → github → vps es directo, y el túnel sólo
# agregaba un punto de falla difícil de leer. Un forward de SSH acepta
# conexiones locales aunque el otro extremo esté caído, así que cualquier
# chequeo de puerto daba verde y el error aparecía después, en psql, hablando de
# cosas que no eran.
#
# Asume que el VPS ya tiene la rama que querés migrar. Si acabás de pushear,
# corré primero el deploy.

set -euo pipefail

REMOTE_USER="${VPS_USER:-zz}"
REMOTE_HOST="${VPS_HOST:-46.225.154.68}"
REMOTE_PATH="${VPS_PATH:-/opt/musiki/framework}"

ARG="${1:-}"
case "$ARG" in
  ""|--status|--dry-run|--baseline) ;;
  *) echo "Uso: $0 [--status|--dry-run|--baseline]" >&2; exit 1 ;;
esac

echo "[INFO] ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}"
exec ssh -t "${REMOTE_USER}@${REMOTE_HOST}" \
  "cd '${REMOTE_PATH}' && ./scripts/vps/db-migrate.sh ${ARG}"
