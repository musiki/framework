#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [ -d "/opt/homebrew/opt/libpq/bin" ]; then
  export PATH="/opt/homebrew/opt/libpq/bin:${PATH}"
fi

ENV_FILE=".env"
OUTPUT_DIR="${ROOT_DIR}/.tmp/db-backups"
LABEL="manual"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: bash scripts/db-backup.sh [options]

Options:
  --env-file <path>    Env file path to source before backup (default: .env)
  --output-dir <path>  Directory where backup bundles are written (default: .tmp/db-backups)
  --label <name>       Short label for the backup folder name (default: manual)
  --dry-run            Print the commands that would run without executing them
  -h, --help           Show this help

Env discovery order:
  1. DATABASE_URL
  2. SUPABASE_DB_URL
  3. SUPABASE_DB_PASSWORD + supabase/.temp/pooler-url

Artifacts:
  - database.dump  pg_dump custom-format backup
  - schema.sql     schema-only SQL
  - data.sql       data-only SQL
  - metadata.json  timestamp + git + project metadata
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:-}"
      shift 2
      ;;
    --label)
      LABEL="${2:-}"
      shift 2
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

run_supabase_dump_via_dry_run() {
  local output_file="$1"
  shift

  local raw_output=""
  raw_output="$(supabase db dump --linked --dry-run -f "${output_file}" "$@" 2>&1)"

  local dump_script=""
  dump_script="$(printf '%s\n' "${raw_output}" | awk '
    /^#!\/usr\/bin\/env bash$/ { capture=1 }
    capture {
      if ($0 ~ /^Dumped /) exit
      print
    }
  ')"

  if [ -z "${dump_script}" ]; then
    echo "[FAIL] Could not derive a pg_dump script from supabase db dump --dry-run" >&2
    printf '%s\n' "${raw_output}" >&2
    exit 1
  fi

  local tmp_script
  tmp_script="$(mktemp)"
  printf '%s\n' "${dump_script}" > "${tmp_script}"
  bash "${tmp_script}" > "${output_file}"
  rm -f "${tmp_script}"
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

require_cmd node
require_cmd git

DB_URL=""
if discover_db_url >/dev/null 2>&1; then
  DB_URL="$(discover_db_url)"
fi

timestamp_utc="$(date -u +"%Y%m%d-%H%M%SZ")"
safe_label="$(printf '%s' "${LABEL}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-')"
bundle_dir="${OUTPUT_DIR%/}/${timestamp_utc}-${safe_label}"
dump_path="${bundle_dir}/database.dump"
schema_path="${bundle_dir}/schema.sql"
data_path="${bundle_dir}/data.sql"
metadata_path="${bundle_dir}/metadata.json"

project_ref=""
if [ -f "${ROOT_DIR}/supabase/.temp/project-ref" ]; then
  project_ref="$(tr -d '\r\n' < "${ROOT_DIR}/supabase/.temp/project-ref")"
fi

supabase_host=""
if [ -n "${SUPABASE_URL-}" ]; then
  supabase_host="$(node -e 'const value = process.argv[1] || ""; process.stdout.write(value ? new URL(value).host : "")' "${SUPABASE_URL}")"
fi

git_commit="$(git rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
git_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'unknown')"

mkdir_cmd=(mkdir -p "${bundle_dir}")
backup_method=""

dump_cmd=()
schema_cmd=()
data_cmd=()

if [ -n "${DB_URL}" ]; then
  require_cmd pg_dump
  backup_method="pg_dump"
  dump_cmd=(pg_dump --format=custom --no-owner --no-privileges --file "${dump_path}" "${DB_URL}")
  schema_cmd=(pg_dump --schema-only --no-owner --no-privileges --file "${schema_path}" "${DB_URL}")
  data_cmd=(pg_dump --data-only --no-owner --no-privileges --file "${data_path}" "${DB_URL}")
else
  require_cmd supabase
  backup_method="supabase-cli-dry-run"
  schema_cmd=(supabase db dump --linked -f "${schema_path}")
  data_cmd=(supabase db dump --linked --data-only -f "${data_path}")
fi

if [ "${DRY_RUN}" -eq 1 ]; then
  printf '[dry-run] '
  print_masked_cmd "" "${mkdir_cmd[@]}"
  if [ "${#dump_cmd[@]}" -gt 0 ]; then
    printf '[dry-run] '
    print_masked_cmd "${DB_URL}" "${dump_cmd[@]}"
  fi
  printf '[dry-run] '
  print_masked_cmd "${DB_URL}" "${schema_cmd[@]}"
  printf '[dry-run] '
  print_masked_cmd "${DB_URL}" "${data_cmd[@]}"
  exit 0
fi

"${mkdir_cmd[@]}"
if [ "${#dump_cmd[@]}" -gt 0 ]; then
  "${dump_cmd[@]}"
fi
if [ "${backup_method}" = "supabase-cli-dry-run" ]; then
  run_supabase_dump_via_dry_run "${schema_path}"
  run_supabase_dump_via_dry_run "${data_path}" --data-only
else
  "${schema_cmd[@]}"
  "${data_cmd[@]}"
fi

cat > "${metadata_path}" <<EOF
{
  "createdAtUtc": "${timestamp_utc}",
  "label": "${safe_label}",
  "method": "${backup_method}",
  "gitBranch": "${git_branch}",
  "gitCommit": "${git_commit}",
  "projectRef": "${project_ref}",
  "supabaseHost": "${supabase_host}",
  "artifacts": {
    "databaseDump": $( [ "${#dump_cmd[@]}" -gt 0 ] && printf '"database.dump"' || printf 'null' ),
    "schemaSql": "schema.sql",
    "dataSql": "data.sql"
  }
}
EOF

echo "[OK] Backup created at ${bundle_dir}"
du -h "${dump_path}" "${schema_path}" "${data_path}" "${metadata_path}" 2>/dev/null || true
