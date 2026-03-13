import http from 'node:http';
import { exec } from 'node:child_process';
import util from 'node:util';

const execPromise = util.promisify(exec);

const PORT = process.env.CONTENT_BUS_PORT || 4322;
const SECRET = process.env.CONTENT_BUS_SECRET || 'musiki-local-secret';

// In-memory status for the beacon
let status = {
  state: 'idle', // idle, running, ok, error, unknown
  title: 'Content Bus Idle',
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

async function runPipeline(payload) {
  if (isRunning) {
    rerunRequested = true;
    pendingPayload = payload;
    console.log('[Content Bus] Pipeline already running. Rerun queued.');
    return;
  }

  isRunning = true;
  status.state = 'running';
  status.title = `Syncing ${payload?.source_repo || 'content'}...`;
  status.sourceRepo = payload?.source_repo || null;
  status.sourceSha = payload?.source_sha || null;
  status.sourceRef = payload?.source_ref || null;
  status.createdAt = new Date().toISOString();
  status.updatedAt = null;
  status.lastError = null;

  try {
    console.log(`[Content Bus] Starting pipeline for ${payload?.source_repo || 'unknown'}...`);
    
    // 1. Pull latest sources (prefer clean for reliability)
    await runCommand('npm run content:pull -- --clean');
    
    // 2. Assemble content (uses staging folder and atomic apply)
    await runCommand('npm run content:assemble');
    
    // Note: No pm2 reload needed anymore due to runtime rendering pattern
    
    status.state = 'ok';
    status.title = 'Content Synced';
    console.log(`[Content Bus] Pipeline finished successfully.`);
  } catch (error) {
    status.state = 'error';
    status.title = 'Sync Failed';
    status.lastError = error.message;
    console.error(`[Content Bus] Pipeline failed:`, error);
  } finally {
    status.updatedAt = new Date().toISOString();
    status.fetchedAt = new Date().toISOString();
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

async function runCommand(command) {
  console.log(`[Content Bus] Running: ${command}`);
  const { stdout, stderr } = await execPromise(command);
  if (stdout) console.log(`[Content Bus] stdout:\n${stdout}`);
  if (stderr) console.error(`[Content Bus] stderr:\n${stderr}`);
}

const server = http.createServer(async (req, res) => {
  status.fetchedAt = new Date().toISOString();

  // Status endpoint for the beacon
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
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
  console.log(`[Content Bus] Listening on port ${PORT}`);
});
