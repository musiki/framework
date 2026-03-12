#!/usr/bin/env bash

set -euo pipefail

: "${VPS_HOST:?Set VPS_HOST (ejemplo: VPS_HOST=musiki.org.ar)}"

VPS_USER="${VPS_USER:-deploy}"
VPS_PORT="${VPS_PORT:-22}"
VPS_PATH="${VPS_PATH:-/opt/musiki/framework}"
VPS_BRANCH="${VPS_BRANCH:-main}"
VPS_INSTALL_COMMAND="${VPS_INSTALL_COMMAND:-npm ci}"
VPS_BUILD_COMMAND="${VPS_BUILD_COMMAND:-npm run build}"
VPS_RELOAD_COMMAND="${VPS_RELOAD_COMMAND:-pm2 reload ecosystem.config.cjs --only musiki-framework --update-env && pm2 save}"

printf "\n[framework] Deploying %s@%s:%s (%s)\n" "$VPS_USER" "$VPS_HOST" "$VPS_PATH" "$VPS_BRANCH"

remote_cmd="cd ${VPS_PATH@Q} && git checkout ${VPS_BRANCH@Q} && git pull --ff-only origin ${VPS_BRANCH@Q}"

if [[ -n "${VPS_INSTALL_COMMAND}" ]]; then
  remote_cmd="${remote_cmd} && ${VPS_INSTALL_COMMAND}"
fi

remote_cmd="${remote_cmd} && ${VPS_BUILD_COMMAND}"

if [[ -n "${VPS_RELOAD_COMMAND}" ]]; then
  remote_cmd="${remote_cmd} && ${VPS_RELOAD_COMMAND}"
fi

ssh \
  -p "${VPS_PORT}" \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new \
  "${VPS_USER}@${VPS_HOST}" \
  "bash -lc $(printf '%q' "${remote_cmd}")"

printf "\n[framework] Deploy complete.\n"
