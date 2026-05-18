#!/usr/bin/env bash
# VPS update: commit local production changes, pull framework, rebuild, restart.
# Run on the VPS whenever deploying a new framework version.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

BRANCH="${1:-main}"

echo "==> vps-update: branch=${BRANCH}"

# ── 1. Auto-commit any tracked production changes ────────────────────────────
# Covers .ly source files, config tweaks, or any other tracked file modified
# on the server.  Untracked/gitignored files (uploads, rendered SVG/PDF) are
# untouched by this.
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  echo "--> Staging tracked production changes..."
  git add -u   # only already-tracked files; never picks up gitignored paths
  CHANGED=$(git diff --cached --name-only | head -20)
  echo "--> Changed files:"
  echo "${CHANGED}" | sed 's/^/    /'
  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  git commit -m "chore: vps production sync ${TIMESTAMP}"
  echo "--> Committed."
else
  echo "--> Working tree clean, nothing to commit."
fi

# ── 2. Pull with rebase ──────────────────────────────────────────────────────
# Production commits land on top of the new framework commits.
echo "--> Pulling origin/${BRANCH} with rebase..."
git pull --rebase origin "${BRANCH}"

# ── 3. Push production commits back so local devs can pull content changes ───
# Uncomment if you want VPS-generated content (e.g. .ly sources) to flow back
# to the shared repo.
#
# echo "--> Pushing back to origin/${BRANCH}..."
# git push origin "${BRANCH}"

# ── 4. Install deps if package-lock is newer than node_modules ───────────────
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "--> Dependencies out of sync, running npm ci..."
  npm ci --ignore-scripts
fi

# ── 5. Build ─────────────────────────────────────────────────────────────────
echo "--> Building..."
npm run build

# ── 6. Restart ───────────────────────────────────────────────────────────────
echo "--> Restarting app..."
docker restart devmusiki-app

echo "==> Done."
