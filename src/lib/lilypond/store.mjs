// Where rendered LilyPond assets live: <cwd>/public/lily/<hash>.{svg,midi,pdf}
// (override with LILYPOND_PUBLIC_DIR). This is the directory the engine has
// always used:
//   - `astro dev` serves it directly as /lily/<hash>.*;
//   - `astro build` copies it into dist/client (the files are gitignored but
//     survive `git reset --hard` on the VPS), so the next deploy serves them
//     statically;
//   - between deploys the production server serves runtime renders through
//     GET /api/lily/render?url=/lily/<hash>.<ext> (the player falls back to it).
// SVG is sanitized (svg-sanitize.mjs) before it is written and again when it
// is read for inlining or serving, because files rendered before the sandbox
// existed are untrusted too.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { sanitizeSvgSecurity } from './svg-sanitize.mjs';

const HASH_RE = /^[a-f0-9]{32,64}$/i;

export function getLilyDir(env = process.env) {
  return env?.LILYPOND_PUBLIC_DIR || path.join(process.cwd(), 'public', 'lily');
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

/** Sanitize every *.svg under `dir` in place (one-off for files rendered before the sandbox). */
export async function sanitizeLilyDir(dir = getLilyDir()) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return { checked: 0, rewritten: 0, removed: 0 };
  }
  const stats = { checked: 0, rewritten: 0, removed: 0 };
  for (const name of entries) {
    if (!name.endsWith('.svg')) continue;
    const filePath = path.join(dir, name);
    const before = await fsp.readFile(filePath, 'utf8');
    const after = await readSanitizedSvg(filePath);
    stats.checked += 1;
    if (!after) stats.removed += 1;
    else if (after !== before) stats.rewritten += 1;
  }
  return stats;
}
