#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="/Users/zztt/My Drive/Obsidian/cym/06-out"
DST="$SCRIPT_DIR/src/content"


SUFFIX=".md-old"

echo "Phase A: SRC → DST"
rsync -av \
  --update \
  --backup \
  --suffix="$SUFFIX" \
  --exclude ".DS_Store" \
  --exclude ".obsidian" \
  "$SRC"/ "$DST"/

echo "Phase B: DST → SRC"
rsync -av \
  --update \
  --backup \
  --suffix="$SUFFIX" \
  --exclude ".DS_Store" \
  --exclude ".obsidian" \
  "$DST"/ "$SRC"/

echo "Renaming backups to Obsidian-compatible form"

rename_md_old () {
  find "$1" -type f -name "*.md-old" | while read -r f; do
    mv "$f" "${f%.md-old}-old.md"
  done
}

rename_md_old "$SRC"
rename_md_old "$DST"

echo "Bidirectional sync complete (file-old.md preserved)"
