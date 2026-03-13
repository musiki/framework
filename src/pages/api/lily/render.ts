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
  const outBasePath = path.join(LILY_DIR, hash);

  try {
    fs.writeFileSync(tmpLyPath, source, 'utf8');
    execSync(
      `lilypond -dbackend=svg -dno-point-and-click -o "${outBasePath}" "${tmpLyPath}"`,
      { stdio: 'ignore' },
    );
  } catch (error) {
    console.error('[api/lily/render] lilypond render failed:', (error as Error)?.message || error);
  } finally {
    if (fs.existsSync(tmpLyPath)) {
      fs.unlinkSync(tmpLyPath);
    }
  }

  return fs.existsSync(svgPath);
}

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
    return new Response(
      JSON.stringify({
        success: true,
        hash,
        url: cachedUrl,
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
      return new Response(
        JSON.stringify({
          success: true,
          hash,
          url: remoteUrl,
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
