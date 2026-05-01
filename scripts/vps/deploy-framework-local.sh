#!/usr/bin/env bash

set -euo pipefail

# Ensure PM2 and node are in PATH
export PATH="/Users/zztt/.local/share/nvm/v24.14.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

FRAMEWORK_DIR="${VPS_FRAMEWORK_DIR:-/opt/musiki/framework}"
INSTALL_COMMAND="${VPS_INSTALL_COMMAND-npm ci}"
CONTENT_SOURCE_STRATEGY="${VPS_CONTENT_SOURCE_STRATEGY:-remote-only}"
CONTENT_PULL_COMMAND="${VPS_CONTENT_PULL_COMMAND-npm run content:pull -- --clean}"
CONTENT_ASSEMBLE_COMMAND="${VPS_CONTENT_ASSEMBLE_COMMAND-npm run content:assemble}"
EVAL_SYNC_COMMAND="${VPS_EVAL_SYNC_COMMAND-npm run eval:sync:db}"
ASTRO_BUILD_COMMAND="${VPS_ASTRO_BUILD_COMMAND-npx astro build --remote --outDir dist_tmp}"
RELOAD_COMMAND="${VPS_RELOAD_COMMAND-pm2 reload ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs --update-env}"
SAVE_PM2_STATE="${VPS_SAVE_PM2_STATE-1}"
DEPLOY_LOCK_FILE="${VPS_DEPLOY_LOCK_FILE:-/tmp/musiki-framework-deploy.lock}"
DEPLOY_LOCK_TIMEOUT="${VPS_DEPLOY_LOCK_TIMEOUT:-900}"

printf '\n[framework] Deploying in %s\n' "$FRAMEWORK_DIR"
printf '[framework] Content source strategy: %s\n' "$CONTENT_SOURCE_STRATEGY"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$DEPLOY_LOCK_FILE"
  printf '[framework] Waiting for deploy lock: %s\n' "$DEPLOY_LOCK_FILE"
  if ! flock -w "$DEPLOY_LOCK_TIMEOUT" 9; then
    printf '[framework] Could not acquire deploy lock within %ss\n' "$DEPLOY_LOCK_TIMEOUT" >&2
    exit 75
  fi
  printf '[framework] Deploy lock acquired\n'
else
  printf '[framework] flock not available; continuing without deploy lock\n' >&2
fi

export CONTENT_SOURCE_STRATEGY
# Ensure targeted sync variables are exported if they were passed by Content Bus
export CONTENT_SOURCE_TARGET_REPO="${CONTENT_SOURCE_TARGET_REPO:-}"
export CONTENT_SOURCE_TARGET_SHA="${CONTENT_SOURCE_TARGET_SHA:-}"
export CONTENT_SOURCE_TARGET_BRANCH="${CONTENT_SOURCE_TARGET_BRANCH:-}"

cd "$FRAMEWORK_DIR"
export PATH="$PATH:$(npm config get prefix)/bin"

printf '::deploy-phase::pull::Syncing framework repo to latest commit\n'
if [[ "${VPS_SKIP_FRAMEWORK_RESET:-0}" == "1" ]]; then
  printf '[framework] Skipping git reset --hard origin/main as requested\n'
else
  git fetch origin
  git reset --hard origin/main
fi

if [[ -n "$INSTALL_COMMAND" ]]; then
  printf '::deploy-phase::install::Installing dependencies\n'
  # Remove the Vite cache directory before npm ci to prevent ENOTEMPTY errors
  # when a live process still has the directory open.
  rm -rf node_modules/.vite 2>/dev/null || true
  eval "$INSTALL_COMMAND"
else
  printf '::deploy-phase::install::Skipping dependency install\n'
fi

printf '::deploy-phase::content::Preparing content\n'
eval "$CONTENT_PULL_COMMAND"
eval "$CONTENT_ASSEMBLE_COMMAND"

if [[ -n "$EVAL_SYNC_COMMAND" ]]; then
  printf '::deploy-phase::database::Syncing database\n'
  eval "$EVAL_SYNC_COMMAND"
fi

printf '::deploy-phase::build::Building Astro\n'
rm -rf dist_tmp
eval "$ASTRO_BUILD_COMMAND"

printf '::deploy-phase::swap::Swapping dist folders\n'
rm -rf dist_old
if [[ -d "dist" ]]; then
  mv dist dist_old
fi
mv dist_tmp dist

if [[ -n "$RELOAD_COMMAND" ]]; then
  printf '::deploy-phase::reload::Reloading services\n'
  eval "$RELOAD_COMMAND"
fi

if [[ "$SAVE_PM2_STATE" != "0" ]]; then
  pm2 save
fi

printf '::deploy-phase::cleanup::Cleaning old release\n'
rm -rf dist_old

printf '\n[framework] Deploy complete.\n'
