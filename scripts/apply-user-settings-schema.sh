#!/usr/bin/env bash
set -euo pipefail

# SQL to add settings column to User table
SQL="alter table public.\"User\" add column if not exists \"settings\" jsonb not null default '{}'::jsonb;"

echo "Applying schema change to Supabase..."
echo "${SQL}"

# Execute using Supabase CLI
# The user mentioned being already logged in ("sb or something")
if command -v supabase >/dev/null 2>&1; then
  supabase db execute "${SQL}"
  echo "[OK] Schema change applied successfully."
else
  echo "[FAIL] Supabase CLI not found. Please install it or run the SQL manually in the Supabase Dashboard."
  exit 1
fi
