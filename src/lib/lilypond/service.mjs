// Engine-side LilyPond rendering: every compile goes through the sandboxed
// lilypond-service (vendored @zztt/lilypond-client, unix socket
// LILYPOND_SOCKET, default /run/lilypond/lily.sock, or LILYPOND_SERVICE_URL).
// The engine never runs LilyPond itself, except when LILYPOND_ALLOW_LOCAL=1
// outside production (local development only, see local-render.mjs).
//
// Source preparation stays here (engine policy): buildLocalLilypondSourceAttempts
// adds \layout/\midi and produces the english → nederlands retry; the client
// renders exactly one attempt per call and we move on when it reports
// `render_failed`. Any other failure (service unreachable, timeout, busy,
// protocol) degrades gracefully: callers keep the code block, and the outage is
// logged once until the service answers again.
import * as defaultClient from '../vendor/lilypond-client/index.mjs';
import { buildLocalLilypondSourceAttempts } from '../lilypond-support.mjs';
import { isLocalRenderAllowed, renderWithLocalBinary } from './local-render.mjs';

const OUTAGE_CODES = new Set(['unavailable', 'timeout']);
const CIRCUIT_OPEN_MS = 30_000;
const BUSY_RETRIES = 2;
const BUSY_DELAY_MS = 750;

const state = {
  warned: false,
  circuitOpenUntil: 0,
  active: 0,
  queue: [],
};

function maxConcurrency(env) {
  const value = Number(env?.LILYPOND_CLIENT_CONCURRENCY);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 2;
}

async function withSlot(env, task) {
  const limit = maxConcurrency(env);
  if (state.active >= limit) {
    await new Promise((resolve) => state.queue.push(resolve));
  }
  state.active += 1;
  try {
    return await task();
  } finally {
    state.active -= 1;
    const next = state.queue.shift();
    if (next) next();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function noteOutage(error, now) {
  if (OUTAGE_CODES.has(error?.code)) state.circuitOpenUntil = now + CIRCUIT_OPEN_MS;
  if (state.warned) return;
  state.warned = true;
  console.warn(
    `[lilypond] render service unavailable (${error?.code || 'error'}: ${error?.message || error}); `
      + 'LilyPond blocks stay as code until it answers again. '
      + 'Check LILYPOND_SOCKET / LILYPOND_SERVICE_URL.',
  );
}

function noteRecovery() {
  if (state.warned) console.info('[lilypond] render service reachable again');
  state.warned = false;
  state.circuitOpenUntil = 0;
}

/** Test hook: forget outage/circuit state. */
export function resetLilypondServiceState() {
  state.warned = false;
  state.circuitOpenUntil = 0;
}

function hasRequestedOutput(result, formats) {
  if (!result) return false;
  if (formats.includes('svg')) return typeof result.svg === 'string' && result.svg.length > 0;
  if (formats.includes('pdf')) return Buffer.isBuffer(result.pdf) && result.pdf.length > 0;
  return Buffer.isBuffer(result.midi) && result.midi.length > 0;
}

async function renderOnce(source, { client, formats, timeoutMs, env, localAllowed }) {
  let lastBusy = null;
  for (let attempt = 0; attempt <= BUSY_RETRIES; attempt += 1) {
    try {
      return await client.render(source, { formats, timeoutMs, env });
    } catch (error) {
      if (error?.code === 'busy') {
        lastBusy = error;
        await sleep(BUSY_DELAY_MS * (attempt + 1));
        continue;
      }
      if (error?.code === 'unavailable' && localAllowed) {
        return renderWithLocalBinary(source, { formats, timeoutMs });
      }
      throw error;
    }
  }
  throw lastBusy;
}

/**
 * Render LilyPond through the service, one call per prepared source attempt.
 *
 * @param {string} source raw LilyPond source (without `% rendered:` comment)
 * @param {{formats?: string[], timeoutMs?: number, client?: {render: Function}, env?: Record<string, string|undefined>, now?: () => number}} [options]
 * @returns {Promise<
 *   | {ok: true, result: {hash: string, svg?: string, svgPages?: string[], midi?: Buffer, pdf?: Buffer, cached: boolean}, source: string, attempt: number}
 *   | {ok: false, reason: string, message?: string, stderr?: string}
 * >}
 */
export async function renderLilypond(source, options = {}) {
  const formats = options.formats ?? ['svg', 'midi'];
  const timeoutMs = options.timeoutMs ?? 30_000;
  const client = options.client ?? defaultClient;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const localAllowed = isLocalRenderAllowed(env);

  const raw = String(source ?? '');
  if (!raw.trim()) return { ok: false, reason: 'empty', message: 'empty LilyPond source' };

  if (!localAllowed && state.circuitOpenUntil > now()) {
    return { ok: false, reason: 'unavailable', message: 'LilyPond render service unavailable (retrying later)' };
  }

  const attempts = buildLocalLilypondSourceAttempts(raw);
  let lastFailure = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const attemptSource = attempts[index];
    let result;
    try {
      result = await withSlot(env, () => renderOnce(attemptSource, { client, formats, timeoutMs, env, localAllowed }));
    } catch (error) {
      if (error?.code === 'render_failed') {
        lastFailure = error;
        continue;
      }
      if (error?.code === 'bad_request' || error?.code === 'too_large') {
        return { ok: false, reason: error.code, message: error.message };
      }
      noteOutage(error, now());
      return { ok: false, reason: error?.code || 'unavailable', message: error?.message || String(error) };
    }

    noteRecovery();
    if (hasRequestedOutput(result, formats)) {
      return { ok: true, result, source: attemptSource, attempt: index };
    }
    lastFailure = { message: `LilyPond produced no ${formats.join('/')} output` };
  }

  return {
    ok: false,
    reason: 'render_failed',
    message: lastFailure?.message || 'LilyPond render failed',
    stderr: typeof lastFailure?.stderr === 'string' ? lastFailure.stderr : undefined,
  };
}
