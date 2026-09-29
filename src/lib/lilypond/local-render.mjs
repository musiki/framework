// LOCAL DEVELOPMENT ONLY (macOS): render with a LilyPond binary on this machine
// when the sandboxed service is unreachable. Enabled only with
// LILYPOND_ALLOW_LOCAL=1, and refused when NODE_ENV=production, on Linux (the
// VPS and CI runners) or when /run/lilypond exists (a host meant to use the
// sandbox) — so neither `astro build` nor a server can fall back to running
// LilyPond in the engine process.
// LilyPond scores can execute Scheme (`#(system ...)`); only use this with
// scores you trust, on your own machine.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { LilypondError } from '../vendor/lilypond-client/index.mjs';
import { getLilypondBinary } from '../lilypond-support.mjs';

export function isLocalRenderAllowed(env = process.env, host = {}) {
  const platform = host.platform ?? process.platform;
  const sandboxDirExists = host.sandboxDirExists ?? existsSync('/run/lilypond');
  return env?.LILYPOND_ALLOW_LOCAL === '1'
    && env?.NODE_ENV !== 'production'
    && platform !== 'linux'
    && !sandboxDirExists;
}

function run(binary, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
      resolve({ error, stderr: String(stderr || '') });
    });
  });
}

async function readIfExists(filePath, encoding) {
  try {
    return await fs.readFile(filePath, encoding);
  } catch {
    return undefined;
  }
}

export async function renderWithLocalBinary(source, { formats = ['svg'], timeoutMs = 30_000 } = {}) {
  const binary = getLilypondBinary();
  if (!binary) throw new LilypondError('unavailable', 'lilypond service unreachable and no local lilypond binary found');

  const jobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lily-local-'));
  const input = path.join(jobDir, 'in.ly');
  const outPrefix = path.join(jobDir, 'out');
  try {
    await fs.writeFile(input, source, 'utf8');
    const result = { hash: crypto.createHash('sha256').update(source).digest('hex'), cached: false };
    let stderr = '';

    if (formats.includes('svg') || formats.includes('midi')) {
      const pass = await run(binary, ['-dbackend=svg', '-dno-point-and-click', '-o', outPrefix, input], timeoutMs);
      stderr = pass.stderr;
      const entries = await fs.readdir(jobDir);
      const pages = entries.filter((name) => /^out(-\d+)?\.svg$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const svgPages = [];
      for (const name of pages) svgPages.push(await fs.readFile(path.join(jobDir, name), 'utf8'));
      if (svgPages.length > 0) result.svg = svgPages[0];
      if (svgPages.length > 1) result.svgPages = svgPages;
      const midi = (await readIfExists(`${outPrefix}.midi`)) ?? (await readIfExists(`${outPrefix}.mid`));
      if (midi) result.midi = midi;
    }
    if (formats.includes('pdf')) {
      const pass = await run(binary, ['--pdf', '-dno-point-and-click', '-o', outPrefix, input], timeoutMs);
      stderr = stderr || pass.stderr;
      const pdf = await readIfExists(`${outPrefix}.pdf`);
      if (pdf) result.pdf = pdf;
    }

    const wanted = formats.includes('svg') ? result.svg : formats.includes('pdf') ? result.pdf : result.midi;
    if (!wanted) {
      throw new LilypondError('render_failed', 'lilypond failed (local binary)', {
        stderr: stderr.split(jobDir).join('<job>').slice(-2000),
      });
    }
    return result;
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true });
  }
}
