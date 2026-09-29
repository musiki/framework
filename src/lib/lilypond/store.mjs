// Where rendered LilyPond assets live: a persistent store OUTSIDE the deploy
// tree, <store>/<hash>.{svg,midi,pdf}. getLilyDir() resolves it:
//   1. LILYPOND_ASSET_DIR (LILYPOND_PUBLIC_DIR is the legacy name);
//   2. production (NODE_ENV=production) when /opt/musiki/data/lily exists;
//   3. <cwd>/public/lily (development; `astro dev` also serves it statically).
// The deploy syncs the framework with `rsync --delete` and only dist/client is
// served statically in production, so runtime renders must never live in the
// repo tree. GET /lily/<hash>.<ext> (src/pages/lily/[file].ts) serves the
// store, falling back to <cwd>/dist/client/lily and <cwd>/public/lily for
// legacy files; GET /api/lily/render?url= reads the same dirs.
// SVG is sanitized (svg-sanitize.mjs) before it is written and again when it
// is read for inlining or serving, because files rendered before the sandbox
// existed are untrusted too.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { sanitizeSvgSecurity } from './svg-sanitize.mjs';

const HASH_RE = /^[a-f0-9]{32,64}$/i;

/** Production store used when no env override is set and the directory exists. */
export const PRODUCTION_LILY_DIR = '/opt/musiki/data/lily';

/**
 * The directory rendered assets are written to (and read from first).
 * @param {Record<string, string|undefined>} [env]
 * @param {{cwd?: string, existsSync?: (p: string) => boolean}} [opts]
 */
export function getLilyDir(env = process.env, { cwd = process.cwd(), existsSync = fs.existsSync } = {}) {
  const explicit = String(env?.LILYPOND_ASSET_DIR || env?.LILYPOND_PUBLIC_DIR || '').trim();
  if (explicit) return path.resolve(cwd, explicit);
  if (env?.NODE_ENV === 'production' && existsSync(PRODUCTION_LILY_DIR)) return PRODUCTION_LILY_DIR;
  return path.join(cwd, 'public', 'lily');
}

/**
 * Directories a /lily/<hash>.<ext> request is served from, in order: the
 * store, then legacy files the build copied into dist/client/lily, then
 * public/lily (duplicates removed).
 */
export function getLilyReadDirs(env = process.env, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const dirs = [getLilyDir(env, opts), path.join(cwd, 'dist', 'client', 'lily'), path.join(cwd, 'public', 'lily')];
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

export function isSafeLilyHash(hash) {
  return HASH_RE.test(String(hash || ''));
}

export function md5Hex(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

export function lilyAssetPaths(hash, dir = getLilyDir()) {
  if (!isSafeLilyHash(hash)) throw new Error(`invalid lily asset hash: ${hash}`);
  return {
    svgPath: path.join(dir, `${hash}.svg`),
    pdfPath: path.join(dir, `${hash}.pdf`),
    midiPath: path.join(dir, `${hash}.midi`),
    midPath: path.join(dir, `${hash}.mid`),
  };
}

/** Existing MIDI path for a hash (.midi preferred; a legacy .mid is renamed to .midi). */
export function resolveMidiPath(hash, dir = getLilyDir()) {
  const { midiPath, midPath } = lilyAssetPaths(hash, dir);
  if (fs.existsSync(midiPath)) return midiPath;
  if (fs.existsSync(midPath)) {
    try {
      fs.renameSync(midPath, midiPath);
      return midiPath;
    } catch {
      return midPath;
    }
  }
  return '';
}

async function writeAtomic(filePath, data) {
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, filePath);
}

/**
 * Persist a render result under <dir>/<hash>.*. The SVG is sanitized first;
 * an SVG with nothing safe left is not written.
 * @returns {Promise<{svg: string, midi: boolean, pdf: boolean}>} svg = sanitized markup ('' if none)
 */
export async function writeLilyAssets(hash, result, { dir = getLilyDir() } = {}) {
  const paths = lilyAssetPaths(hash, dir);
  await fsp.mkdir(dir, { recursive: true });
  const out = { svg: '', midi: false, pdf: false };

  if (typeof result?.svg === 'string' && result.svg) {
    const clean = await sanitizeSvgSecurity(result.svg);
    if (clean) {
      await writeAtomic(paths.svgPath, clean);
      rememberSanitized(paths.svgPath, clean);
      out.svg = clean;
    }
  }
  if (Buffer.isBuffer(result?.midi) && result.midi.length > 0) {
    await writeAtomic(paths.midiPath, result.midi);
    out.midi = true;
  }
  if (Buffer.isBuffer(result?.pdf) && result.pdf.length > 0) {
    await writeAtomic(paths.pdfPath, result.pdf);
    out.pdf = true;
  }
  return out;
}

// Sanitizing on read costs a jsdom parse; memoize by path + mtime + size.
const SANITIZED_MAX = 500;
const sanitizedCache = new Map();

function rememberSanitized(filePath, markup) {
  try {
    const stat = fs.statSync(filePath);
    sanitizedCache.delete(filePath);
    sanitizedCache.set(filePath, { key: `${stat.mtimeMs}:${stat.size}`, markup });
    while (sanitizedCache.size > SANITIZED_MAX) sanitizedCache.delete(sanitizedCache.keys().next().value);
  } catch {
    // ignore
  }
}

/** Read an SVG file and return sanitized markup ('' when missing or unsafe). */
export async function readSanitizedSvg(filePath) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return '';
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  const cached = sanitizedCache.get(filePath);
  if (cached && cached.key === key) return cached.markup;
  const raw = await fsp.readFile(filePath, 'utf8');
  const markup = await sanitizeSvgSecurity(raw);
  if (markup !== raw) {
    // Legacy/unsanitized file: replace it on disk so the copy that `astro build`
    // puts into dist/client (served statically) is the sanitized one too.
    try {
      if (markup) await writeAtomic(filePath, markup);
      else await fsp.rm(filePath, { force: true });
      rememberSanitized(filePath, markup);
      return markup;
    } catch {
      // read-only dir: still return the sanitized markup
    }
  }
  sanitizedCache.delete(filePath);
  sanitizedCache.set(filePath, { key, markup });
  while (sanitizedCache.size > SANITIZED_MAX) sanitizedCache.delete(sanitizedCache.keys().next().value);
  return markup;
}

/**
 * Sanitize every *.svg under `dir` in place (files rendered before the sandbox).
 * Idempotent and fast on re-runs: a manifest remembers mtime+size
 * of files already checked, so only new or changed files are parsed.
 * The manifest lives outside the served dir (<cwd>/.cache/lily-sanitized.json).
 */
export async function sanitizeLilyDir(dir = getLilyDir(), { manifestPath = path.join(process.cwd(), '.cache', 'lily-sanitized.json') } = {}) {
  const stats = { checked: 0, skipped: 0, rewritten: 0, removed: 0, failed: 0 };
  let entries = [];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return stats;
  }
  let allManifests = {};
  try {
    allManifests = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) || {};
  } catch {
    allManifests = {};
  }
  const dirKey = path.resolve(dir);
  const manifest = allManifests[dirKey] || {};
  const next = {};
  for (const name of entries) {
    if (!name.endsWith('.svg')) continue;
    const filePath = path.join(dir, name);
    let stat = await fsp.stat(filePath);
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (manifest[name] === key) {
      next[name] = key;
      stats.skipped += 1;
      continue;
    }
    const before = await fsp.readFile(filePath, 'utf8');
    const after = await readSanitizedSvg(filePath);
    stats.checked += 1;
    if (!after) {
      if (!fs.existsSync(filePath)) stats.removed += 1;
      else stats.failed += 1;
      continue;
    }
    // Record the file only when what is on disk now is the sanitized markup
    // (already clean, or rewritten successfully); a failed rewrite is retried.
    const onDisk = await fsp.readFile(filePath, 'utf8');
    if (onDisk !== after) {
      stats.failed += 1;
      continue;
    }
    if (after !== before) stats.rewritten += 1;
    stat = await fsp.stat(filePath);
    next[name] = `${stat.mtimeMs}:${stat.size}`;
  }
  allManifests[dirKey] = next;
  await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
  await writeAtomic(manifestPath, JSON.stringify(allManifests));
  return stats;
}
