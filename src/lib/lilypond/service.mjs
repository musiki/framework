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
import crypto from 'node:crypto';
import * as defaultClient from '../vendor/lilypond-client/index.mjs';
import { buildLocalLilypondSourceAttempts } from '../lilypond-support.mjs';
import { isLocalRenderAllowed, renderWithLocalBinary } from './local-render.mjs';

const CIRCUIT_OPEN_MS = 30_000;
const BUSY_RETRIES = 2;
const BUSY_DELAY_MS = 750;
const NEGATIVE_TTL_MS = 10 * 60_000;
const NEGATIVE_STDERR_MAX = 2048;
/**
 * Client deadline for one render: the service's LilyPond timeout (20 s) plus an
 * allowance for waiting in the service queue (25 s). A deadline that expires
 * without an HTTP answer counts as an outage, so it must exceed what a healthy
 * but loaded service can take.
 */
export const DEFAULT_RENDER_DEADLINE_MS = 45_000;
const NEGATIVE_MAX = 1000;

const state = {
  warned: false,
  circuitOpenUntil: 0,
  active: 0,
  queue: [],
  negative: new Map(), // key -> { until, outcome }
};

function envInt(env, name, fallback, min = 1) {
  const value = Number(env?.[name]);
  return Number.isFinite(value) && value >= min ? Math.floor(value) : fallback;
}

/**
 * Transport failure = the service itself is unreachable (connection error, or
 * the client-side deadline expired without any HTTP answer). Only these open
 * the engine-wide circuit. A 504/422 carries an HTTP status: that is one
 * score failing (e.g. an endless loop hitting LilyPond's timeout), not an outage.
 */
export function isTransportFailure(error) {
  if (error?.code === 'unavailable') return true;
  return error?.code === 'timeout' && error?.status === undefined;
}

class QueueFullError extends Error {
  constructor() {
    super('engine-side LilyPond queue is full');
    this.code = 'busy';
    this.queueFull = true;
  }
}

async function withSlot(env, task) {
  const limit = envInt(env, 'LILYPOND_CLIENT_CONCURRENCY', 2);
  const queueMax = envInt(env, 'LILYPOND_CLIENT_QUEUE_MAX', 16, 0);
  if (state.active >= limit) {
    if (state.queue.length >= queueMax) throw new QueueFullError();
    // The releasing task hands its slot over directly (active stays counted).
    await new Promise((resolve) => state.queue.push(resolve));
  } else {
    state.active += 1;
  }
  try {
    return await task();
  } finally {
    const next = state.queue.shift();
    if (next) next();
    else state.active -= 1;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function noteOutage(error, now) {
  if (isTransportFailure(error)) state.circuitOpenUntil = now + CIRCUIT_OPEN_MS;
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

function negativeKey(source, formats) {
  return crypto.createHash('md5').update(`${[...formats].sort().join(',')}\n${source}`).digest('hex');
}

function rememberFailure(key, outcome, now) {
  if (typeof outcome.stderr === 'string' && outcome.stderr.length > NEGATIVE_STDERR_MAX) {
    outcome = { ...outcome, stderr: outcome.stderr.slice(-NEGATIVE_STDERR_MAX) };
  }
  state.negative.delete(key);
  state.negative.set(key, { until: now + NEGATIVE_TTL_MS, outcome });
  while (state.negative.size > NEGATIVE_MAX) state.negative.delete(state.negative.keys().next().value);
  return outcome;
}

function recalledFailure(key, now) {
  const hit = state.negative.get(key);
  if (!hit) return null;
  if (hit.until <= now) {
    state.negative.delete(key);
    return null;
  }
  return { ...hit.outcome, negativeCached: true };
}

/** Test hook: forget outage/circuit/negative-cache state. */
export function resetLilypondServiceState() {
  state.warned = false;
  state.circuitOpenUntil = 0;
  state.negative.clear();
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_DEADLINE_MS;
  const client = options.client ?? defaultClient;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const localAllowed = isLocalRenderAllowed(env);

  const raw = String(source ?? '');
  if (!raw.trim()) return { ok: false, reason: 'empty', message: 'empty LilyPond source' };

  const failureKey = negativeKey(raw, formats);
  const recalled = recalledFailure(failureKey, now());
  if (recalled) return recalled;

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
        noteRecovery();
        lastFailure = error;
        continue;
      }
      if (error?.code === 'bad_request' || error?.code === 'too_large') {
        return { ok: false, reason: error.code, message: error.message };
      }
      if (error instanceof QueueFullError) {
        return { ok: false, reason: 'busy', message: error.message };
      }
      if (error?.code === 'timeout' && error?.status !== undefined) {
        // This score ran into the service's LilyPond timeout: per-score failure.
        noteRecovery();
        return rememberFailure(failureKey, { ok: false, reason: 'timeout', perScore: true, message: error.message }, now());
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

  return rememberFailure(failureKey, {
    ok: false,
    reason: 'render_failed',
    message: lastFailure?.message || 'LilyPond render failed',
    stderr: typeof lastFailure?.stderr === 'string' ? lastFailure.stderr : undefined,
  }, now());
}
