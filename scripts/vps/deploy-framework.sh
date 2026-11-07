#!/usr/bin/env bash
#
# Deploy del framework. Un comando, desde tu máquina.
#
#   ./scripts/vps/deploy-framework.sh          # deploya main
#   ./scripts/vps/deploy-framework.sh alguna-rama
#
# Hace ssh al VPS y corre scripts/vps-update.sh allá, que es el que sabe el
# orden correcto: pull, deps, migraciones, build, restart.
#
# Antes este script tenía su propia secuencia (git pull + npm ci + build +
# `pm2 reload`) que había divergido de vps-update.sh (que usa `docker restart`),
# y apuntaba a deploy@musiki.org.ar:22, que no acepta SSH: daba «Operation timed
# out». El acceso real es zz@46.225.154.68. Dos caminos de deploy que se
# contradicen son peores que uno solo, así que ahora hay uno.
#
# Los courses no pasan por acá: se publican solos cuando pushean, vía el
# workflow de contenido y el Content Bus.

set -euo pipefail

VPS_USER="${VPS_USER:-zz}"
VPS_HOST="${VPS_HOST:-46.225.154.68}"
VPS_PORT="${VPS_PORT:-22}"
VPS_PATH="${VPS_PATH:-/opt/musiki/framework}"
BRANCH="${1:-main}"

printf '\n[framework] %s@%s:%s (%s)\n\n' "$VPS_USER" "$VPS_HOST" "$VPS_PATH" "$BRANCH"

# bash -lc porque la shell del VPS es fish y vps-update.sh es bash.
exec ssh -t -p "$VPS_PORT" "${VPS_USER}@${VPS_HOST}" \
  "bash -lc 'cd \"${VPS_PATH}\" && ./scripts/vps-update.sh \"${BRANCH}\"'"
