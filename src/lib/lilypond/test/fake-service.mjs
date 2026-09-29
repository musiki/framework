// Test helper: a fake lilypond-service on a unix socket (mirrors the client
// package's tests). `handler({ source, formats }, req, res)` returns a reply
// object { status, body, headers } or undefined to hang.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HASH = 'b'.repeat(64);

export const LILY_SVG = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.2" width="119.5mm" height="16.7mm" viewBox="0 -0 67.9 9.5">\n<style text="style/css">\n<![CDATA[\ntspan { white-space: pre; }\n]]>\n</style>\n<rect transform="translate(5.7, 4.5)" x="0.0" y="-0.05" width="62.2" height="0.1" ry="0.05" fill="currentColor"/>\n<path transform="translate(9.9, 5.0) scale(0.004, -0.004)" d="M218 136c55 0 108 -28 108 -89" fill="currentColor"/>\n<text font-family="serif" font-size="2.7" text-anchor="start" fill="currentColor"><tspan>Allegro &amp; co</tspan></text>\n</svg>';

export const EVIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject><img src="x" onerror="alert(3)"/></foreignObject><a xlink:href="javascript:alert(4)" xmlns:xlink="http://www.w3.org/1999/xlink"><text>click</text></a><image href="https://evil.example/t.png"/><rect style="fill:url(https://evil.example/p)" width="1" height="1"/><path d="M0 0" fill="currentColor"/></svg>';

export function makeTmpDir(prefix = 'lily-engine-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function fakeService(handler) {
  const dir = makeTmpDir('lily-sock-');
  const socketPath = path.join(dir, 's.sock');
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
      seen.push({ method: req.method, url: req.url, ...body });
      const reply = await handler(body, req, res);
      if (!reply) return; // hang
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...(reply.headers || {}) });
      res.end(JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    seen,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => { fs.rmSync(dir, { recursive: true, force: true }); resolve(); });
    }),
  };
}

export const ok = (extra = {}) => ({
  status: 200,
  body: { hash: HASH, cached: false, svg: LILY_SVG, midi: Buffer.from('MThd-fake').toString('base64'), ...extra },
});
