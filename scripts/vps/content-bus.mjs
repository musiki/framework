import http from 'node:http';
import { exec } from 'node:child_process';
import util from 'node:util';

const execPromise = util.promisify(exec);

const PORT = process.env.CONTENT_BUS_PORT || 4322;
const SECRET = process.env.CONTENT_BUS_SECRET || 'musiki-local-secret';

// Helper to run shell commands and log them
async function runCommand(command) {
  console.log(`[Content Bus] Running: ${command}`);
  const { stdout, stderr } = await execPromise(command);
  if (stdout) console.log(`[Content Bus] ${command} stdout:\n${stdout}`);
  if (stderr) console.error(`[Content Bus] ${command} stderr:\n${stderr}`);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/webhook/content-update') {
    // 1. Basic Authorization
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${SECRET}`) {
      console.warn(`[Content Bus] Unauthorized access attempt.`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    console.log(`[Content Bus] Webhook received! Starting incremental pipeline...`);
    
    // Respond immediately so GitHub Actions (or the caller) doesn't timeout
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'Accepted, pipeline started in background' }));

    try {
      // 2. Pull latest sources
      await runCommand('npm run content:pull');
      
      // 3. Assemble content (uses staging folder and atomic apply)
      await runCommand('npm run content:assemble');
      
      // 4. Reload Astro via PM2 (Zero Downtime)
      await runCommand('pm2 reload musiki-framework');

      console.log(`[Content Bus] Pipeline finished successfully. Astro reloaded.`);
    } catch (error) {
      console.error(`[Content Bus] Pipeline failed:`, error);
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`[Content Bus] Listening for events on port ${PORT}`);
  console.log(`[Content Bus] Webhook URL: http://localhost:${PORT}/webhook/content-update`);
});
