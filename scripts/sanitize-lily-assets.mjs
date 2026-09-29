#!/usr/bin/env node
// Sanitize every SVG in the LilyPond asset store (LILYPOND_ASSET_DIR, see
// src/lib/lilypond/store.mjs getLilyDir; or the dirs given as arguments) in
// place, creating the store when it is missing. Legacy <cwd>/public/lily is
// also sanitized when it exists, because `astro build` copies it into
// dist/client. SVGs rendered before the LilyPond sandbox came straight from
// LilyPond and may contain script; the engine also sanitizes lazily on read.
// Idempotent (manifest in <cwd>/.cache); never deletes anything but unsafe SVGs.
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeLilyDir, getLilyDir } from '../src/lib/lilypond/store.mjs';

const store = getLilyDir();
const legacy = path.join(process.cwd(), 'public', 'lily');
const dirs = process.argv.length > 2
  ? process.argv.slice(2)
  : [...new Set([store, legacy].map((d) => path.resolve(d)))];

if (process.argv.length <= 2) {
  try {
    fs.mkdirSync(store, { recursive: true });
  } catch (error) {
    console.error(`[sanitize-lily-assets] cannot create the LilyPond asset store ${store}: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  const stats = await sanitizeLilyDir(dir);
  console.log(`[sanitize-lily-assets] ${dir}: checked ${stats.checked}, unchanged since last run ${stats.skipped}, rewritten ${stats.rewritten}, removed ${stats.removed}, failed ${stats.failed}`);
  if (stats.failed > 0) process.exitCode = 1;
}
