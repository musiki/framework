#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE=".env"
SKIP_BUILD=0
SKIP_API=0

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --skip-api)
      SKIP_API=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/preflight.sh [options]

Options:
  --env-file <path>  Env file path (default: .env)
  --skip-build       Skip "npm run build"
  --skip-api         Skip remote correction API checks
  -h, --help         Show this help
EOF
      exit 0
      ;;
    *)
      echo "[FAIL] Unknown option: $1"
      exit 1
      ;;
  esac
done

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

ok() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "[OK] $*"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  echo "[WARN] $*"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "[FAIL] $*"
}

check_cmd() {
  local cmd="$1"
  if command -v "${cmd}" >/dev/null 2>&1; then
    ok "Command available: ${cmd}"
  else
    fail "Missing command: ${cmd}"
  fi
}

check_required_env() {
  local key="$1"
  local value="${!key-}"
  if [ -z "${value}" ]; then
    fail "Missing env var: ${key}"
    return
  fi

  case "${value}" in
    your-*|*change-this*|*example.com*|*tu-dominio*|*\<*|*\>*)
      fail "Env var ${key} looks like placeholder value"
      ;;
    *)
      ok "Env var present: ${key}"
      ;;
  esac
}

echo "== Preflight started =="
echo "Project: ${ROOT_DIR}"
echo

check_cmd node
check_cmd npm
check_cmd git
check_cmd curl

if [ ! -f "${ENV_FILE}" ]; then
  fail "Env file not found: ${ENV_FILE}"
else
  ok "Env file found: ${ENV_FILE}"

  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
  if [ "${NODE_MAJOR}" -gt 24 ]; then
    warn "Local Node is ${NODE_MAJOR}; Vercel serverless currently uses Node 24"
  else
    ok "Node major version looks compatible with Vercel runtime: ${NODE_MAJOR}"
  fi
fi

echo
echo "== Env checks =="
check_required_env GOOGLE_CLIENT_ID
check_required_env GOOGLE_CLIENT_SECRET
check_required_env AUTH_SECRET
check_required_env BETTER_AUTH_URL
check_required_env SUPABASE_URL
check_required_env SUPABASE_KEY
check_required_env CORRECTION_API_URL
check_required_env CORRECTION_API_TOKEN

if [ -n "${BETTER_AUTH_URL-}" ] && [[ "${BETTER_AUTH_URL}" == *localhost* ]]; then
  fail "BETTER_AUTH_URL points to localhost. Use production domain before deploy."
fi

if [ -n "${SUPABASE_URL-}" ]; then
  if node -e "const dns=require('node:dns').promises; const u=new URL(process.env.SUPABASE_URL); dns.lookup(u.hostname).then(()=>process.exit(0)).catch(()=>process.exit(1));" >/dev/null 2>&1; then
    ok "SUPABASE_URL hostname resolves in DNS"
  else
    fail "SUPABASE_URL hostname does not resolve (DNS)"
  fi
fi

if [ "${SKIP_API}" -eq 0 ]; then
  echo
  echo "== Correction API checks =="
  if [ -n "${CORRECTION_API_URL-}" ] && [ -n "${CORRECTION_API_TOKEN-}" ]; then
    if curl -fsS --max-time 15 "${CORRECTION_API_URL%/}/health" >/dev/null; then
      ok "Correction API health endpoint reachable"
    else
      fail "Correction API health endpoint failed"
    fi

    TMP_API="$(mktemp)"
    HTTP_CODE="$(curl -sS --max-time 20 -o "${TMP_API}" -w "%{http_code}" \
      -H "Authorization: Bearer ${CORRECTION_API_TOKEN}" \
      "${CORRECTION_API_URL%/}/api/models" || true)"

    if [ "${HTTP_CODE}" = "200" ]; then
      ok "Correction API auth check passed (/api/models)"
    else
      fail "Correction API auth check failed (/api/models) status=${HTTP_CODE}"
      if [ -s "${TMP_API}" ]; then
        echo "[INFO] API response: $(cat "${TMP_API}")"
      fi
    fi
    rm -f "${TMP_API}"
  else
    fail "Cannot run API checks: CORRECTION_API_URL or CORRECTION_API_TOKEN missing"
  fi
else
  warn "Skipping correction API checks (--skip-api)"
fi

echo
echo "== Git hygiene =="
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  ok "Inside git repository"
else
  fail "Not inside a git repository"
fi

if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  fail ".env is tracked by git (remove from tracking)"
else
  ok ".env is not tracked by git"
fi

GIT_STATUS="$(git status --porcelain)"
if [ -z "${GIT_STATUS}" ]; then
  ok "Working tree is clean"
else
  warn "Working tree has local changes"
fi

if echo "${GIT_STATUS}" | grep -q "\.vercel/output/"; then
  warn "Changes include .vercel/output (do not commit build artifacts)"
else
  ok "No .vercel/output artifacts detected in git status"
fi

if [ "${SKIP_BUILD}" -eq 0 ]; then
  echo
  echo "== Build check =="
  BUILD_LOG="$(mktemp)"
  if npm run build >"${BUILD_LOG}" 2>&1; then
    ok "npm run build passed"
  else
    fail "npm run build failed"
    echo "[INFO] Last build lines:"
    tail -n 60 "${BUILD_LOG}" || true
  fi
  rm -f "${BUILD_LOG}"
else
  warn "Skipping build check (--skip-build)"
fi

echo
echo "== Summary =="
echo "Pass: ${PASS_COUNT}"
echo "Warn: ${WARN_COUNT}"
echo "Fail: ${FAIL_COUNT}"

if [ "${FAIL_COUNT}" -gt 0 ]; then
  exit 1
fi

echo "Preflight OK."
