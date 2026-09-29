// Framework-independent core of /api/lily/render (src/pages/api/lily/render.ts).
//
// POST { code, format? } → renders through the sandboxed lilypond-service and
//   stores <store>/<md5(source)>.{svg,midi,pdf} (store.mjs getLilyDir); JSON shape unchanged:
//   { success, hash, url, midiUrl, pdfUrl, generated, cached?, remote? }.
// GET ?url=<.../<hash>.<svg|midi|mid|pdf>> → serves the local asset (SVG
//   sanitized), or proxies a legacy rendered object — only from a configured
//   R2 host AND only when the engine's own render cache already knows the URL.
// handleLilyFileGet(<hash>.<ext>) is the core of GET /lily/<hash>.<ext>
//   (src/pages/lily/[file].ts): store first, then legacy dist/client/lily and
//   public/lily.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { renderLilypond } from './service.mjs';
import {
  getLilyDir,
  getLilyReadDirs,
  isSafeLilyHash,
  lilyAssetPaths,
  md5Hex,
  readSanitizedSvg,
  resolveMidiPath,
  writeLilyAssets,
} from './store.mjs';
import { isAllowedRemoteLilyUrl } from '../lilypond-remote.mjs';
import {
  getCachedRenderedLilypondUrl,
  isKnownRenderedLilypondUrl,
  stripRenderedLilypondComment,
} from '../lilypond-rendered-comment.mjs';

export const MAX_SOURCE_BYTES = 64 * 1024;
export const MAX_REMOTE_ASSET_BYTES = 2 * 1024 * 1024;
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SVG_HEADERS = {
  'Content-Type': 'image/svg+xml; charset=utf-8',
  // Defense in depth for SVG opened directly from the site origin.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'X-Content-Type-Options': 'nosniff',
};

const jsonResponse = (status, body) => ({ status, headers: JSON_HEADERS, body: JSON.stringify(body) });

function mimeFor(kind) {
  if (kind === 'svg') return SVG_HEADERS['Content-Type'];
  if (kind === 'pdf') return 'application/pdf';
  return 'audio/midi';
}

export function assetResponse(kind, body, hash) {
  const base = kind === 'svg'
    ? SVG_HEADERS
    : {
      'Content-Type': mimeFor(kind),
      'Content-Security-Policy': 'sandbox',
      'Content-Disposition': `attachment; filename="${hash}.${kind === 'pdf' ? 'pdf' : 'midi'}"`,
      'X-Content-Type-Options': 'nosniff',
    };
  return {
    status: 200,
    headers: { ...base, 'Cache-Control': 'public, max-age=31536000, immutable' },
    body,
  };
}

/**
 * First local copy of <hash> as `kind` in `dirs` (in order), as a response;
 * null when none exists. SVG is sanitized on read.
 */
export async function serveLocalLilyAsset(hash, kind, dirs) {
  for (const dir of dirs) {
    const paths = lilyAssetPaths(hash, dir);
    if (kind === 'svg') {
      const svg = await readSanitizedSvg(paths.svgPath);
      if (svg) return assetResponse('svg', svg, hash);
      continue;
    }
    const filePath = kind === 'pdf' ? (fs.existsSync(paths.pdfPath) ? paths.pdfPath : '') : resolveMidiPath(hash, dir);
    if (filePath) return assetResponse(kind, await fsp.readFile(filePath), hash);
  }
  return null;
}

function replaceExtension(assetUrl, extension) {
  return assetUrl.replace(/\.(svg|midi|mid|pdf)(?=([?#].*)?$)/i, `.${extension}`);
}

function remoteCandidates(assetUrl, kind) {
  if (kind === 'svg') return [replaceExtension(assetUrl, 'svg')];
  if (kind === 'pdf') return [replaceExtension(assetUrl, 'pdf')];
  return [replaceExtension(assetUrl, 'midi'), replaceExtension(assetUrl, 'mid')];
}

/** Response body as a Buffer, or null when it exceeds `max` bytes (declared or streamed). */
export async function readCapped(res, max) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return null;
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > max ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function fetchFirst(candidates, { fetchImpl, env }) {
  const seen = new Set();
  for (const candidate of candidates) {
    const url = String(candidate || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (!isAllowedRemoteLilyUrl(url, env)) continue;
    try {
      const res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const body = await readCapped(res, MAX_REMOTE_ASSET_BYTES);
      if (body) return body;
      console.warn(`[api/lily/render] proxy download refused (> ${MAX_REMOTE_ASSET_BYTES} bytes): ${url}`);
    } catch (error) {
      console.warn('[api/lily/render] proxy download failed:', error?.message || error);
    }
  }
  return null;
}

/**
 * Copy a legacy rendered score (R2) into the local store. Only allowed hosts
 * are contacted; SVG is sanitized before it is written.
 */
export async function downloadRemoteLilyFiles(remoteUrl, hash, { dir, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const paths = lilyAssetPaths(hash, dir);
  const status = {
    svgExists: fs.existsSync(paths.svgPath),
    pdfExists: fs.existsSync(paths.pdfPath),
    midiExists: Boolean(resolveMidiPath(hash, dir)),
  };
  if (!isAllowedRemoteLilyUrl(remoteUrl, env)) return status;

  const result = {};
  if (!status.svgExists) {
    const svg = await fetchFirst(remoteCandidates(remoteUrl, 'svg'), { fetchImpl, env });
    if (svg) result.svg = svg.toString('utf8');
  }
  if (!status.pdfExists) {
    const pdf = await fetchFirst(remoteCandidates(remoteUrl, 'pdf'), { fetchImpl, env });
    if (pdf) result.pdf = pdf;
  }
  if (!status.midiExists) {
    const midi = await fetchFirst(remoteCandidates(remoteUrl, 'midi'), { fetchImpl, env });
    if (midi) result.midi = midi;
  }
  const written = await writeLilyAssets(hash, result, { dir });
  return {
    svgExists: status.svgExists || Boolean(written.svg),
    pdfExists: status.pdfExists || written.pdf,
    midiExists: status.midiExists || written.midi,
  };
}

function assetUrls(hash, dir) {
  const paths = lilyAssetPaths(hash, dir);
  return {
    svgUrl: fs.existsSync(paths.svgPath) ? `/lily/${hash}.svg` : '',
    midiUrl: resolveMidiPath(hash, dir) ? `/lily/${hash}.midi` : '',
    pdfUrl: fs.existsSync(paths.pdfPath) ? `/lily/${hash}.pdf` : '',
  };
}

function failureResponse(outcome, hash, prefix = '') {
  if (outcome.reason === 'render_failed') {
    return jsonResponse(422, {
      success: false,
      hash,
      error: `${prefix}LilyPond could not render this score`,
      ...(outcome.stderr ? { details: outcome.stderr } : {}),
    });
  }
  if (outcome.reason === 'too_large' || outcome.reason === 'bad_request') {
    return jsonResponse(outcome.reason === 'too_large' ? 413 : 400, { success: false, hash, error: `${prefix}${outcome.message || 'invalid LilyPond source'}` });
  }
  if (outcome.reason === 'timeout' && outcome.perScore) {
    return jsonResponse(422, { success: false, hash, error: `${prefix}LilyPond took too long to render this score` });
  }
  if (outcome.reason === 'busy') {
    return { ...jsonResponse(503, { success: false, hash, error: `${prefix}LilyPond renderer is busy, try again` }), headers: { ...JSON_HEADERS, 'Retry-After': '5' } };
  }
  return jsonResponse(502, { success: false, hash, error: `${prefix}LilyPond render service is unavailable` });
}

function rateLimited(deps, hash) {
  if (typeof deps.limiter !== 'function') return null;
  const verdict = deps.limiter(deps.clientKey || 'anonymous');
  if (verdict?.ok !== false) return null;
  const retryAfter = String(Math.max(1, Math.ceil((verdict.retryAfterMs || 60_000) / 1000)));
  return {
    status: 429,
    headers: { ...JSON_HEADERS, 'Retry-After': retryAfter },
    body: JSON.stringify({ success: false, hash, error: 'Too many LilyPond renders, try again later' }),
  };
}

/**
 * @param {unknown} payload parsed JSON body (null when it was not JSON)
 * @param {{dir?: string, render?: typeof renderLilypond, fetchImpl?: typeof fetch, env?: Record<string, string|undefined>, limiter?: (key: string) => {ok: boolean, retryAfterMs?: number}, clientKey?: string}} [deps]
 *   `limiter` is consulted only before a real service render (cache hits are free).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: string}>}
 */
export async function handleLilyRenderPost(payload, deps = {}) {
  const dir = deps.dir ?? getLilyDir(deps.env);
  const render = deps.render ?? renderLilypond;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const env = deps.env ?? process.env;

  if (!payload || typeof payload !== 'object') return jsonResponse(400, { error: 'Invalid JSON payload' });

  const rawSource = String(payload.code || '');
  const format = String(payload.format || 'svg').toLowerCase();
  // `% rendered:` comments in a request body are untrusted: they are stripped
  // and ignored. Only the engine's own render cache is consulted (read-only,
  // nothing from a POST is ever persisted to it).
  const source = stripRenderedLilypondComment(rawSource);
  const cachedUrl = source.trim() ? getCachedRenderedLilypondUrl(source) : '';
  if (!source.trim()) return jsonResponse(400, { error: 'Missing LilyPond source code' });
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) return jsonResponse(413, { error: 'LilyPond source too large' });

  await fsp.mkdir(dir, { recursive: true });
  const hash = md5Hex(source);
  const paths = lilyAssetPaths(hash, dir);

  if (format === 'pdf') {
    if (!fs.existsSync(paths.pdfPath)) {
      const limited = rateLimited(deps, hash);
      if (limited) return limited;
      const outcome = await render(source, { formats: ['pdf'], env });
      if (!outcome.ok) return failureResponse(outcome, hash, 'PDF generation failed: ');
      await writeLilyAssets(hash, { pdf: outcome.result.pdf }, { dir });
    }
    return jsonResponse(200, { success: true, url: `/lily/${hash}.pdf` });
  }

  if (cachedUrl) {
    // Legacy rendered object: copy it next to the local assets when possible.
    if (/^https?:\/\//i.test(cachedUrl)) {
      await downloadRemoteLilyFiles(cachedUrl, hash, { dir, fetchImpl, env });
    }
    const urls = assetUrls(hash, dir);
    return jsonResponse(200, {
      success: true,
      hash,
      url: urls.svgUrl || cachedUrl,
      midiUrl: urls.midiUrl,
      pdfUrl: urls.pdfUrl,
      generated: false,
      cached: true,
      remote: true,
    });
  }

  if (fs.existsSync(paths.svgPath)) {
    const urls = assetUrls(hash, dir);
    return jsonResponse(200, { success: true, hash, url: urls.svgUrl, midiUrl: urls.midiUrl, pdfUrl: urls.pdfUrl, generated: false });
  }

  const limited = rateLimited(deps, hash);
  if (limited) return limited;
  const outcome = await render(source, { formats: ['svg', 'midi'], env });
  if (!outcome.ok) return failureResponse(outcome, hash);

  const written = await writeLilyAssets(hash, outcome.result, { dir });
  if (!written.svg) {
    return jsonResponse(422, { success: false, hash, error: 'LilyPond output was rejected by the SVG sanitizer' });
  }
  const urls = assetUrls(hash, dir);
  return jsonResponse(200, {
    success: true,
    hash,
    url: urls.svgUrl,
    midiUrl: urls.midiUrl,
    pdfUrl: urls.pdfUrl,
    generated: true,
    cached: Boolean(outcome.result.cached),
  });
}

/**
 * @param {string|null} requestedUrl value of ?url=
 * @returns {Promise<{status: number, headers: Record<string,string>, body: string|Buffer}>}
 */
export async function handleLilyAssetGet(requestedUrl, deps = {}) {
  const dir = deps.dir ?? getLilyDir(deps.env);
  const readDirs = deps.readDirs ?? (deps.dir ? [deps.dir] : getLilyReadDirs(deps.env));
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const env = deps.env ?? process.env;
  const text = (status, body) => ({ status, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body });

  const remoteUrl = String(requestedUrl || '');
  if (!remoteUrl) return text(400, 'Missing url');
  const kind = /\.svg(?=([?#].*)?$)/i.test(remoteUrl)
    ? 'svg'
    : /\.pdf(?=([?#].*)?$)/i.test(remoteUrl)
      ? 'pdf'
      : /\.(midi|mid)(?=([?#].*)?$)/i.test(remoteUrl)
        ? 'midi'
        : null;
  if (!kind) return text(400, 'Unsupported LilyPond asset type');

  // Local asset (/lily/<hash>.<ext>): served from the store, never downloaded.
  // Remote object: stored under md5(<url as .svg>) — its own namespace, so a
  // remote name can never shadow a local md5(source) render — and downloaded
  // only from a configured host when the render cache already knows the URL.
  // The player's proxy candidates (/api/lily/render?url=<remote svg|midi>)
  // keep working because every lookup derives the same key from the URL.
  const isRemote = /^https?:\/\//i.test(remoteUrl);
  const hashMatch = remoteUrl.match(/\/([a-f0-9]{32,64})\.(svg|midi|mid|pdf)(?=([?#].*)?$)/i);
  if (!isRemote && !hashMatch) return text(404, 'Unknown LilyPond asset');
  const hash = isRemote ? md5Hex(replaceExtension(remoteUrl, 'svg')) : hashMatch[1].toLowerCase();

  await fsp.mkdir(dir, { recursive: true });
  // Remote objects are only ever downloaded into the store (`dir`).
  const serveLocal = () => serveLocalLilyAsset(hash, kind, isRemote ? [dir] : readDirs);

  const local = await serveLocal();
  if (local) return local;

  if (isRemote && isAllowedRemoteLilyUrl(remoteUrl, env) && isKnownRenderedLilypondUrl(remoteUrl)) {
    await downloadRemoteLilyFiles(remoteUrl, hash, { dir, fetchImpl, env });
    const proxied = await serveLocal();
    if (proxied) return proxied;
  }

  if (kind === 'midi') return text(404, 'Remote LilyPond MIDI unavailable');
  if (kind === 'pdf') return text(404, 'Remote LilyPond PDF unavailable');
  return text(404, 'LilyPond asset unavailable');
}

const LILY_FILE_RE = /^([a-f0-9]{32,64})\.(svg|midi|mid|pdf)$/;

/**
 * GET /lily/<file>: a rendered asset by its content-hash name. Only
 * `<32-64 lowercase hex>.<svg|midi|mid|pdf>` is accepted (no path segments,
 * so no traversal); served from the store, then dist/client/lily, then
 * public/lily. Same headers as the ?url= form (SVG CSP sandbox, MIDI/PDF as
 * sandboxed attachments), cached immutably since names are content hashes.
 * @param {string|undefined|null} file decoded route param
 * @param {{readDirs?: string[], env?: Record<string, string|undefined>}} [deps]
 */
export async function handleLilyFileGet(file, deps = {}) {
  const notFound = { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }, body: 'Not found' };
  const match = LILY_FILE_RE.exec(String(file ?? ''));
  if (!match || !isSafeLilyHash(match[1])) return notFound;
  const [, hash, ext] = match;
  const kind = ext === 'svg' ? 'svg' : ext === 'pdf' ? 'pdf' : 'midi';
  const readDirs = deps.readDirs ?? getLilyReadDirs(deps.env);
  return (await serveLocalLilyAsset(hash, kind, readDirs)) ?? notFound;
}
