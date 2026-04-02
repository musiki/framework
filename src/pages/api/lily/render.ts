import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { renderRemoteLilypond } from '../../../lib/lilypond-remote.mjs';
import {
  buildLocalLilypondSourceAttempts,
  getLilypondBinary,
  hasLilypondBinary,
} from '../../../lib/lilypond-support.mjs';
import {
  getRenderedLilypondUrl,
  stripRenderedLilypondComment,
} from '../../../lib/lilypond-rendered-comment.mjs';

const LILY_DIR = path.join(process.cwd(), 'public', 'lily');
const MAX_SOURCE_BYTES = 64 * 1024;
const LILYPOND_RENDER_STRATEGY =
  String(process.env.LILYPOND_RENDER_STRATEGY || 'remote-only').trim().toLowerCase();
type LilyAssetKind = 'svg' | 'midi';

function ensureLilyDir() {
  if (!fs.existsSync(LILY_DIR)) {
    fs.mkdirSync(LILY_DIR, { recursive: true });
  }
}

function hashLilySource(source: string): string {
  return crypto.createHash('md5').update(source).digest('hex');
}

function tryRenderLilySvg(hash: string, source: string): boolean {
  const svgPath = path.join(LILY_DIR, `${hash}.svg`);
  if (fs.existsSync(svgPath)) return true;

  if (!hasLilypondBinary()) return false;
  const lilypondBinary = getLilypondBinary();
  if (!lilypondBinary) return false;

  const tmpLyPath = path.join(LILY_DIR, `${hash}.ly`);
  // Use prefix for output control
  const outPrefix = path.join(LILY_DIR, hash);
  let lastRenderError: unknown = null;

  try {
    for (const candidateSource of buildLocalLilypondSourceAttempts(source)) {
      fs.writeFileSync(tmpLyPath, candidateSource, 'utf8');
      try {
        // Use --output to control the directory and prefix
        execFileSync(
          lilypondBinary,
          ['-dbackend=svg', '--output', outPrefix, tmpLyPath],
          { stdio: 'ignore' },
        );
      } catch (execError) {
        lastRenderError = execError;
        console.warn('[api/lily/render] lilypond reported issues, checking if SVG was still produced...');
      }

      // LilyPond might produce .mid or .midi depending on version/config
      const midPath = path.join(LILY_DIR, `${hash}.mid`);
      const midiPath = path.join(LILY_DIR, `${hash}.midi`);
      if (fs.existsSync(midPath) && !fs.existsSync(midiPath)) {
        fs.renameSync(midPath, midiPath);
      }

      if (fs.existsSync(svgPath)) {
        break;
      }
    }
  } catch (error) {
    lastRenderError = error;
  } finally {
    if (fs.existsSync(tmpLyPath)) {
      fs.unlinkSync(tmpLyPath);
    }
  }

  if (!fs.existsSync(svgPath) && lastRenderError) {
    console.error(
      '[api/lily/render] file system error during render:',
      (lastRenderError as Error)?.message || lastRenderError,
    );
  }

  return fs.existsSync(svgPath);
}

async function downloadRemoteLilyFiles(remoteUrl: string, hash: string) {
  const svgPath = path.join(LILY_DIR, `${hash}.svg`);
  const midiPath = path.join(LILY_DIR, `${hash}.midi`);
  let svgExists = fs.existsSync(svgPath);
  let midiExists = fs.existsSync(midiPath);

  const replaceRemoteAssetExtension = (assetUrl: string, extension: 'svg' | 'midi' | 'mid') =>
    assetUrl.replace(/\.(svg|midi|mid)(?=([?#].*)?$)/i, `.${extension}`);

  const buildRemoteSvgCandidates = (assetUrl: string) => {
    if (/\.svg(?=([?#].*)?$)/i.test(assetUrl)) return [assetUrl];
    return [replaceRemoteAssetExtension(assetUrl, 'svg')];
  };

  const buildRemoteMidiCandidates = (assetUrl: string) => {
    if (/\.midi(?=([?#].*)?$)/i.test(assetUrl)) {
      return [assetUrl, replaceRemoteAssetExtension(assetUrl, 'mid')];
    }
    if (/\.mid(?=([?#].*)?$)/i.test(assetUrl)) {
      return [assetUrl, replaceRemoteAssetExtension(assetUrl, 'midi')];
    }
    return [
      replaceRemoteAssetExtension(assetUrl, 'midi'),
      replaceRemoteAssetExtension(assetUrl, 'mid'),
    ];
  };

  const fetchFirstRemoteAsset = async (candidates: string[]) => {
    let lastError: unknown = null;
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const normalized = String(candidate || '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);

      try {
        const res = await fetch(normalized);
        if (!res.ok) continue;
        return Buffer.from(await res.arrayBuffer());
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      console.warn('[api/lily/render] proxy download failed:', lastError);
    }

    return null;
  };

  try {
    if (!svgExists) {
      const svgBuffer = await fetchFirstRemoteAsset(buildRemoteSvgCandidates(remoteUrl));
      if (svgBuffer) {
        fs.writeFileSync(svgPath, svgBuffer);
        svgExists = true;
      }
    }

    if (!midiExists) {
      const midiBuffer = await fetchFirstRemoteAsset(buildRemoteMidiCandidates(remoteUrl));
      if (midiBuffer) {
        fs.writeFileSync(midiPath, midiBuffer);
        midiExists = true;
      }
    }

    return {
      svgExists,
      midiExists,
    };
  } catch (err) {
    console.warn('[api/lily/render] proxy download failed:', err);
    return {
      svgExists: fs.existsSync(svgPath),
      midiExists: fs.existsSync(midiPath),
    };
  }
}

export const GET: APIRoute = async ({ url }) => {
  const remoteUrl = url.searchParams.get('url');
  if (!remoteUrl) return new Response('Missing url', { status: 400 });
  const requestedKind: LilyAssetKind | null =
    /\.svg(?=([?#].*)?$)/i.test(remoteUrl)
      ? 'svg'
      : /\.(midi|mid)(?=([?#].*)?$)/i.test(remoteUrl)
        ? 'midi'
        : null;
  if (!requestedKind) {
    return new Response('Unsupported LilyPond asset type', { status: 400 });
  }

  // Extract hash from URL if possible
  const hashMatch = remoteUrl.match(/\/([a-f0-9]{32,})\.(svg|midi|mid)/i);
  const hash = hashMatch ? hashMatch[1] : hashLilySource(remoteUrl);
  
  ensureLilyDir();
  const localSvgUrl = `/lily/${hash}.svg`;
  const localMidiUrl = `/lily/${hash}.midi`;
  const localSvgPath = path.join(LILY_DIR, `${hash}.svg`);
  const localMidiPath = path.join(LILY_DIR, `${hash}.midi`);

  if (requestedKind === 'svg' && fs.existsSync(localSvgPath)) {
    return Response.redirect(new URL(localSvgUrl, url.origin), 302);
  }

  if (requestedKind === 'midi' && fs.existsSync(localMidiPath)) {
    return Response.redirect(new URL(localMidiUrl, url.origin), 302);
  }

  const result = await downloadRemoteLilyFiles(remoteUrl, hash);

  if (requestedKind === 'svg' && result.svgExists) {
    return Response.redirect(new URL(localSvgUrl, url.origin), 302);
  }

  if (requestedKind === 'midi' && result.midiExists) {
    return Response.redirect(new URL(localMidiUrl, url.origin), 302);
  }

  return new Response(
    requestedKind === 'midi' ? 'Remote LilyPond MIDI unavailable' : 'Could not proxy file',
    { status: requestedKind === 'midi' ? 404 : 502 },
  );
};

export const POST: APIRoute = async ({ request }) => {
  let payload: Record<string, unknown> = {};
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawSource = String(payload.code || '');
  const cachedUrl = getRenderedLilypondUrl(rawSource);
  const source = stripRenderedLilypondComment(rawSource);
  if (!source.trim()) {
    return new Response(JSON.stringify({ error: 'Missing LilyPond source code' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sourceBytes = Buffer.byteLength(source, 'utf8');
  if (sourceBytes > MAX_SOURCE_BYTES) {
    return new Response(JSON.stringify({ error: 'LilyPond source too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  ensureLilyDir();

  const hash = hashLilySource(source);
  const svgFilename = `${hash}.svg`;
  const svgPath = path.join(LILY_DIR, svgFilename);
  const svgUrl = `/lily/${svgFilename}`;

  if (cachedUrl) {
    // If it's a remote URL, try to proxy it locally
    if (cachedUrl.startsWith('http')) {
      await downloadRemoteLilyFiles(cachedUrl, hash);
    }

    return new Response(
      JSON.stringify({
        success: true,
        hash,
        url: fs.existsSync(svgPath) ? svgUrl : cachedUrl,
        generated: false,
        cached: true,
        remote: true,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  if (fs.existsSync(svgPath)) {
    return new Response(
      JSON.stringify({
        success: true,
        hash,
        url: svgUrl,
        generated: false,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const isLocalFirst = LILYPOND_RENDER_STRATEGY === 'local-first';
  const isRemoteOnly = LILYPOND_RENDER_STRATEGY === 'remote-only';
  const shouldTryRemote = LILYPOND_RENDER_STRATEGY !== 'local-only';
  const allowsLocalFallback =
    LILYPOND_RENDER_STRATEGY === 'local-first' ||
    LILYPOND_RENDER_STRATEGY === 'remote-first' ||
    LILYPOND_RENDER_STRATEGY === 'local-only';

  if (isLocalFirst) {
    const generatedLocally = tryRenderLilySvg(hash, source);
    if (generatedLocally) {
      return new Response(
        JSON.stringify({
          success: true,
          hash,
          url: svgUrl,
          generated: true,
          local: true,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  }

  if (shouldTryRemote) {
    const remoteUrl = await renderRemoteLilypond(source, { timeoutMs: 10_000 });
    if (remoteUrl) {
      // Proxy the remote files locally so the browser doesn't have CORS issues
      await downloadRemoteLilyFiles(remoteUrl, hash);

      return new Response(
        JSON.stringify({
          success: true,
          hash,
          url: fs.existsSync(svgPath) ? svgUrl : remoteUrl,
          generated: true,
          remote: true,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  }

  if (isRemoteOnly) {
    return new Response(
      JSON.stringify({
        success: false,
        hash,
        error: 'Remote LilyPond render is unavailable',
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const generated = allowsLocalFallback ? tryRenderLilySvg(hash, source) : false;
  if (!generated) {
    return new Response(
      JSON.stringify({
        success: false,
        hash,
        error: 'LilyPond SVG is unavailable on this server',
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      hash,
      url: svgUrl,
      generated: true,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
};
