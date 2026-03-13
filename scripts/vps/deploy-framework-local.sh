#!/usr/bin/env bash

set -euo pipefail

FRAMEWORK_DIR="${VPS_FRAMEWORK_DIR:-/opt/musiki/framework}"
FRAMEWORK_BRANCH="${VPS_GIT_BRANCH:-main}"
INSTALL_COMMAND="${VPS_INSTALL_COMMAND:-npm ci}"
BUILD_COMMAND="${VPS_BUILD_COMMAND:-npm run build}"
RELOAD_COMMAND="${VPS_RELOAD_COMMAND:-pm2 reload ecosystem.config.cjs --only musiki-framework --update-env && pm2 save}"
CONTENT_SOURCE_STRATEGY="${VPS_CONTENT_SOURCE_STRATEGY:-remote-only}"

printf '\n[framework] Deploying in %s (%s)\n' "$FRAMEWORK_DIR" "$FRAMEWORK_BRANCH"
printf '[framework] Content source strategy: %s\n' "$CONTENT_SOURCE_STRATEGY"

export CONTENT_SOURCE_STRATEGY

cd "$FRAMEWORK_DIR"
git checkout "$FRAMEWORK_BRANCH"
git pull --ff-only origin "$FRAMEWORK_BRANCH"

if [[ -n "$INSTALL_COMMAND" ]]; then
  eval "$INSTALL_COMMAND"
fi

eval "$BUILD_COMMAND"

if [[ -n "$RELOAD_COMMAND" ]]; then
  eval "$RELOAD_COMMAND"
fi

printf '\n[framework] Deploy complete.\n'
