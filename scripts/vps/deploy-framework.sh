#!/usr/bin/env bash
#
# Deploy manual del framework, desde tu máquina:
#
#   ./scripts/vps/deploy-framework.sh
#
# No deploya por su cuenta: dispara el mismo workflow de GitHub Actions que
# corre en cada push (sync-content-sources.yml) y lo sigue hasta el final. Así
# hay un solo camino —el runner del VPS ejecutando scripts/vps/deploy-framework-local.sh—
# y un deploy manual entra en la misma cola que los automáticos en vez de pisarse
# con ellos. Ver DEPLOYMENT.md.
#
# Antes había un segundo camino (ssh + scripts/vps-update.sh) sin lock: lanzado
# después de un push, corría a la vez que el del CI en el mismo directorio, con
# un npm ci borrando node_modules debajo de un build. Se eliminó.

set -euo pipefail

cd "$(dirname "$0")/../.."

WORKFLOW="sync-content-sources.yml"

if ! command -v gh >/dev/null 2>&1; then
  echo "[ERROR] Falta gh (GitHub CLI). Alternativa: Actions → ${WORKFLOW} → Run workflow." >&2
  exit 1
fi

# El deploy construye origin/main. Commits locales sin pushear no van a estar, y
# deployar creyendo que sí es exactamente el error silencioso que queremos evitar.
git fetch -q origin main
if [ -n "$(git rev-list origin/main..HEAD 2>/dev/null)" ]; then
  echo "[ERROR] Hay commits sin pushear; el deploy construye origin/main y no los incluiría:" >&2
  git log --oneline origin/main..HEAD >&2
  echo "        Pusheá primero (el push ya dispara el deploy por sí solo)." >&2
  exit 1
fi

echo "[framework] Disparando ${WORKFLOW} sobre origin/main ($(git rev-parse --short origin/main))..."
gh workflow run "$WORKFLOW" --ref main -f trigger_deploy=true

# gh workflow run no devuelve el id del run: se toma el más reciente de ese workflow.
sleep 5
RUN_ID="$(gh run list --workflow "$WORKFLOW" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
echo "[framework] Run ${RUN_ID}. Siguiéndolo (Ctrl-C deja de mirar; el deploy sigue)."
gh run watch "$RUN_ID" --exit-status
