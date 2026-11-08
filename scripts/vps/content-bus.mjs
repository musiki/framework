import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import {
  mergePending,
  normalizeBranchName,
  normalizeCommitSha,
  normalizeRepoSlug,
  reloadCommandFor,
  sourcesOf,
} from './content-bus-queue.mjs';

const PORT = process.env.CONTENT_BUS_PORT || 4322;
const SECRET = process.env.CONTENT_BUS_SECRET || 'musiki-local-secret';
const DEPLOY_COMMAND =
  (process.env.CONTENT_BUS_DEPLOY_COMMAND || 'bash scripts/vps/deploy-framework-local.sh').trim();
const CONTENT_SOURCE_STRATEGY = (
  process.env.CONTENT_BUS_CONTENT_SOURCE_STRATEGY ||
  process.env.CONTENT_SOURCE_STRATEGY ||
  'remote-only'
).trim() || 'remote-only';
const CONTENT_BUS_INSTALL_COMMAND = (process.env.CONTENT_BUS_INSTALL_COMMAND || '').trim();

// Estado y cola en disco. El bus se reinicia cuando el CI deploya el framework
// (y si se cae); en memoria se perdían el último resultado que muestra el
// beacon y los avisos que habían llegado mientras corría un pipeline.
const STATE_FILE = process.env.CONTENT_BUS_STATE_FILE
  || path.join(os.tmpdir(), `musiki-content-bus-${PORT}.json`);

// El deploy no recarga al bus: con treekill, pm2 mataba al deploy en plena
// recarga y con él la cola. hem ya trae su propio VPS_RELOAD_COMMAND.
const RELOAD_COMMAND = (() => {
  if (process.env.VPS_RELOAD_COMMAND) return process.env.VPS_RELOAD_COMMAND;
  try {
    const { apps } = createRequire(import.meta.url)(path.resolve('ecosystem.config.cjs'));
    return reloadCommandFor(apps) || undefined;
  } catch (error) {
    console.error('[Content Bus] No pude leer ecosystem.config.cjs para armar la recarga:', error);
    return undefined;
  }
})();

const getFrameworkCommit = () => {
  try {
    return spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  } catch (e) {
    return 'unknown';
  }
};

// Estado para el beacon. `sources` es lo que está corriendo (o lo último que
// corrió) y `lastDeployed` lo último que llegó a producción.
let status = {
  state: 'idle', // idle, running, ok, error, unknown
  title: 'Content Bus Idle',
  phase: 'idle',
  frameworkCommit: getFrameworkCommit(),
  runNumber: null,
  createdAt: null,
  updatedAt: null,
  fetchedAt: new Date().toISOString(),
  sourceRepo: null,
  sourceSha: null,
  sourceRef: null,
  sources: [],
  lastDeployed: null,
  lastError: null,
  mode: 'content-bus'
};

let isRunning = false;
let pending = [];
let running = null;

const saveState = () => {
  try {
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ status, running, pending }));
    fs.renameSync(tmp, STATE_FILE);
  } catch (error) {
    console.error('[Content Bus] No pude guardar el estado:', error);
  }
};

const loadState = () => {
  try {
    if (!fs.existsSync(STATE_FILE)) return [];
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    status = { ...status, ...(saved.status || {}), frameworkCommit: getFrameworkCommit(), mode: 'content-bus' };
    const interrupted = Array.isArray(saved.running) ? saved.running : [];
    if (interrupted.length) {
      console.warn(`[Content Bus] Un pipeline quedó cortado (${sourcesOf(interrupted).map((s) => s.course).join(', ')}); se vuelve a correr.`);
    }
    return mergePending(interrupted, Array.isArray(saved.pending) ? saved.pending : []);
  } catch (error) {
    console.error('[Content Bus] No pude leer el estado guardado:', error);
    return [];
  }
};

const updateStatus = (patch = {}) => {
  status = {
    ...status,
    ...patch,
    fetchedAt: new Date().toISOString(),
  };
  saveState();
};

const formatRepoLabel = (repo) => {
  const text = String(repo || '').trim();
  if (!text) return 'content';
  const [, name] = text.split('/');
  return name || text;
};

const readDeployPhase = (line) => {
  const match = /^::deploy-phase::([^:]+)::(.+)$/.exec(String(line || '').trim());
  if (!match) return null;

  return {
    phase: match[1],
    title: match[2],
  };
};

const enqueue = (payload) => {
  pending = mergePending(pending, [payload]);
  saveState();
  if (isRunning) {
    console.log('[Content Bus] Pipeline already running. Rerun queued.');
    return;
  }
  void runPipeline();
};

async function runPipeline() {
  if (isRunning || !pending.length) return;

  // Una corrida trae todos los repos; el último aviso fija su commit exacto.
  const batch = pending;
  pending = [];
  running = batch;
  const payload = batch.at(-1);
  const sources = sourcesOf(batch);
  const label = sources.map((s) => s.course).filter(Boolean).join(', ') || formatRepoLabel(payload?.source_repo);

  isRunning = true;
  updateStatus({
    state: 'running',
    phase: 'queued',
    title: `Syncing ${label}...`,
    sourceRepo: payload?.source_repo || null,
    sourceSha: payload?.source_sha || null,
    sourceRef: payload?.source_ref || null,
    sources,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    lastError: null,
  });

  try {
    console.log(`[Content Bus] Starting pipeline for ${label}...`);

    await runCommand(DEPLOY_COMMAND, {
      CONTENT_SOURCE_STRATEGY,
      VPS_CONTENT_SOURCE_STRATEGY: CONTENT_SOURCE_STRATEGY,
      VPS_INSTALL_COMMAND: CONTENT_BUS_INSTALL_COMMAND,
      VPS_SKIP_FRAMEWORK_RESET: process.env.VPS_SKIP_FRAMEWORK_RESET || '0',
      ...(RELOAD_COMMAND ? { VPS_RELOAD_COMMAND: RELOAD_COMMAND } : {}),
      CONTENT_SOURCE_TARGET_REPO: normalizeRepoSlug(payload?.source_repo),
      CONTENT_SOURCE_TARGET_BRANCH: normalizeBranchName(payload?.source_ref),
      CONTENT_SOURCE_TARGET_SHA: normalizeCommitSha(payload?.source_sha),
    }, (phaseInfo) => {
      updateStatus({
        state: 'running',
        phase: phaseInfo.phase,
        title: phaseInfo.title,
      });
    });

    const finishedAt = new Date().toISOString();
    updateStatus({
      state: 'ok',
      phase: 'done',
      title: `Content deployed · ${label}`,
      lastDeployed: { sources, at: finishedAt },
    });
    console.log(`[Content Bus] Pipeline finished successfully.`);
  } catch (error) {
    updateStatus({
      state: 'error',
      phase: 'error',
      title: 'Sync Failed',
      lastError: error.message,
    });
    console.error(`[Content Bus] Pipeline failed:`, error);
  } finally {
    isRunning = false;
    running = null;
    updateStatus({
      updatedAt: new Date().toISOString(),
      frameworkCommit: getFrameworkCommit(),
    });

    if (pending.length) {
      // Small delay to prevent tight loops
      setTimeout(() => void runPipeline(), 1000);
    }
  }
}

async function runCommand(command, extraEnv = {}, onPhase = null) {
  console.log(`[Content Bus] Running: ${command}`);
  await new Promise((resolve, reject) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const pipeStream = (stream, level) => {
      const lines = readline.createInterface({ input: stream });
      lines.on('line', (line) => {
        const phaseInfo = readDeployPhase(line);
        if (phaseInfo) {
          console.log(`[Content Bus] phase=${phaseInfo.phase} title="${phaseInfo.title}"`);
          if (typeof onPhase === 'function') onPhase(phaseInfo);
          return;
        }

        if (!line.trim()) return;
        if (level === 'stderr') {
          console.error(`[Content Bus] stderr: ${line}`);
        } else {
          console.log(`[Content Bus] stdout: ${line}`);
        }
      });
    };

    pipeStream(child.stdout, 'stdout');
    pipeStream(child.stderr, 'stderr');

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed with exit code ${code}: ${command}`));
    });
  });
}

const server = http.createServer(async (req, res) => {
  status.fetchedAt = new Date().toISOString();

  // Status endpoint for the beacon
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }

  // Debug endpoint (no secrets)
  if (req.method === 'GET' && req.url === '/debug') {
    const debugInfo = {
      env: {
        NODE_ENV: process.env.NODE_ENV,
        CONTENT_BUS_PORT: process.env.CONTENT_BUS_PORT,
        CONTENT_SOURCE_STRATEGY: process.env.CONTENT_SOURCE_STRATEGY,
        VPS_CONTENT_SOURCE_STRATEGY: process.env.VPS_CONTENT_SOURCE_STRATEGY,
        CONTENT_BUS_DEPLOY_COMMAND: process.env.CONTENT_BUS_DEPLOY_COMMAND,
        VPS_SKIP_FRAMEWORK_RESET: process.env.VPS_SKIP_FRAMEWORK_RESET,
      },
      status
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(debugInfo, null, 2));
    return;
  }

  // Webhook endpoint
  if (req.method === 'POST' && req.url === '/webhook/content-update') {
    const authHeader = req.headers['authorization'] || '';
    const maskedAuth = authHeader.length > 15 ? `${authHeader.slice(0, 15)}...` : 'too-short';
    console.log(`[Content Bus] Incoming POST request. Auth: ${maskedAuth}`);

    if (authHeader !== `Bearer ${SECRET}`) {
      console.warn(`[Content Bus] Unauthorized access attempt. Expected secret length: ${SECRET.length}`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch (e) {
        console.error('[Content Bus] Failed to parse webhook body');
      }

      console.log(`[Content Bus] Webhook received from ${payload.source_repo || 'unknown'}`);
      
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'Accepted, pipeline started' }));

      enqueue(payload);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

pending = loadState();

server.listen(PORT, () => {
  const maskedSecret = SECRET.length > 4 ? `${SECRET.slice(0, 2)}****${SECRET.slice(-2)}` : '****';
  console.log(`[Content Bus] Listening on port ${PORT} (secret: ${maskedSecret})`);
  if (pending.length) setTimeout(() => void runPipeline(), 1000);
});
