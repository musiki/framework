#!/usr/bin/env node
// One-off: sanitize every SVG in public/lily (or LILYPOND_PUBLIC_DIR / argv[2])
// in place. SVGs rendered before the LilyPond sandbox came straight from
// LilyPond and may contain script; the engine also sanitizes lazily on read,
// but run this once before the next build so dist/client never serves them.
import { sanitizeLilyDir, getLilyDir } from '../src/lib/lilypond/store.mjs';

const dir = process.argv[2] || getLilyDir();
const stats = await sanitizeLilyDir(dir);
console.log(`[sanitize-lily-assets] ${dir}: checked ${stats.checked}, unchanged since last run ${stats.skipped}, rewritten ${stats.rewritten}, removed ${stats.removed}, failed ${stats.failed}`);
if (stats.failed > 0) process.exitCode = 1;
