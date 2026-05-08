#!/usr/bin/env fish

set ROOT_DIR (cd (dirname (status --current-filename))/..; pwd)
cd "$ROOT_DIR"; or exit 1

if test -d "/opt/homebrew/opt/libpq/bin"
    fish_add_path -p "/opt/homebrew/opt/libpq/bin"
end

set ENV_FILE ".env"
set OUTPUT_DIR "$ROOT_DIR/.tmp/db-backups"
set LABEL "manual"
set DRY_RUN 0

function usage
    printf '%s\n' \
"Usage: fish scripts/db-backup.fish [options]

Options:
  --env-file <path>    Env file path to source before backup (default: .env)
  --output-dir <path>  Directory where backup bundles are written (default: .tmp/db-backups)
  --label <name>       Short label for the backup folder name (default: manual)
  --dry-run            Print the commands that would run without executing them
  -h, --help           Show this help"
end

set i 1
while test $i -le (count $argv)
    switch $argv[$i]
        case --env-file
            set i (math $i + 1)
            set ENV_FILE $argv[$i]
        case --output-dir
            set i (math $i + 1)
            set OUTPUT_DIR $argv[$i]
        case --label
            set i (math $i + 1)
            set LABEL $argv[$i]
        case --dry-run
            set DRY_RUN 1
        case -h --help
            usage
            exit 0
        case '*'
            echo "[FAIL] Unknown option: $argv[$i]" >&2
            usage >&2
            exit 1
    end
    set i (math $i + 1)
end

if test -n "$ENV_FILE"; and test -f "$ENV_FILE"
    export (grep -v '^\s*#' "$ENV_FILE" | grep -E '^[A-Za-z_][A-Za-z0-9_]*=')
end

function require_cmd
    if not command -v $argv[1] >/dev/null 2>&1
        echo "[FAIL] Missing required command: $argv[1]" >&2
        exit 1
    end
end

function url_encode
    node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$argv[1]"
end

function append_sslmode
    set url "$argv[1]"
    if string match -q '*sslmode=*' "$url"
        printf '%s' "$url"
    else if string match -q '*?*' "$url"
        printf '%s&sslmode=require' "$url"
    else
        printf '%s?sslmode=require' "$url"
    end
end

function build_db_url_from_pooler
    set pooler_url_file "$ROOT_DIR/postgres-patches/.temp/pooler-url"

    if test -z "$SUPABASE_DB_PASSWORD"; or not test -f "$pooler_url_file"
        return 1
    end

    set base_url (string trim < "$pooler_url_file")

    if test -z "$base_url"
        return 1
    end

    set parsed (string match -r '^postgresql://([^@]+)@(.*)$' "$base_url")

    if test (count $parsed) -lt 3
        return 1
    end

    set userinfo $parsed[2]
    set host_part $parsed[3]
    set encoded_password (url_encode "$SUPABASE_DB_PASSWORD")

    append_sslmode "postgresql://$userinfo:$encoded_password@$host_part"
end

function discover_db_url
    if set -q DATABASE_URL; and test -n "$DATABASE_URL"
        printf '%s' "$DATABASE_URL"
        return 0
    end

    if set -q SUPABASE_DB_URL; and test -n "$SUPABASE_DB_URL"
        printf '%s' "$SUPABASE_DB_URL"
        return 0
    end

    build_db_url_from_pooler
end

function print_masked_cmd
    set secret "$argv[1]"
    set args $argv[2..-1]

    for part in $args
        if test -n "$secret"; and test "$part" = "$secret"
            printf '%s ' "<db-url:redacted>"
        else
            printf '%s ' (string escape -- "$part")
        end
    end

    printf '\n'
end

function run_supabase_dump_via_dry_run
    set output_file "$argv[1]"
    set extra_args $argv[2..-1]

    set raw_output (supabase db dump --linked --dry-run -f "$output_file" $extra_args 2>&1)

    set dump_script (printf '%s\n' $raw_output | awk '
        /^#!\/usr\/bin\/env bash$/ { capture=1 }
        capture {
            if ($0 ~ /^Dumped /) exit
            print
        }
    ')

    if test -z "$dump_script"
        echo "[FAIL] Could not derive a pg_dump script from supabase db dump --dry-run" >&2
        printf '%s\n' $raw_output >&2
        exit 1
    end

    set tmp_script (mktemp)
    printf '%s\n' $dump_script > "$tmp_script"
    bash "$tmp_script" > "$output_file"
    rm -f "$tmp_script"
end

require_cmd node
require_cmd git

set DB_URL (discover_db_url 2>/dev/null)

set timestamp_utc (date -u +"%Y%m%d-%H%M%SZ")
set safe_label (printf '%s' "$LABEL" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-')
set bundle_dir "$OUTPUT_DIR/"(string trim -r -c / "$timestamp_utc-$safe_label")
set dump_path "$bundle_dir/database.dump"
set schema_path "$bundle_dir/schema.sql"
set data_path "$bundle_dir/data.sql"
set metadata_path "$bundle_dir/metadata.json"

set project_ref ""
if test -f "$ROOT_DIR/postgres-patches/.temp/project-ref"
    set project_ref (string trim < "$ROOT_DIR/postgres-patches/.temp/project-ref")
end

set supabase_host ""
if set -q SUPABASE_URL; and test -n "$SUPABASE_URL"
    set supabase_host (node -e 'const value = process.argv[1] || ""; process.stdout.write(value ? new URL(value).host : "")' "$SUPABASE_URL")
end

set git_commit (git rev-parse --short HEAD 2>/dev/null; or printf 'unknown')
set git_branch (git rev-parse --abbrev-ref HEAD 2>/dev/null; or printf 'unknown')

set mkdir_cmd mkdir -p "$bundle_dir"
set backup_method ""

set dump_cmd
set schema_cmd
set data_cmd

if test -n "$DB_URL"
    require_cmd pg_dump
    set backup_method "pg_dump"
    set dump_cmd pg_dump --format=custom --no-owner --no-privileges --file "$dump_path" "$DB_URL"
    set schema_cmd pg_dump --schema-only --no-owner --no-privileges --file "$schema_path" "$DB_URL"
    set data_cmd pg_dump --data-only --no-owner --no-privileges --file "$data_path" "$DB_URL"
else
    require_cmd supabase
    set backup_method "supabase-cli-dry-run"
    set schema_cmd supabase db dump --linked -f "$schema_path"
    set data_cmd supabase db dump --linked --data-only -f "$data_path"
end

if test "$DRY_RUN" -eq 1
    printf '[dry-run] '
    print_masked_cmd "" $mkdir_cmd

    if test (count $dump_cmd) -gt 0
        printf '[dry-run] '
        print_masked_cmd "$DB_URL" $dump_cmd
    end

    printf '[dry-run] '
    print_masked_cmd "$DB_URL" $schema_cmd

    printf '[dry-run] '
    print_masked_cmd "$DB_URL" $data_cmd

    exit 0
end

$mkdir_cmd

if test (count $dump_cmd) -gt 0
    $dump_cmd
end

if test "$backup_method" = "supabase-cli-dry-run"
    run_supabase_dump_via_dry_run "$schema_path"
    run_supabase_dump_via_dry_run "$data_path" --data-only
else
    $schema_cmd
    $data_cmd
end

set database_dump_json null
if test (count $dump_cmd) -gt 0
    set database_dump_json '"database.dump"'
end

cat > "$metadata_path" <<EOF
{
  "createdAtUtc": "$timestamp_utc",
  "label": "$safe_label",
  "method": "$backup_method",
  "gitBranch": "$git_branch",
  "gitCommit": "$git_commit",
  "projectRef": "$project_ref",
  "supabaseHost": "$supabase_host",
  "artifacts": {
    "databaseDump": $database_dump_json,
    "schemaSql": "schema.sql",
    "dataSql": "data.sql"
  }
}
EOF

echo "[OK] Backup created at $bundle_dir"
du -h "$dump_path" "$schema_path" "$data_path" "$metadata_path" 2>/dev/null; or true
