import http from 'node:http';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

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
const normalizeBranchName = (value) => String(value || '').trim().replace(/^refs\/heads\//, '');
const normalizeRepoSlug = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('git@github.com:')) {
    return text.slice('git@github.com:'.length).replace(/\.git$/i, '').toLowerCase();
  }
  return text
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+/, '')
    .toLowerCase();
};
const normalizeCommitSha = (value) => {
  const text = String(value || '').trim();
  return /^[0-9a-f]{7,40}$/i.test(text) ? text : '';
};

// In-memory status for the beacon
let status = {
  state: 'idle', // idle, running, ok, error, unknown
  title: 'Content Bus Idle',
  phase: 'idle',
  runNumber: null,
  createdAt: null,
  updatedAt: null,
  fetchedAt: new Date().toISOString(),
  sourceRepo: null,
  sourceSha: null,
  sourceRef: null,
  lastError: null,
  mode: 'content-bus'
};

let isRunning = false;
let rerunRequested = false;
let pendingPayload = null;

const updateStatus = (patch = {}) => {
  status = {
    ...status,
    ...patch,
    fetchedAt: new Date().toISOString(),
  };
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

async function runPipeline(payload) {
  if (isRunning) {
    rerunRequested = true;
    pendingPayload = payload;
    console.log('[Content Bus] Pipeline already running. Rerun queued.');
    return;
  }

  isRunning = true;
  updateStatus({
    state: 'running',
    phase: 'queued',
    title: `Syncing ${formatRepoLabel(payload?.source_repo)}...`,
    sourceRepo: payload?.source_repo || null,
    sourceSha: payload?.source_sha || null,
    sourceRef: payload?.source_ref || null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    lastError: null,
  });

  try {
    console.log(`[Content Bus] Starting pipeline for ${payload?.source_repo || 'unknown'}...`);

    await runCommand(DEPLOY_COMMAND, {
      CONTENT_SOURCE_STRATEGY,
      VPS_CONTENT_SOURCE_STRATEGY: CONTENT_SOURCE_STRATEGY,
      VPS_INSTALL_COMMAND: CONTENT_BUS_INSTALL_COMMAND,
      VPS_SKIP_FRAMEWORK_RESET: process.env.VPS_SKIP_FRAMEWORK_RESET || '0',
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

    updateStatus({
      state: 'ok',
      phase: 'done',
      title: `Content deployed · ${formatRepoLabel(payload?.source_repo)}`,
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
    updateStatus({
      updatedAt: new Date().toISOString(),
    });
    isRunning = false;

    if (rerunRequested) {
      rerunRequested = false;
      const nextPayload = pendingPayload;
      pendingPayload = null;
      // Small delay to prevent tight loops
      setTimeout(() => runPipeline(nextPayload), 1000);
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
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${SECRET}`) {
      console.warn(`[Content Bus] Unauthorized access attempt.`);
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

      runPipeline(payload);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  const maskedSecret = SECRET.length > 4 ? `${SECRET.slice(0, 2)}****${SECRET.slice(-2)}` : '****';
  console.log(`[Content Bus] Listening on port ${PORT} (secret: ${maskedSecret})`);
});
