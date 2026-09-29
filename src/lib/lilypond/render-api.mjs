// Framework-independent core of /api/lily/render (src/pages/api/lily/render.ts).
//
// POST { code, format? } → renders through the sandboxed lilypond-service and
//   stores public/lily/<md5(source)>.{svg,midi,pdf}; JSON shape unchanged:
//   { success, hash, url, midiUrl, pdfUrl, generated, cached?, remote? }.
// GET ?url=<.../<hash>.<svg|midi|mid|pdf>> → serves the local asset (SVG
//   sanitized), or proxies a legacy rendered object from an allowed R2 host.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { renderLilypond } from './service.mjs';
import {
  getLilyDir,
  lilyAssetPaths,
  md5Hex,
  readSanitizedSvg,
  resolveMidiPath,
  writeLilyAssets,
} from './store.mjs';
import { isAllowedRemoteLilyUrl } from '../lilypond-remote.mjs';
import {
  getRenderedLilypondUrl,
  stripRenderedLilypondComment,
} from '../lilypond-rendered-comment.mjs';

export const MAX_SOURCE_BYTES = 64 * 1024;
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

function assetResponse(kind, body) {
  const base = kind === 'svg' ? SVG_HEADERS : { 'Content-Type': mimeFor(kind), 'X-Content-Type-Options': 'nosniff' };
  return {
    status: 200,
    headers: { ...base, 'Cache-Control': 'public, max-age=31536000, immutable' },
    body,
  };
}

function replaceExtension(assetUrl, extension) {
  return assetUrl.replace(/\.(svg|midi|mid|pdf)(?=([?#].*)?$)/i, `.${extension}`);
}

function remoteCandidates(assetUrl, kind) {
  if (kind === 'svg') return [replaceExtension(assetUrl, 'svg')];
  if (kind === 'pdf') return [replaceExtension(assetUrl, 'pdf')];
  return [replaceExtension(assetUrl, 'midi'), replaceExtension(assetUrl, 'mid')];
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
      return Buffer.from(await res.arrayBuffer());
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
  return jsonResponse(502, { success: false, hash, error: `${prefix}LilyPond render service is unavailable` });
}

/**
 * @param {unknown} payload parsed JSON body (null when it was not JSON)
 * @param {{dir?: string, render?: typeof renderLilypond, fetchImpl?: typeof fetch, env?: Record<string, string|undefined>}} [deps]
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
  const cachedUrl = getRenderedLilypondUrl(rawSource);
  const source = stripRenderedLilypondComment(rawSource);
  if (!source.trim()) return jsonResponse(400, { error: 'Missing LilyPond source code' });
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) return jsonResponse(413, { error: 'LilyPond source too large' });

  await fsp.mkdir(dir, { recursive: true });
  const hash = md5Hex(source);
  const paths = lilyAssetPaths(hash, dir);

  if (format === 'pdf') {
    if (!fs.existsSync(paths.pdfPath)) {
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

  const hashMatch = remoteUrl.match(/\/([a-f0-9]{32,64})\.(svg|midi|mid|pdf)(?=([?#].*)?$)/i);
  const hash = hashMatch ? hashMatch[1].toLowerCase() : md5Hex(remoteUrl);

  await fsp.mkdir(dir, { recursive: true });
  const serveLocal = async () => {
    const paths = lilyAssetPaths(hash, dir);
    if (kind === 'svg') {
      const svg = await readSanitizedSvg(paths.svgPath);
      return svg ? assetResponse('svg', svg) : null;
    }
    const filePath = kind === 'pdf' ? (fs.existsSync(paths.pdfPath) ? paths.pdfPath : '') : resolveMidiPath(hash, dir);
    return filePath ? assetResponse(kind, await fsp.readFile(filePath)) : null;
  };

  const local = await serveLocal();
  if (local) return local;

  if (/^https:\/\//i.test(remoteUrl) && isAllowedRemoteLilyUrl(remoteUrl, env)) {
    await downloadRemoteLilyFiles(remoteUrl, hash, { dir, fetchImpl, env });
    const proxied = await serveLocal();
    if (proxied) return proxied;
  }

  if (kind === 'midi') return text(404, 'Remote LilyPond MIDI unavailable');
  if (kind === 'pdf') return text(404, 'Remote LilyPond PDF unavailable');
  return text(502, 'Could not proxy file');
}
