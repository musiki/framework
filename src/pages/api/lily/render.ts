import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { renderRemoteLilypond } from '../../../lib/lilypond-remote.mjs';
import {
  getRenderedLilypondUrl,
  stripRenderedLilypondComment,
} from '../../../lib/lilypond-rendered-comment.mjs';

const LILY_DIR = path.join(process.cwd(), 'public', 'lily');
const MAX_SOURCE_BYTES = 64 * 1024;
const LILYPOND_RENDER_STRATEGY =
  String(process.env.LILYPOND_RENDER_STRATEGY || 'remote-only').trim().toLowerCase();

function ensureLilyDir() {
  if (!fs.existsSync(LILY_DIR)) {
    fs.mkdirSync(LILY_DIR, { recursive: true });
  }
}

function hashLilySource(source: string): string {
  return crypto.createHash('md5').update(source).digest('hex');
}

function hasLilypondBinary(): boolean {
  try {
    execSync('lilypond --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function tryRenderLilySvg(hash: string, source: string): boolean {
  const svgPath = path.join(LILY_DIR, `${hash}.svg`);
  if (fs.existsSync(svgPath)) return true;

  if (!hasLilypondBinary()) return false;

  const tmpLyPath = path.join(LILY_DIR, `${hash}.ly`);
  // Use prefix for output control
  const outPrefix = path.join(LILY_DIR, hash);

  try {
    fs.writeFileSync(tmpLyPath, source, 'utf8');
    try {
      // Use --output to control the directory and prefix
      execSync(
        `lilypond -dbackend=svg --output="${outPrefix}" "${tmpLyPath}"`,
        { stdio: 'ignore' },
      );
      
      // LilyPond might produce .mid or .midi depending on version/config
      const midPath = path.join(LILY_DIR, `${hash}.mid`);
      const midiPath = path.join(LILY_DIR, `${hash}.midi`);
      if (fs.existsSync(midPath) && !fs.existsSync(midiPath)) {
        fs.renameSync(midPath, midiPath);
      }
    } catch (execError) {
      console.warn('[api/lily/render] lilypond reported issues, checking if SVG was still produced...');
    }
  } catch (error) {
    console.error('[api/lily/render] file system error during render:', (error as Error)?.message || error);
  } finally {
    if (fs.existsSync(tmpLyPath)) {
      fs.unlinkSync(tmpLyPath);
    }
  }

  return fs.existsSync(svgPath);
}

async function downloadRemoteLilyFiles(remoteUrl: string, hash: string) {
  const svgPath = path.join(LILY_DIR, `${hash}.svg`);
  const midiPath = path.join(LILY_DIR, `${hash}.midi`);

  try {
    // Only download if SVG doesn't exist locally
    if (!fs.existsSync(svgPath)) {
      const res = await fetch(remoteUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        fs.writeFileSync(svgPath, Buffer.from(buf));
      }
    }

    // Try to get MIDI too
    if (!fs.existsSync(midiPath)) {
      const remoteMidiUrl = remoteUrl.replace(/\.svg$/i, '.midi');
      const resMidi = await fetch(remoteMidiUrl);
      if (resMidi.ok) {
        const bufMidi = await resMidi.arrayBuffer();
        fs.writeFileSync(midiPath, Buffer.from(bufMidi));
      } else {
        // Try .mid fallback
        const resMid = await fetch(remoteUrl.replace(/\.svg$/i, '.mid'));
        if (resMid.ok) {
          const bufMid = await resMid.arrayBuffer();
          fs.writeFileSync(midiPath, Buffer.from(bufMid));
        }
      }
    }
    return true;
  } catch (err) {
    console.warn('[api/lily/render] proxy download failed:', err);
    return false;
  }
}

export const GET: APIRoute = async ({ url }) => {
  const remoteUrl = url.searchParams.get('url');
  if (!remoteUrl) return new Response('Missing url', { status: 400 });

  // Extract hash from URL if possible
  const hashMatch = remoteUrl.match(/\/([a-f0-9]{32,})\.(svg|midi|mid)/i);
  const hash = hashMatch ? hashMatch[1] : hashLilySource(remoteUrl);
  
  ensureLilyDir();
  const success = await downloadRemoteLilyFiles(remoteUrl, hash);
  
  if (success) {
    const isMidi = remoteUrl.endsWith('.midi') || remoteUrl.endsWith('.mid');
    const localUrl = `/lily/${hash}.${isMidi ? 'midi' : 'svg'}`;
    return Response.redirect(new URL(localUrl, url.origin), 302);
  }

  return new Response('Could not proxy file', { status: 502 });
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
