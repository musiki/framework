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

# ── 5. Migraciones pendientes ────────────────────────────────────────────────
# Antes del build: si el esquema no está al día, la app arranca contra una base
# que no tiene las columnas que el código espera. Hasta ahora las migraciones se
# corrían a mano por un túnel y no había registro de cuáles estaban aplicadas.
#
# SKIP_MIGRATIONS=1 para saltearlas en un deploy de emergencia.
if [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then
  echo "--> Migraciones salteadas (SKIP_MIGRATIONS=1)."
elif [ -x ./scripts/vps/db-migrate.sh ]; then
  echo "--> Aplicando migraciones pendientes..."
  # Si falla, el deploy se corta acá y NO se rebuildea ni se reinicia. Eso es
  # deliberado: la app que está corriendo sigue siendo la build vieja, que es
  # coherente con el esquema viejo. Producción queda sana, el deploy incompleto.
  if ! ./scripts/vps/db-migrate.sh; then
    echo ""
    echo "[ERROR] Las migraciones fallaron. El deploy se detiene antes del build."
    echo "        La app sigue corriendo la versión anterior: producción está sana."
    echo "        Para deployar igual, sin migrar:  SKIP_MIGRATIONS=1 $0 ${BRANCH}"
    exit 1
  fi
else
  echo "--> scripts/vps/db-migrate.sh no está, se omite."
fi

# ── 6. Build ─────────────────────────────────────────────────────────────────
# Se buildea en dist.next y recién si termina entero se cambia por dist/. Antes
# npm run build escribía directo en dist/: un build fallido borraba dist/client
# y la app que seguía corriendo servía HTML con todos los JS en 404.
NEXT_DIR=dist.next
PREV_DIR=dist.prev
rm -rf "${NEXT_DIR}"
echo "--> Building en ${NEXT_DIR}..."
if ! npm run build -- --outDir "${NEXT_DIR}"; then
  rm -rf "${NEXT_DIR}"
  echo ""
  echo "[ERROR] El build falló. dist/ no se tocó: producción sigue con la build anterior."
  exit 1
fi
if [ ! -f "${NEXT_DIR}/server/entry.mjs" ] || [ ! -d "${NEXT_DIR}/client" ]; then
  echo "[ERROR] El build terminó sin server/entry.mjs o sin client/. No se cambia nada."
  exit 1
fi
rm -rf "${PREV_DIR}"
if [ -d dist ]; then mv dist "${PREV_DIR}"; fi
mv "${NEXT_DIR}" dist

# ── 7. Restart ───────────────────────────────────────────────────────────────
# La app es un proceso PM2, no un contenedor. Nombre y puerto salen del mismo
# ecosystem que la levanta, así este script sirve también para la instancia hem.
read -r APP_NAME APP_PORT < <(node -e "
  const a = require('./ecosystem.config.cjs').apps.find((x) => x.script === 'dist/server/entry.mjs');
  if (!a) process.exit(1);
  console.log(a.name, a.env.PORT);
") || { echo "[ERROR] ecosystem.config.cjs no declara la app de dist/server/entry.mjs."; exit 1; }

echo "--> Reiniciando ${APP_NAME}..."
pm2 restart "${APP_NAME}" --update-env

# Si la build nueva no responde, se vuelve a la anterior en vez de dejar
# producción caída esperando que alguien lo note.
healthy=0
for _ in $(seq 1 20); do
  sleep 2
  if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:${APP_PORT}/"; then healthy=1; break; fi
done
if [ "${healthy}" != "1" ]; then
  echo "[ERROR] ${APP_NAME} no responde en :${APP_PORT} con la build nueva. Vuelvo a la anterior."
  if [ -d "${PREV_DIR}" ]; then
    rm -rf dist.failed && mv dist dist.failed && mv "${PREV_DIR}" dist
    pm2 restart "${APP_NAME}" --update-env
    echo "        Build fallida guardada en dist.failed para revisar."
  fi
  exit 1
fi
rm -rf "${PREV_DIR}"

echo "==> Done."
