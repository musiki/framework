#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="/Users/zztt/Library/CloudStorage/GoogleDrive-lucianoazzigotti@gmail.com/My Drive/Obsidian/cym/06-out/"
TARGET="$SCRIPT_DIR/../src/content/"

rsync -av \
--delete \
--exclude ".DS_Store" \
--exclude ".obsidian" \
"$SOURCE"/  "$TARGET"/
