#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_DIR="${ROOT_DIR}/services/ollama-api"

: "${VPS_HOST:?Set VPS_HOST (ejemplo: VPS_HOST=203.0.113.10)}"
VPS_USER="${VPS_USER:-ubuntu}"
VPS_PATH="${VPS_PATH:-/opt/ollama-api}"
SERVICE_NAME="${SERVICE_NAME:-ollama-correction-api}"
APP_USER="${APP_USER:-$VPS_USER}"
APP_GROUP="${APP_GROUP:-$APP_USER}"

printf "\n[1/3] Sync local -> %s@%s:%s\n" "$VPS_USER" "$VPS_HOST" "$VPS_PATH"
ssh "${VPS_USER}@${VPS_HOST}" "mkdir -p '${VPS_PATH}'"

rsync -az --delete \
  --exclude '.env' \
  --exclude '.DS_Store' \
  --exclude 'node_modules' \
  "${LOCAL_DIR}/" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"

printf "\n[2/3] Install dependencies + service\n"
ssh "${VPS_USER}@${VPS_HOST}" bash <<EOF_REMOTE
set -euo pipefail

cd "${VPS_PATH}"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created ${VPS_PATH}/.env (edit before production use)."
fi

npm ci --omit=dev

sed \
  -e "s|__APP_USER__|${APP_USER}|g" \
  -e "s|__APP_GROUP__|${APP_GROUP}|g" \
  -e "s|__APP_PATH__|${VPS_PATH}|g" \
  "${VPS_PATH}/ops/systemd/${SERVICE_NAME}.service" | sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"
EOF_REMOTE

printf "\n[3/3] Service status\n"
ssh "${VPS_USER}@${VPS_HOST}" "sudo systemctl --no-pager --full status '${SERVICE_NAME}' | sed -n '1,40p'"

printf "\nDeployment finished.\n"
