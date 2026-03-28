#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [ -d "/opt/homebrew/opt/libpq/bin" ]; then
  export PATH="/opt/homebrew/opt/libpq/bin:${PATH}"
fi

ENV_FILE=".env"
INPUT_PATH=""
YES=0
CLEAN=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: bash scripts/db-restore.sh --input <path> [options]

Options:
  --input <path>       Path to a backup artifact (.dump/.backup or .sql)
  --env-file <path>    Env file path to source before restore (default: .env)
  --clean              Drop existing objects before restore when using pg_restore
  --yes                Confirm destructive restore
  --dry-run            Print the restore command without executing it
  -h, --help           Show this help

Env discovery order:
  1. DATABASE_URL
  2. SUPABASE_DB_URL
  3. SUPABASE_DB_PASSWORD + supabase/.temp/pooler-url

Notes:
  - backup directories with schema.sql + data.sql are supported
  - .dump/.backup uses pg_restore
  - .sql uses psql
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --input)
      INPUT_PATH="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --clean)
      CLEAN=1
      shift
      ;;
    --yes)
      YES=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[FAIL] Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "${INPUT_PATH}" ]; then
  echo "[FAIL] --input is required" >&2
  usage >&2
  exit 1
fi

if [ -n "${ENV_FILE}" ] && [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "[FAIL] Missing required command: ${cmd}" >&2
    exit 1
  fi
}

print_masked_cmd() {
  local secret="${1:-}"
  shift || true
  local part=""
  for part in "$@"; do
    if [ -n "${secret}" ] && [ "${part}" = "${secret}" ]; then
      printf '%q ' '<db-url:redacted>'
    else
      printf '%q ' "${part}"
    fi
  done
  printf '\n'
}

run_psql_file() {
  local db_url="$1"
  local file_path="$2"
  psql "${db_url}" -v ON_ERROR_STOP=1 -f "${file_path}"
}

run_psql_data_file_with_replica_role() {
  local db_url="$1"
  local file_path="$2"
  local wrapper_file
  wrapper_file="$(mktemp)"
  cat > "${wrapper_file}" <<EOF
SET session_replication_role = replica;
\i ${file_path}
SET session_replication_role = origin;
EOF
  psql "${db_url}" -v ON_ERROR_STOP=1 -f "${wrapper_file}"
  rm -f "${wrapper_file}"
}

url_encode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$1"
}

append_sslmode() {
  local url="$1"
  if [[ "${url}" == *"sslmode="* ]]; then
    printf '%s' "${url}"
  elif [[ "${url}" == *"?"* ]]; then
    printf '%s&sslmode=require' "${url}"
  else
    printf '%s?sslmode=require' "${url}"
  fi
}

build_db_url_from_pooler() {
  local password="${SUPABASE_DB_PASSWORD-}"
  local pooler_url_file="${ROOT_DIR}/supabase/.temp/pooler-url"
  if [ -z "${password}" ] || [ ! -f "${pooler_url_file}" ]; then
    return 1
  fi

  local base_url
  base_url="$(tr -d '\r\n' < "${pooler_url_file}")"
  if [ -z "${base_url}" ]; then
    return 1
  fi

  if [[ ! "${base_url}" =~ ^postgresql://([^@]+)@(.*)$ ]]; then
    return 1
  fi

  local userinfo="${BASH_REMATCH[1]}"
  local host_part="${BASH_REMATCH[2]}"
  local encoded_password
  encoded_password="$(url_encode "${password}")"

  append_sslmode "postgresql://${userinfo}:${encoded_password}@${host_part}"
}

discover_db_url() {
  if [ -n "${DATABASE_URL-}" ]; then
    printf '%s' "${DATABASE_URL}"
    return 0
  fi

  if [ -n "${SUPABASE_DB_URL-}" ]; then
    printf '%s' "${SUPABASE_DB_URL}"
    return 0
  fi

  if build_db_url_from_pooler >/dev/null 2>&1; then
    build_db_url_from_pooler
    return 0
  fi

  return 1
}

if [ ! -e "${INPUT_PATH}" ]; then
  echo "[FAIL] Input path not found: ${INPUT_PATH}" >&2
  exit 1
fi

require_cmd node

DB_URL=""
if discover_db_url >/dev/null 2>&1; then
  DB_URL="$(discover_db_url)"
fi

if [ -z "${DB_URL}" ]; then
  cat >&2 <<'EOF'
[FAIL] Could not resolve a Postgres connection string.

Provide one of:
  - DATABASE_URL
  - SUPABASE_DB_URL
  - SUPABASE_DB_PASSWORD together with supabase/.temp/pooler-url
EOF
  exit 1
fi

restore_cmd=()
restore_cmds=()

if [ -d "${INPUT_PATH}" ]; then
  require_cmd psql
  schema_file="${INPUT_PATH%/}/schema.sql"
  data_file="${INPUT_PATH%/}/data.sql"
  if [ ! -f "${schema_file}" ] || [ ! -f "${data_file}" ]; then
    echo "[FAIL] Backup directory must contain schema.sql and data.sql" >&2
    exit 1
  fi
  if [ "${CLEAN}" -eq 1 ]; then
    echo "[WARN] --clean is ignored for directory restores; use a .dump backup for clean restores." >&2
  fi
  restore_cmds+=("psql-schema|${schema_file}")
  restore_cmds+=("psql-data|${data_file}")
else
  case "${INPUT_PATH}" in
    *.dump|*.backup)
      require_cmd pg_restore
      restore_cmd=(pg_restore --no-owner --no-privileges --dbname "${DB_URL}")
      if [ "${CLEAN}" -eq 1 ]; then
        restore_cmd+=(--clean --if-exists)
      fi
      restore_cmd+=("${INPUT_PATH}")
      restore_cmds+=("pg_restore")
      ;;
    *.sql)
      require_cmd psql
      if [ "${CLEAN}" -eq 1 ]; then
        echo "[WARN] --clean is ignored for .sql input; use a .dump backup for clean restores." >&2
      fi
      restore_cmds+=("psql|${INPUT_PATH}")
      ;;
    *)
      echo "[FAIL] Unsupported backup format: ${INPUT_PATH}" >&2
      echo "       Expected a backup directory, .dump, .backup, or .sql" >&2
      exit 1
      ;;
  esac
fi

if [ "${DRY_RUN}" -eq 1 ]; then
  if [ "${#restore_cmd[@]}" -gt 0 ]; then
    printf '[dry-run] '
    print_masked_cmd "${DB_URL}" "${restore_cmd[@]}"
  else
    local_item=""
    for local_item in "${restore_cmds[@]}"; do
    case "${local_item}" in
        psql-schema\|*)
          printf '[dry-run] '
          print_masked_cmd "${DB_URL}" psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "${local_item#psql-schema|}"
          ;;
        psql-data\|*)
          printf '[dry-run] '
          print_masked_cmd "${DB_URL}" psql "${DB_URL}" -v ON_ERROR_STOP=1 -f '<temp-wrapper-with-replica-role>'
          ;;
      esac
    done
  fi
  exit 0
fi

if [ "${YES}" -ne 1 ]; then
  cat >&2 <<'EOF'
[FAIL] Restore is destructive and requires explicit confirmation.

Re-run with:
  --yes
EOF
  exit 1
fi

if [ "${#restore_cmd[@]}" -gt 0 ]; then
  "${restore_cmd[@]}"
else
  local_item=""
  for local_item in "${restore_cmds[@]}"; do
    case "${local_item}" in
      psql-schema\|*)
        run_psql_file "${DB_URL}" "${local_item#psql-schema|}"
        ;;
      psql-data\|*)
        run_psql_data_file_with_replica_role "${DB_URL}" "${local_item#psql-data|}"
        ;;
    esac
  done
fi
echo "[OK] Restore completed from ${INPUT_PATH}"
